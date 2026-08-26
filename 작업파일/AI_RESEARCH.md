# AI_RESEARCH.md — Viet's

버전: v0.1 (설계 초안) · 작성일: 2026-08-26

마스터 프롬프트 8·9번 항목(AI Research 파이프라인, RAG)의 상세 설계.

---

## 1. AI Research 파이프라인

```
Cron (research-news-hourly)
  → Research Job 생성 (research_jobs: status=queued)
  → Source Collection        # 등록된 article_sources에서 신규 글 수집
  → Duplicate Check           # source_url/제목 유사도로 중복 제거
  → Content Extraction        # 본문 추출(HTML → text)
  → AI Summary                # 요약 생성
  → Fact Extraction           # 구조화된 "확인된 사실" 추출 (facts jsonb)
  → Category Classification   # 카테고리 태깅, 관련 property/product 매칭
  → Embedding                 # generate-embedding 호출
  → Translation                # translate-content 호출 (I18N.md 3.1 참조)
  → Admin Review               # status: pending_review, Admin UI에서 승인/반려
  → Publish                    # status: published, published_at 기록
```

### 1.1 단계별 상태 전이 (articles.status)

`collected → processing → pending_review → published` (반려 시 `rejected`, 사유 기록 위치는 Phase 9 Admin UI 설계 시 확정 — 현재 스키마엔 `reviewed_by`만 존재, 반려 사유 컬럼 추가 여부는 미결정).

### 1.2 각 단계의 실행 주체

| 단계 | 실행 위치 |
|---|---|
| Cron 트리거 | Supabase Cron → `research-news` Edge Function 호출 |
| Source Collection / Duplicate Check / Content Extraction | `research-news` 내부 로직 |
| AI Summary / Fact Extraction / Category Classification | `summarize-article` Edge Function (LLM 호출) |
| Embedding | `generate-embedding` Edge Function |
| Translation | `translate-content` Edge Function |
| Admin Review / Publish | Admin Dashboard UI → RLS로 보호된 UPDATE (reviewer/admin role) |

모든 단계는 `research_jobs`에 진행상황(`stats jsonb`)과 실패 시 `error`를 기록해 Cron 실행상태 추적 요구사항(마스터 프롬프트 18번)을 충족한다.

---

## 2. 원문 Source 연결 (필수 요구사항)

AI가 생성/가공한 모든 콘텐츠는 원문 출처를 잃지 않는다:

- `source_url`, `source_domain`, `source_title`, `source_published_at`을 `articles` row에 필수 저장.
- `article_sources`에 도메인 단위 신뢰도(`trust_score`)를 관리해, 향후 낮은 신뢰도 소스는 자동 수집 대상에서 제외하거나 리뷰 우선순위를 낮추는 등 운용 가능.
- 사용자에게 노출되는 모든 AI 콘텐츠 화면(기사 상세, AI 채팅 답변)에는 출처 링크를 반드시 표시한다 — `ai-property-search` 응답의 `sources[]` 필드가 이를 강제(API.md 3번 참조).

---

## 3. 사실(Fact) vs 추론(Inference) 구분

- `articles.facts`(jsonb): AI가 원문에서 **직접 추출**한 구조화된 사실(예: "A 프로젝트 착공일: 2026-03", "B 지역 평균 임대수익률: 5.2%") — 원문에 명시된 내용만 포함, LLM의 해석/예측은 배제.
- `articles.summary`(text): AI가 **요약/재구성**한 문장 — 원문의 뉘앙스를 압축하는 과정에서 일부 해석이 개입될 수 있음을 전제.
- `ai-property-search`의 응답에는 `is_inference: boolean` 플래그를 포함해, LLM이 여러 출처를 종합해 **추론**한 답변인지 단일 사실을 그대로 전달하는지 클라이언트 UI에서 구분 표시할 수 있게 한다(예: "AI 분석" 배지 vs "출처 원문" 배지).
- 이 구분은 투자상품처럼 법적 민감도가 높은 콘텐츠에서 특히 중요 — 자동 생성 요약이 확정 사실처럼 보이지 않도록 UI 레벨에서도 disclaimers를 표시(`calculate-investment` 응답의 `disclaimers[]`와 동일한 취지).

---

## 4. RAG (Retrieval-Augmented Generation)

### 4.1 임베딩 대상

- `properties.embedding`: 제목+설명+주요 스펙을 결합한 텍스트.
- `articles.embedding` / `article_embeddings`(청크 단위): 본문 전체 또는 분할 청크.
- `investment_products.embedding`: 상품 설명+투자구조 요약.

임베딩 모델/차원은 LLM/Embedding Provider 확정 후 결정(DATABASE.md 미결정 항목 3 참조, 현재 `vector(1536)`은 잠정값).

### 4.2 질의 처리 흐름 (마스터 프롬프트 9번)

```
사용자 자연어 질문
  → Query Embedding
  → Vector Search (pgvector: properties/articles/article_embeddings, ivfflat 인덱스)
  → Property Search (구조화 필터 병행 — 가격/지역 등 명시적 조건이 감지되면 구조화 쿼리도 함께 실행)
  → Investment Search (investment_products 구조화 + 벡터 검색)
  → Market Search (market_indicators, exchange_rates 최신값)
  → Source Search (관련 article 원문 링크 확보)
  → LLM (검색된 컨텍스트 + 출처 메타데이터를 프롬프트에 주입, "출처 없는 주장 금지" 지시 포함)
  → Answer (+ sources[] + is_inference)
```

- 검색 결과가 비어있거나 신뢰도가 낮으면, LLM이 추측성 답변을 생성하지 않고 "관련 정보를 찾지 못했다"는 안전한 fallback을 반환하도록 프롬프트 설계(원칙 1 "추측하지 않는다"를 AI 응답에도 동일 적용).
- 대화 컨텍스트(`conversation_id`)를 유지할지(멀티턴) 단발 질의로 한정할지는 Phase 6 UX 설계에서 확정 — 이 문서에서는 API 시그니처에 `conversation_id?`만 예비로 열어둠.

---

## 5. Admin Review UX 요구사항 (Phase 9 연계)

- Reviewer는 `pending_review` 상태의 article을 리스트로 확인, 원문(source_url), AI 요약, 추출된 facts, 자동 매칭된 관련 property/investment_product를 한 화면에서 검토.
- 승인 시 `published`로 전이 + `published_at` 기록, 반려 시 `rejected` + (반려 사유 저장 방식은 미결정, 최소한 `system_logs`나 별도 코멘트 필드 필요 여부 Phase 9에서 확정).
- 번역본(`article_translations`)도 원문 승인 이후에만 공개 노출(원문 미승인 상태에서 번역만 먼저 노출되지 않도록 RLS 조건은 "원문 article.status = published"를 참조).

---

## 6. 운영/비용 고려사항

- LLM 호출 비용 관리를 위해: 임베딩은 신규/변경된 콘텐츠에만 재생성(변경 감지 필요 — 예: content hash 비교), `ai-property-search`는 rate limit + 짧은 캐시(API.md 참조).
- `research-news-hourly`의 수집 대상 소스 수/빈도는 운영 중 조정 가능하도록 `article_sources.is_active`로 개별 on/off.

---

## 7. 미결정 항목

1. LLM/Embedding Provider 및 임베딩 차원 확정.
2. 반려 사유 저장 위치(컬럼 추가 여부).
3. AI 채팅 멀티턴 대화 지원 여부 및 `conversation_id` 저장 테이블 필요 여부.
4. properties/investment_products 자동 번역과 마찬가지로, 매물/상품 임베딩 대상 텍스트 조합 최종안.
5. 콘텐츠 변경 감지(재임베딩 트리거) 방식 — content hash 컬럼 추가 여부.
