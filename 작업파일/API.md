# API.md — Viet's (Supabase Edge Functions)

버전: v0.1 (설계 초안, 함수 미구현) · 작성일: 2026-08-26

원칙 15에 따라 모든 외부 API 호출과 금전/AI 로직은 Edge Function을 경유한다. 클라이언트는 Supabase 클라이언트 SDK로 (a) RLS가 허용하는 범위의 직접 SELECT, (b) 아래 Edge Function 호출, 두 가지 경로만 사용한다.

## 공통 규약

- **인증**: 모든 함수는 `Authorization: Bearer <supabase JWT>` 헤더를 검증한다(공개 함수는 예외 명시). 검증 실패 시 401.
- **응답 포맷**: `{ data, error }` 형태로 통일. 에러는 `{ code, message }` — 내부 스택트레이스/DB 에러 원문은 클라이언트에 노출하지 않는다(민감정보 비노출 원칙).
- **Rate Limit**: 함수별 표에 명시된 한도를 공통 미들웨어(`_shared/rateLimit.ts`, IP+user_id 기준, Postgres 테이블 또는 Upstash 등 외부 스토어로 구현 — Phase 2에서 확정)로 적용, 초과 시 429.
- **로깅**: 모든 호출은 `api_logs`에 `function_name, user_id, status_code, duration_ms`를 기록. 요청/응답 body는 기록하지 않는다.
- **캐싱**: "Cache" 열에 전략 명시. 기본은 응답에 `Cache-Control` 헤더 + 클라이언트 React Query staleTime, 조회 비용이 큰 함수는 DB 캐시 테이블(예: exchange_rates) 사용.

---

## 1. Property

### `get-property-search`
지도/리스트 검색(위치 반경, 카테고리, 가격, 수익률 필터).
- Auth: 공개(익명 허용)
- Input: `{ bbox? , center?: {lat,lng}, radius_km?, category?, price_min?, price_max?, yield_min?, status? default 'active', cursor?, limit? }`
- Output: `{ items: Property[], next_cursor }`
- 내부: PostGIS `ST_DWithin` / bbox 쿼리 + RLS(active만).
- Cache: 60s (검색 파라미터 해시 키), CDN/Edge cache 가능.
- Rate limit: 60 req/min/IP.

### `get-property-detail`
- Auth: 공개
- Input: `{ property_id }`
- Output: Property + images + documents(서명 URL 발급 포함, private 문서는 로그인 필요 시 별도 체크) + 연관 investment_products 요약.
- Cache: 30s.

### `search-properties`
자연어/키워드 기반 검색(`get-property-search`의 구조화 필터와 달리 텍스트 검색 + 임베딩 유사도 결합). Phase 6(RAG)와 연계.
- Auth: 공개
- Input: `{ query: string, filters?, limit? }`
- Output: `{ items }`
- Cache: 없음(질의마다 다름), 대신 embedding 계산 결과를 30분 캐시.

### `geocode-property`
Admin/매물 등록 플로우에서 주소→좌표 변환(Google Geocoding API 프록시).
- Auth: Admin/Editor 전용
- Input: `{ address }`
- Output: `{ lat, lng, formatted_address }`
- Rate limit: 30 req/min/user (Google API 비용 보호).
- Cache: 주소 문자열 기준 7일 캐시(DB 테이블).

---

## 2. Investment

### `calculate-investment`
투자 시뮬레이션(실제 거래 없음, 정보 제공용 — 원칙 14의 "정보제공" 영역).
- Auth: 로그인 필요
- Input: `{ product_id, amount, currency }`
- Output: `{ expected_units, projected_dividend_schedule, fees, disclaimers[] }`
- Rate limit: 30 req/min/user.
- Cache: 없음(순수 계산, 부작용 없음).

### `create-investment-order`
**금융거래 진입점(Server-Only write 경로).**
- Auth: 로그인 필요, KYC 상태 체크(향후)
- Input: `{ product_id, amount, currency, order_type }`
- Output: `{ order_id, status }`
- 내부 로직: (1) product 모집 가능 여부/최소투자금 검증 → (2) `investment_orders` INSERT(status=pending) → (3) 결제 처리(향후 PG 연동 지점, 현재 범위 밖 — **미확정 항목**) → (4) 확정 시 `investment_transactions` INSERT + `investment_holdings` 갱신을 **하나의 DB 트랜잭션**으로 처리.
- Rate limit: 10 req/min/user (금융 액션이므로 엄격).
- Idempotency: `Idempotency-Key` 헤더 필수, 중복 호출 시 동일 order 반환(중복 주문 방지).

### `get-portfolio`
- Auth: Owner-Only(본인)
- Input: 없음(JWT의 user_id 사용)
- Output: `{ holdings[], total_invested, current_value, transactions_recent[] }`
- Cache: 없음(항상 최신, 금전 데이터).

### `get-dividends`
- Auth: Owner-Only
- Input: `{ status?, from?, to? }`
- Output: `{ items }`
- Cache: 없음.

### `create-investment-product` (Admin)
- Auth: Admin/Editor 전용
- Input: 상품 전체 필드
- Output: `{ product_id, status: 'draft' }`
- 감사: `audit_logs` 자동 기록(트리거) + 함수 내 actor 컨텍스트 보강.

---

## 3. AI / Research (Phase 6, 8)

### `ai-property-search`
RAG 자연어 질의 응답(마스터 프롬프트 9번 Flow).
- Auth: 로그인 권장(익명 제한된 quota로 허용 가능 — 정책 확정 필요)
- Input: `{ query, conversation_id? }`
- Output: `{ answer, sources: [{type, id, title, url}], is_inference: boolean }`
- 내부: Query embedding → pgvector 유사도 검색(properties/articles/article_embeddings) → 구조화 데이터 검색(investment_products) → LLM 프롬프트 조립(반드시 출처 인용 강제) → 답변.
- Rate limit: 15 req/min/user (LLM 비용 보호).
- Cache: 동일 query 5분 캐시(선택적).

### `research-news`
Cron 트리거 전용(사용자 직접 호출 없음). 뉴스 소스 수집 → `research_jobs` 생성 → `articles`(status=collected) 삽입.
- Auth: Server-Only(Cron 서명 검증).

### `summarize-article`
- Auth: Server-Only (research-news 파이프라인 또는 Admin 수동 재실행)
- Input: `{ article_id }`
- Output: 업데이트된 article(summary, facts, category) — status는 'pending_review'로 전이(Admin 승인 전 미공개 원칙).

### `generate-embedding`
공용 임베딩 생성 유틸(articles/properties/investment_products에서 재사용).
- Auth: Server-Only
- Input: `{ target_table, target_id, text }`
- Output: `{ success }`

### `translate-content`
UI 번역이 아닌 **콘텐츠 번역**(article_translations 등) 전용 — 원칙 10 "UI Translation과 Content Translation 분리" 대응. UI 문자열은 앱 내 i18n 리소스 파일로 관리하며 이 함수를 거치지 않는다(I18N.md 참조).
- Auth: Server-Only
- Input: `{ target_table, target_id, source_language, target_languages[] }`
- Output: `{ translated: { [lang]: {...} } }`

---

## 4. Market Data

### `get-exchange-rate`
- Auth: 공개
- Input: `{ base, quote? default 'VND' }`
- Output: `{ rate, fetched_at }`
- Cache: DB(`exchange_rates`)가 이미 캐시 역할, 함수는 최신 row 조회 + 5분 응답 캐시.

### `refresh-exchange-rate`
Cron 전용, 외부 환율 API 조회 → `exchange_rates` INSERT.
- Auth: Server-Only.

### `get-market-data`
- Auth: 공개
- Input: `{ indicator_type?, region?, period_from?, period_to? }`
- Output: `{ items }`
- Cache: 5분.

---

## 5. Push

### `send-push` / `send-bulk-push`
- Auth: Admin(campaign) 또는 Server-Only(시스템 트리거성 알림 — 배당 지급, 모집마감 등은 해당 도메인 함수 내부에서 이 함수를 호출)
- Input(`send-bulk-push`): `{ campaign_id }` 또는 `{ template_code, target_type, target_filter, data }`
- Output: `{ queued_count }`
- 내부: `push_topics`/세그먼트 쿼리로 대상 `push_tokens` 확정 → FCM 발송 → `notification_deliveries` 기록.
- Rate limit: Admin 수동 발송은 5 req/min/user(오발송 방지), 예약발송은 Cron이 트리거.

---

## 6. 함수-테이블 매핑 요약

| 함수 | 주요 접근 테이블 | write 권한 |
|---|---|---|
| get-property-search / get-property-detail / search-properties | properties, property_images | Read only |
| geocode-property | (외부 API only) | - |
| calculate-investment | investment_products, investment_terms | Read only |
| create-investment-order | investment_orders, investment_transactions, investment_holdings | **Write (Server-Only)** |
| get-portfolio / get-dividends | investment_holdings, investment_transactions, dividends | Read only |
| create-investment-product | investment_products | Write (Admin) |
| ai-property-search | properties, articles, article_embeddings, investment_products | Read only |
| research-news / summarize-article / generate-embedding / translate-content | articles, article_translations, research_jobs | Write (Server-Only) |
| get-exchange-rate / refresh-exchange-rate | exchange_rates | refresh만 write |
| get-market-data | market_indicators | Read only |
| send-push / send-bulk-push | notification_campaigns, notification_deliveries, push_tokens | Write (Server-Only) |

---

## 7. 미결정 항목

1. `create-investment-order`의 실제 결제(PG) 연동 방식 — 베트남 현지 PG/계좌이체 등 사용자 확인 필요.
2. `ai-property-search` 익명 사용자 허용 여부 및 quota 정책.
3. Rate limit 저장소(Postgres 테이블 vs Redis/Upstash) — 비용/운영 부담 고려해 Phase 2에서 결정.
4. LLM Provider 확정 전까지 `ai-property-search`/`summarize-article`/`translate-content`는 인터페이스만 고정, 내부 구현은 provider 확정 후.
