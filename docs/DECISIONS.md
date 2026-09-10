# DECISIONS.md — 미결정 항목 분석

버전: v0.7 · 작성일: 2026-08-26 · 최종수정: 2026-09-10 (D10 범위 확정 / D47 확정, D50·D51 편입)
7개 설계 문서(ARCHITECTURE/DATABASE/API/SECURITY/I18N/AI_RESEARCH/QA)의 "미결정 항목"을 전수 취합, 중복 항목은 통합했다. STEP 03 Pre-Audit에서 사용자의 내부개발회의 기획 스토리보드(PPTX)를 검토해 D28~D36을 추가했다. STEP 4-1B/4-1C(Database Foundation Pre-Audit)에서 발견된 신규 gap을 D37~D38로 추가했다. VIETS MASTER ARCHITECTURE 추가요구사항(2026-09-01, Agency Permission/Investor Customer Model/Investment Notification/Admin Push)을 검토해 D39~D48을 추가했다. 사용자의 "FINAL IMMUTABLE RULE — ORIGINAL PROPERTY DATA" 지시(2026-09-09)를 반영해 D49를 추가했다. 같은 날 MASTER_PROJECT_AUDIT(전체 프로젝트 종합 감사)에서 발견한 신규 리스크를 D50~D51로 추가했다. **2026-09-10 사용자 결정으로 D10(범위)과 D47이 확정되어 Investment 도메인 구현에 착수했다.** 총 51개 항목.

## 변경 이력

| 일자 | 항목 | 변경 내용 | 반영 파일 |
|---|---|---|---|
| 2026-08-26 | D5 | PENDING → **ACCEPTED** (dev 1개로 시작, staging/production은 출시 준비 단계에서 분리) | ARCHITECTURE.md §5 |
| 2026-08-26 | D24 | PENDING → **ACCEPTED** (Cloud=분석/설계/코드작성/리뷰, 데스크톱 연결 폴더=실제 install/실행/디바이스 테스트/빌드) | QA.md §2, ARCHITECTURE.md §5 |
| 2026-08-26 | D10 | 내용 보강(변경 아님) — 스토리보드(PPTX 슬라이드 31)에 따르면 실제 자금이동은 2차 이후로 명시되어 있어, MVP 범위의 investment_orders는 "정보/의향" 수준일 가능성 — 사용자 확인 필요, PENDING 유지 | 없음(확인 대기) |
| 2026-08-26 | D28~D36 | 신규 등록(PENDING) — STEP03_PRE_AUDIT.md에서 발견한 기획 스토리보드(PPTX 슬라이드 32)의 "개발 착수 전 의사결정 8항목"을 반영 | STEP03_PRE_AUDIT.md §10(B) |
| 2026-08-27 | D9 | PENDING → **ACCEPTED** (PRIMARY=create-investment-order Edge Function 내부 단일 DB 트랜잭션, DB 트리거는 SECONDARY 감사/보정용) | DATABASE.md §3/§10/§11, API.md create-investment-order |
| 2026-08-27 | D6 | PENDING → **ACCEPTED** (EXCLUDE — property_locations 생성하지 않음, properties 구조 유지) | DATABASE.md §2/§11 |
| 2026-08-27 | D8 | PENDING → **ACCEPTED** (INTEGRATE — user_devices로 통합, push_tokens 제거) | DATABASE.md §1/§7/§11, API.md send-push/send-bulk-push |
| 2026-08-27 | D4 | 차원(dimension) 부분만 PENDING → **ACCEPTED**(1536 확정). Provider 부분은 PENDING 유지 | DATABASE.md §11 |
| 2026-08-27 | D37 | 신규 등록 및 **ACCEPTED** — investment_products.currency 컬럼 ADD(default 미정) | DATABASE.md §3 |
| 2026-08-27 | D38 | 신규 등록 및 **ACCEPTED** — investment_transactions 거래시점 FX 컬럼 NOT REQUIRED(현재), D10 확정 시 재검토 | DATABASE.md §3 |
| 2026-09-01 | D39~D45 | 신규 등록 및 **ACCEPTED** — VIETS MASTER ARCHITECTURE 추가요구사항(Agency Permission/Investor Model/Investment Notification/Admin Push/Chat)의 구조적 설계 결정. 상세는 본 문서 최하단 "VIETS MASTER ARCHITECTURE — 추가요구사항 반영" 섹션 참조 | DATABASE.md §7/§12/§13, ARCHITECTURE.md §7, DEVELOPMENT_MASTER_CHECKLIST.md(신규) |
| 2026-09-01 | D46~D48 | 신규 등록(PENDING) — Agency 온보딩 플로우/Investor 전환 조건/TTS-Voice 확장은 사업 결정 필요, 구조만 준비 | DEVELOPMENT_MASTER_CHECKLIST.md(신규) |
| 2026-09-09 | D49 | 신규 등록 및 **ACCEPTED** — 매물명(Property Name)/매물 주소(Property Address)는 언어 변경과 무관하게 자동번역 금지(원본 값 그대로 유지)하는 불변 규칙 확정. D17(properties 자동 번역 적용)의 범위를 이름/주소와 설명/옵션으로 분리 — 이름/주소는 이번 건으로 확정, 설명/옵션은 계속 PENDING | I18N.md §3.2/§3.4, DEVELOPMENT_MASTER_CHECKLIST.md |
| 2026-09-09 | D50~D51 | 신규 등록 및 **ACCEPTED**(방향만 — 실행은 사용자 승인 필요) — MASTER_PROJECT_AUDIT에서 발견된 Git 백업 부재(D50)와 Chat DB의 migration 외부 생성(D51)을 프로젝트 최우선 리스크로 공식 등록. **2026-09-10 갱신: D50은 STEP 00 실행으로 해소됨**(로컬 커밋 + `github.com/Kimchandong/Viets` 원격 연결 완료) | MASTER_PROJECT_AUDIT.md, DEVELOPMENT_STORYBOARD.md STEP 00/STEP 07 |
| 2026-09-10 | D10 | **범위 부분 PENDING → ACCEPTED** — 1차 범위를 "투자 의향 접수만"(금액·연락처 저장, 실제 결제/정산 없음)으로 확정. PG 사업자 선정·정산 구조는 2차 작업으로 분리(PENDING 유지). 이 결정에 따라 `investment_transactions`/`investment_holdings`/`dividends` 3개 테이블을 이번 migration에서 제외했고, `investment_orders`는 Edge Function(Server-Only) 대신 클라이언트가 `status='pending'` 행만 직접 생성하도록 구현했다 | DATABASE.md §3, `supabase/migrations/20260910070155_investment_domain.sql`, DEVELOPMENT_STORYBOARD.md STEP 05/06 |
| 2026-09-10 | D47 | **PENDING → ACCEPTED** — "첫 투자 신청 시 investors 자동 생성"(심사 없음, 위 (b)안). `investment_orders` AFTER INSERT 트리거 `ensure_investor_on_order()`(SECURITY DEFINER)로 구현. investors 테이블에는 클라이언트 INSERT 정책을 두지 않아 이 트리거로만 행이 생성된다 | DATABASE.md §1(investors), `supabase/migrations/20260910070155_investment_domain.sql` |

D1~D27 중 D5, D24를 제외한 나머지는 2026-08-26 시점 결정에서 변경되지 않았다(사용자 지시 4, 당시 기준). 2026-08-27 STEP 4-1D에서 D9/D6/D8/D4(차원 부분)이 추가로 ACCEPTED되었고, 신규 항목 D37/D38이 등록과 동시에 ACCEPTED되었다. 2026-09-01 VIETS MASTER ARCHITECTURE 추가요구사항 검토에서 D39~D45가 등록과 동시에 ACCEPTED, D46~D48은 PENDING으로 등록되었다. D2(Admin 프레임워크), D4 Provider 부분(LLM/Embedding Provider 계약), D10(결제 PG)은 여전히 해당 Phase 착수 전까지 보류 상태를 유지한다(사용자 지시 5).

우선순위 범례: 🔴 지금 결정 필요(블로킹) · 🟡 조기 결정 권장(늦어도 Phase 2 전) · ⚪ 나중 결정 가능(해당 Phase 착수 전)

## 요약 (빠른 스캔)

| # | 항목 | 우선순위 | 추천안 (한 줄) |
|---|---|---|---|
| D1 | Expo Router vs React Navigation | ⚪ | Expo Router |
| D2 | Admin Dashboard 프레임워크 | ⚪ | Next.js |
| D3 | 클라이언트 전역 상태 라이브러리 | ⚪ | Zustand |
| D4 | LLM/Embedding Provider·차원 | 차원: ✅ ACCEPTED / Provider: 🟡 | 차원 1536 확정 완료 + 인터페이스 추상화(Provider는 별도 PENDING) |
| D5 | Supabase 프로젝트 생성/환경 분리 | ✅ ACCEPTED | dev 1개로 시작, staging/production은 출시 준비 단계에서 분리 |
| D6 | property_locations 테이블 필요 여부 | ✅ ACCEPTED | 제외(미생성) — 확정 |
| D7 | investment_terms 구조화 수준 | ⚪ | 우선 jsonb |
| D8 | user_devices vs push_tokens 중복 | ✅ ACCEPTED | 통합(push_tokens 제거) — 확정 |
| D9 | investment_holdings 재계산 방식 | ✅ ACCEPTED | Edge Function 트랜잭션(PRIMARY), DB 트리거는 SECONDARY — 확정 |
| D10 | 결제(PG) 연동 방식 | 범위: ✅ ACCEPTED(2026-09-10) / PG 선정: ⚪(사업결정) | **1차 = "투자 의향 접수만"**(금액·연락처 저장, 결제 없음) 확정. 실제 PG·정산은 2차로 분리 |
| D11 | ai-property-search 익명 허용 | ⚪ | 허용 + 낮은 quota |
| D12 | Rate limit 저장소 | ⚪ | 우선 Postgres |
| D13 | Secret 보관/로테이션 절차 | ⚪ | Supabase Secrets |
| D14 | Admin MFA 강제 방식 | ⚪ | admin 이상 하드 블록 |
| D15 | 세션 관리 UX 범위 | ⚪ | 1차 출시 범위 제외 |
| D16 | i18next 채택 | ⚪ | 채택 |
| D17 | properties 자동 번역 적용(설명/옵션 등, 이름/주소 제외 — D49 참조) | ⚪ | 설명/옵션은 적용 + 배지 표시(이름/주소는 D49로 별도 확정: 번역 금지) |
| D18 | 미번역 콘텐츠 UI 표시 | ⚪ | 원문 노출 + 배지 |
| D19 | Admin UI 다국어 확장 | ⚪ | 1차 ko/en만 |
| D20 | 반려 사유 저장 위치 | ⚪ | articles에 컬럼 추가 |
| D21 | AI 채팅 멀티턴 지원 | ⚪ | 1차 단발 질의만 |
| D22 | 임베딩 텍스트 조합 | ⚪ | 표준 템플릿으로 시작 |
| D23 | 재임베딩 트리거 방식 | ⚪ | content_hash 비교 |
| D24 | 코드/QA 실행 환경 | ✅ ACCEPTED | Cloud=분석/설계/코드작성/리뷰, 데스크톱 연결 폴더=install/실행/디바이스 테스트/빌드 |
| D25 | E2E 도구 | ⚪ | Maestro |
| D26 | Performance 기준치 | ⚪ | 잠정 수치로 시작 |
| D27 | 대표 기기 매트릭스 | ⚪ | 저가형+플래그십 각 1종 |
| D28 | 브랜드명/로고/Accent Color | ⚪(사업결정) | 추천 불가 — 사용자 결정 필요 |
| D29 | 서비스 국가 및 법적 사업모델 | ⚪(사업결정) | 추천 불가 — 사용자/법무 결정 필요 |
| D30 | REIT vs 공동투자 vs 정보 플랫폼 포지션 | ⚪(사업결정) | 추천 불가 — 사용자 결정 필요 |
| D31 | 투자상품 데이터 출처·검수 책임 | ⚪ | 초기엔 Admin(운영진) 직접 입력 + 수동 검수 |
| D32 | AI Research 허용 출처 범위 | ⚪ | 공신력 있는 언론/정부/부동산 전문매체 화이트리스트로 시작 |
| D33 | Translation API Provider | ⚪ | Google Cloud Translation으로 시작(LLM 번역과 병행 검토) |
| D34 | Exchange Rate 데이터 제공 API | ⚪ | 공개 환율 API(예: exchangerate host 계열) 후보로 시작 |
| D35 | Admin 운영조직과 권한 체계 | ⚪(사업결정) | 추천 불가 — 사용자 조직 결정 필요 |
| D36 | MVP 출시 범위 최종 확정 | ⚪(사업결정) | 스토리보드 슬라이드 31안(정보·지도·AI뉴스·시장·상품정보·다국어·Push·Admin)을 1차 제안 |
| D37 | investment_products.currency 컬럼 추가 여부 | ✅ ACCEPTED | ADD — currency text NOT NULL, default 미정 |
| D38 | investment_transactions 거래시점 FX 컬럼 추가 여부 | ✅ ACCEPTED | NOT REQUIRED(현재), D10 확정 시 재검토 |
| D39 | Agency Approval과 기능별 Permission 분리 구조 | ✅ ACCEPTED | agencies.approval_status ≠ agency_permissions(기능별 토글), EAV형 구조로 확장 가능하게 설계 |
| D40 | User/Agency Member/Investor 독립 관계 모델 | ✅ ACCEPTED | account_type 단일 컬럼 금지 — profiles/agency_members/investors 3개 독립 테이블 조합 |
| D41 | Investment Notification 저장 위치 | ✅ ACCEPTED | 신규 테이블 대신 기존 notifications 확장(product_id/campaign_id 컬럼 추가) |
| D42 | SYSTEM_NOTIFICATION vs ADMIN_PUSH 구분 방식 | ✅ ACCEPTED | notifications.campaign_id 유무로 구분, 생성 로직만 분리하고 inbox는 통합 유지 |
| D43 | Admin Push Campaign 테이블 재설계 | ✅ ACCEPTED | notification_campaigns → admin_push_campaigns로 확장(title/content/language/집계 컬럼 추가, target_type 교체) |
| D44 | Property 1:1 상담(Chat) 최초 스키마 | ✅ ACCEPTED | property_conversations/property_messages 신규 도입, chat 권한은 agency_permissions로 게이팅 |
| D45 | notification_preferences NULL 중복 방지 | ✅ ACCEPTED | partial unique index 2개(product_id IS NULL / NOT NULL)로 구현 예정(설계 노트) |
| D46 | Agency 가입/온보딩 플로우 | ⚪(사업결정) | 추천 불가 — Admin 대행등록 vs 자체가입 신청, 사업 프로세스 결정 필요 |
| D47 | Investor 전환 조건 | ✅ ACCEPTED(2026-09-10) | **첫 투자 신청 시 자동 생성**(심사 없음) — investment_orders INSERT 트리거로 구현 완료 |
| D48 | TTS/Voice Push 확장 범위 | ⚪ | 지금 스키마 변경 없음 — notification_channel enum에 향후 'voice' 추가 여지만 남김 |
| D49 | Property Name/Address 자동번역 금지(불변 규칙) | ✅ ACCEPTED | 매물명/주소는 언어 변경과 무관하게 원본 값 그대로 — 언어별 사본 컬럼(property_name_ko 등) 생성 금지 |
| D50 | Git 저장소 백업 부재 — 최우선 리스크 | ✅ ACCEPTED · **2026-09-10 해소 완료** | 로컬 커밋 + 원격 저장소(`github.com/Kimchandong/Viets`) 연결/push 완료 |
| D51 | Chat DB를 migration으로 편입 | ✅ ACCEPTED(방향) | SQL Editor 1회 실행분을 정식 migration으로 전환 — STORYBOARD STEP 07에서 실행 예정 |

---

## 상세

### D1. Expo Router vs React Navigation
- **영향 파일**: ARCHITECTURE.md (2.1, 4번 표)
- **지금 결정 필요**: 아니오
- **나중 결정 가능**: 예 — Phase 3(Navigation) 착수 전까지
- **미결정 시 문제**: 없음(Phase 1~2엔 영향 없음). Phase 3 착수는 못함.
- **추천안**: Expo Router
- **추천 근거**: Push 알림의 Deep Link(마스터 프롬프트 11번)를 파일기반 라우팅으로 자연스럽게 매핑 가능, Expo SDK와 통합성 우수, 팀이 이미 Expo를 채택했으므로 생태계 일관성 유지
- **결정 후 변경 파일**: ARCHITECTURE.md 2.1/4

### D2. Admin Dashboard 프레임워크
- **영향 파일**: ARCHITECTURE.md (2.4, 4번 표)
- **지금 결정 필요**: 아니오
- **나중 결정 가능**: 예 — Phase 9 착수 전까지
- **미결정 시 문제**: 없음(Phase 1~8과 독립적)
- **추천안**: Next.js (App Router)
- **추천 근거**: 서버 컴포넌트로 민감한 admin 로직을 서버측에서 처리하기 쉬움, Supabase 서버사이드 클라이언트와 통합 사례 풍부
- **결정 후 변경 파일**: ARCHITECTURE.md 2.4/4

### D3. 클라이언트 전역 상태 라이브러리
- **영향 파일**: ARCHITECTURE.md (2.2, 4번 표)
- **지금 결정 필요**: 아니오
- **나중 결정 가능**: 예 — Phase 2 스캐폴딩 직전
- **미결정 시 문제**: 없음(경미한 지연 정도)
- **추천안**: Zustand
- **추천 근거**: React Query가 서버 상태를 전담하므로 전역 상태 범위가 작음(언어/테마/세션 캐시 정도) — 보일러플레이트가 적은 Zustand가 적합, Redux Toolkit은 이 규모엔 과설계
- **결정 후 변경 파일**: ARCHITECTURE.md 2.2/4

### D4. LLM/Embedding Provider 및 임베딩 차원
- **상태**: 차원(dimension) 부분만 ✅ **ACCEPTED** (2026-08-27) — Provider(제공자) 선택은 PENDING 유지(Phase 6 착수 전 별도 결정)
- **확정 내용(차원만)**: Embedding 차원 = **1536**. `properties`/`investment_products`/`articles`/`article_embeddings`의 `vector(1536)` 정의를 그대로 유지한다. LLM/Embedding Provider 자체(OpenAI/Anthropic/기타)는 이 결정과 분리된 별도 PENDING 항목으로 유지한다.
- **영향 파일**: ARCHITECTURE.md(4번 표), DATABASE.md(0번 enum 아님이지만 vector 차원, articles/properties/investment_products.embedding, 11번), API.md(ai-property-search 등 4개 함수, 7-4), AI_RESEARCH.md(4.1, 7-1)
- **지금 결정 필요**: "차원 수"는 예 — 이번 결정으로 해소됨. "제공자 계약" 자체는 아니오(Phase 6 착수 전까지 유지)
- **나중 결정 가능**: 차원 수는 아니오(이번 결정으로 확정). Provider는 예 — Phase 6 착수 전까지
- **미결정 시 문제**: 차원 수 관련 문제는 해소됨. Provider 관련 문제는 기존과 동일하게 남아있음(Phase 6에서 재확인)
- **추천안 (차원 부분 채택됨)**: 차원은 1536으로 확정, provider는 Edge Function 내부에 인터페이스로 추상화해 계약 체결 후 교체 가능하게 설계(유지)
- **추천 근거**: 대부분의 주요 임베딩 모델이 1536 또는 그 이하 차원을 지원(다른 모델 채택 시에도 truncation으로 대응 가능), 인터페이스 추상화로 조기 lock-in 리스크 최소화
- **결정 후 변경 파일**: DATABASE.md(차원 확정 표기, 반영 완료). Provider 관련(API.md 구현 세부, AI_RESEARCH.md provider 명시, ARCHITECTURE.md 기술스택 표)은 Provider 결정 시 별도 반영

### D5. Supabase 프로젝트 생성 및 dev/staging/prod 분리
- **상태**: ✅ **ACCEPTED** (2026-08-26)
- **확정 내용**: 초기에는 development Supabase 프로젝트 1개로 시작한다. staging/production 환경 분리는 실제 서비스 출시 준비 단계에서 진행한다.
- **영향 파일**: ARCHITECTURE.md(5번)
- **지금 결정 필요**: 예 — Phase 2(DB/RLS/Auth) 착수 자체가 이 결정에 달려 있음
- **나중 결정 가능**: 아니오(블로킹) — 단, "언제 staging/production을 분리할지"는 출시 준비 단계로 재확정 가능
- **미결정 시 문제**: Supabase 프로젝트가 없으면 migration 적용, RLS 테스트, OAuth 연동 등 Phase 2 전체가 시작 불가
- **추천안 (채택됨)**: 우선 dev 프로젝트 1개로 시작, 프로덕션 출시가 가까워지는 시점(Phase 11 전후)에 staging/production 분리
- **추천 근거**: 초기엔 개발 속도가 우선이고 Supabase CLI로 마이그레이션 재현이 쉬워 나중에 분리해도 부담이 적음
- **결정 후 변경 파일**: ARCHITECTURE.md 5번 (반영 완료)

### D6. property_locations 테이블 필요 여부
- **상태**: ✅ **ACCEPTED** (2026-08-27)
- **확정 내용**: EXCLUDE — property_locations 테이블을 생성하지 않는다. properties의 기존 province_id/district_id/ward_id/latitude/longitude/geom 구조를 그대로 유지한다.
- **영향 파일**: DATABASE.md(2번, 11번)
- **지금 결정 필요**: 예 — Phase 2(STEP 4-2) 마이그레이션 대상 테이블 목록에 포함 여부를 결정해야 함(이번 결정으로 해소됨)
- **나중 결정 가능**: 아니오(이번 결정으로 확정) — 향후 실사용 요구가 확인되면 추가 마이그레이션으로 재도입 가능
- **미결정 시 문제**: 해소됨
- **추천안 (채택됨)**: 제외(생성하지 않음), 필요해지면 추가 마이그레이션으로 도입
- **추천 근거**: 원칙 8(DB 변경은 migration으로 관리)과 부합 — properties의 단일 위치 컬럼으로 현재 요구사항(PostGIS 반경검색 포함, STEP 4-1C에서 재확인)이 충분히 커버됨
- **결정 후 변경 파일**: DATABASE.md 2번/11번 (반영 완료)

### D7. investment_terms 구조화 수준
- **영향 파일**: DATABASE.md(3번, 11번)
- **지금 결정 필요**: 아니오
- **나중 결정 가능**: Phase 5 착수 전, 실제 상품 약관 샘플 확보 후
- **미결정 시 문제**: 없음(Phase 2엔 최소 컬럼만 두고 Phase 5에서 alter 가능)
- **추천안**: 우선 `terms jsonb`로 시작, 이후 자주 쿼리/필터링되는 필드만 개별 컬럼으로 분리
- **추천 근거**: 초기엔 상품 유형별 약관 구조가 다를 가능성이 높아 유연한 jsonb가 안전, 쿼리 패턴이 확정되면 성능/제약조건을 위해 컬럼화하는 것이 표준적인 점진적 정규화 방식
- **결정 후 변경 파일**: DATABASE.md 3번

### D8. user_devices vs push_tokens 역할 중복
- **상태**: ✅ **ACCEPTED** (2026-08-27)
- **확정 내용**: INTEGRATE — `user_devices`를 정본 테이블로 유지하고 `push_tokens`를 제거한다. `user_devices`에 `is_active` 컬럼을 추가해 device/session lifecycle 정보와 push 발송 대상(delivery endpoint) 정보를 하나의 device record로 통합 관리한다.
- **영향 파일**: DATABASE.md(1번, 7번, 11번), API.md(send-push/send-bulk-push 대상 테이블)
- **지금 결정 필요**: 예 — Phase 2(STEP 4-2) 마이그레이션에서 두 테이블을 다 만들지, 통합할지 결정해야 재작업 방지(이번 결정으로 해소됨)
- **나중 결정 가능**: 아니오(이번 결정으로 확정)
- **미결정 시 문제**: 해소됨
- **추천안 (채택됨)**: 통합 — `user_devices`에 `push_token`/`is_active` 컬럼 유지, 별도 `push_tokens` 테이블 제거
- **추천 근거**: 기기(device)와 push token은 사실상 1:1이므로 분리 이점이 적고, 테이블 하나가 줄면 조인/정합성 관리가 단순해짐
- **결정 후 변경 파일**: DATABASE.md 1번/7번/11번(반영 완료), API.md send-push 대상 쿼리(반영 완료)

### D9. investment_holdings 재계산 방식(DB 트리거 vs Edge Function 트랜잭션)
- **상태**: ✅ **ACCEPTED** (2026-08-27)
- **확정 내용**: PRIMARY = `create-investment-order` Edge Function 내부의 단일 DB 트랜잭션(investment_orders 상태 처리 + investment_transactions INSERT + investment_holdings 갱신을 원자적으로 처리). DB 트리거는 SECONDARY — 감사/보정/방어적 검증 목적의 보조 수단으로만 사용하며, 정합성 데이터를 직접 생성하는 주 메커니즘으로 사용하지 않는다.
- **영향 파일**: DATABASE.md(3번, 10번, 11번), API.md(create-investment-order)
- **지금 결정 필요**: 예 — Phase 2(STEP 4-2) 마이그레이션에서 트리거를 PRIMARY로 만들지 여부와 직결(이번 결정으로 해소됨)
- **나중 결정 가능**: 아니오(방향은 이번 결정으로 확정) — 세부 구현(Edge Function 트랜잭션 코드)은 Phase 5에서 진행
- **미결정 시 문제**: 해소됨
- **추천안 (채택됨)**: Edge Function 내 단일 DB 트랜잭션, DB 트리거는 감사/보정용 보조 수단으로만 사용
- **추천 근거**: API.md의 Idempotency-Key 요구사항과의 일치, SECURITY.md §2 Server-Only 패턴과의 일치, 비즈니스 로직(수수료 계산·상태 전이 검증)을 TypeScript(Edge Function)에서 다루고 테스트하기 쉬움
- **결정 후 변경 파일**: DATABASE.md 3번/10번/11번(반영 완료), API.md create-investment-order 로직 상세화(반영 완료)

### D10. create-investment-order 결제(PG) 연동 방식
- **영향 파일**: API.md(2번, 7-1), DATABASE.md(investment_orders/transactions 상태값)
- **상태**: **범위 = ✅ ACCEPTED (2026-09-10)** / **PG 사업자 선정 = ⚪ PENDING(사업 결정)**
- **2026-09-10 확정 내용(사용자 결정)**: 1차 구현 범위를 **"투자 의향 접수만"**으로 확정한다 — 신청 금액과 연락처를
  저장하되 실제 결제·정산·자금이동은 하지 않는다(스토리보드 슬라이드 31의 "실제 자금이동은 2차 이후" 방향과 일치).
- **이 결정이 구현에 미친 영향(STEP 05, 2026-09-10 실행)**:
  1. DATABASE.md §3의 `investment_transactions` / `investment_holdings` / `dividends` 3개 테이블을 **생성하지 않았다** —
     결제가 없으면 행이 생길 수 없는 테이블이라, 빈 스키마를 미리 만들어 두지 않는다.
  2. `investment_orders`의 write 경로를 원안(Edge Function Server-Only, 원칙 13)이 아니라 **클라이언트 직접 INSERT**로
     구현했다. 금전 이동이 없어 원칙 13이 방지하려는 "잔액을 단순 UPDATE로 조작" 위험 자체가 없기 때문이다. 대신
     RLS로 "본인 명의 + status='pending'"만 허용해 사용자가 자기 신청을 승인 상태로 만들 수 없게 막았고, 상태
     전이(승인/취소)는 admin만 가능하다.
  3. 신청 폼의 배당금 수령 계좌(은행/계좌번호/예금주)는 **DB에 컬럼 자체를 두지 않았다** — 금융 정보를 결제 구조가
     확정되기 전에 저장하지 않는다는 판단. 화면에서는 입력받되 담당자가 접수 후 별도 절차로 확인하는 것을 전제한다.
- **2차(결제 도입) 시 되돌려야 할 것**: 위 3개 테이블 생성, `investment_orders`를 `create-investment-order`
  Edge Function 경유(Server-Only write)로 전환, `raised_amount` 자동 집계 트리거 추가(현재는 관리자 입력값),
  D38(거래시점 FX 컬럼) 재검토.
- **여전히 PENDING인 부분**: 실제 PG 사업자/정산 방식 — 베트남 현지 결제·외환 규제, 실명확인(KYC), 계좌이체 방식은
  법적·사업적 결정이라 추측하지 않는다(원칙 1). 국가별 금융 라이선스가 걸린 영역이라 기술 판단만으로 정할 수 없다.
- **결정 후 변경 파일**: API.md(결제 단계 상세), DATABASE.md(investment_orders에 결제 참조 필드), SECURITY.md(PG 관련 키 관리)

### D11~D27
(2026-08-26 시점 최초 등록 내용에서 변경 없음 — 요약 표 참조. 전문은 이전 버전(v0.4) 문서 이력 참조.)

### D28~D36
(2026-08-26 STEP03 Pre-Audit에서 등록, 변경 없음 — 요약 표 참조. 전문은 이전 버전(v0.4) 문서 이력 참조. 특히 D28(브랜드), D29(법적 사업모델), D30(포지션), D35(운영조직)는 순수 사업결정이라 임의로 확정하지 않는다.)

### D37. investment_products.currency 컬럼 추가 여부
- **상태**: ✅ **ACCEPTED** (2026-08-27) — 상세는 v0.4 문서 이력 참조. 확정 내용: `currency text NOT NULL` 컬럼 추가, default 미지정.

### D38. investment_transactions 거래시점 환율(FX) 컬럼 추가 여부
- **상태**: ✅ **ACCEPTED** (2026-08-27) — 상세는 v0.4 문서 이력 참조. 확정 내용: NOT REQUIRED(현재), D10 확정 시 재검토.

## 지금 바로 답변이 필요한 항목 (🔴)

없음 — D5, D24(2026-08-26 ACCEPTED), D4(차원 부분)·D6·D8·D9·D37·D38(2026-08-27 ACCEPTED, STEP 4-1D), D39~D45(2026-09-01 ACCEPTED, VIETS MASTER ARCHITECTURE)가 확정되어 현재 블로킹 항목은 없다.

나머지 33개(D1~D3, D4의 Provider 부분, D7, D10~D23, D25~D36, D46~D48)는 PENDING 상태를 유지하며, 각 항목이 속한 Phase 착수 직전에 개별적으로 재확인한다. 특히 D2(Admin 프레임워크), D4 Provider 부분(LLM/Embedding Provider 계약), D10(결제 PG), D28~D30·D35(브랜드/법적모델/포지션/조직 등 순수 사업결정), D46(Agency 온보딩), D47(Investor 전환 조건)은 임의로 확정하지 않고 해당 시점까지 보류한다.

D36(MVP 출시 범위)은 사용자 자료(스토리보드)에 이미 정리된 안이 있어 특히 우선 확인을 권장하지만, 이번 STEP까지 임의로 ACCEPTED 처리하지 않았다.

---

## VIETS MASTER ARCHITECTURE — 추가요구사항 반영 (2026-09-01)

사용자가 "[VIETS MASTER ARCHITECTURE — ADDITIONAL REQUIREMENTS]"로 지시한 Agency Permission / Investor Customer Model / Investment Notification / Customer Notification Preference / Admin Push Target / Admin Push Campaign / Automatic vs Manual Notification / Property Chat Notification 8개 영역을 검토해 아래 9개 항목을 등록했다. 이번 STEP은 **설계 문서 반영만** 수행했다 — 실제 migration SQL 작성, 코드 구현, git 작업은 전혀 하지 않았다(원칙: DB 변경은 migration SQL로 별도 작업, 이번 지시 §12 "NO DESTRUCTIVE CHANGES"). Google OAuth/EAS 문제는 이번 STEP에서 재조사하지 않았다(이번 지시 §11).

### D39. Agency Approval과 기능별 Permission의 분리 구조
- **출처**: VIETS MASTER ARCHITECTURE §1 AGENCY PERMISSION
- **상태**: ✅ **ACCEPTED** (2026-09-01)
- **확정 내용**: `agencies.approval_status`(가입 승인 여부: pending/approved/rejected/suspended)와 `agency_permissions`(기능별 ON/OFF: property_listing/post_writing/chat/account_active)를 완전히 별도 테이블로 분리한다. 승인 상태와 무관하게 관리자가 개별 권한을 언제든 ON/OFF할 수 있다. `post_writing` 권한은 향후 여러 글쓰기 유형(예: 시장뉴스 작성 vs 매물 블로그 작성)으로 세분화될 수 있도록 `agency_permissions`에 nullable `scope text` 컬럼을 추가해 단일 boolean 컬럼 나열 방식이 아닌 **행(row) 단위로 확장 가능한 permission_type 구조**로 설계한다.
- **영향 파일**: DATABASE.md §12(신규)
- **지금 결정 필요**: 예 — Agency 도메인 스키마 설계의 전제
- **추천 근거**: "Agency 승인 여부와 글작성 권한을 하나의 필드로 통합하지 않는다"는 사용자 지시를 스키마 레벨에서 원천적으로 강제, EAV형 permission_type 구조는 새 권한 종류 추가 시 컬럼 추가(migration) 없이 새 enum 값 + row 추가만으로 확장 가능

### D40. User / Agency Member / Investor 독립 관계 모델
- **출처**: VIETS MASTER ARCHITECTURE §2 INVESTOR CUSTOMER MODEL
- **상태**: ✅ **ACCEPTED** (2026-09-01)
- **확정 내용**: `profiles.account_type` 같은 단일 컬럼으로 사용자 유형을 표현하지 않는다. 대신 (1) `profiles`(항상 1:1 존재), (2) `agency_members`(0~N, 한 사용자가 여러 업체 소속 가능), (3) `investors`(0~1, 투자자 전환 시 생성되는 별도 확장 row) 세 개의 독립 테이블을 조합해 신원의 다중 역할을 표현한다. 한 User가 일반회원+중개업소 회원+투자자를 동시에 만족할 수 있다.
- **영향 파일**: DATABASE.md §1(investors), §12(agency_members)
- **지금 결정 필요**: 예 — Investment Notification/Admin Push Target(D41~D43)의 "투자자" 판별 기준이 이 모델에 의존
- **추천 근거**: 사용자의 명시적 금지("Investor 여부를 account_type 하나로 처리하지 않는다") 그대로 반영, 기존 `user_roles`(내부 RBAC, super_admin/admin/editor/reviewer/operator/user)와는 별개의 "고객 세그먼트" 차원이므로 혼동 방지를 위해 명확히 분리

### D41. Investment Notification 저장 위치 — 신규 테이블 대신 기존 notifications 확장
- **출처**: VIETS MASTER ARCHITECTURE §3 INVESTMENT NOTIFICATION
- **상태**: ✅ **ACCEPTED** (2026-09-01)
- **확정 내용**: 요구된 12종 알림(투자 신청/상태변경/모집률변경/목표달성/예상수익률변경/실제수익률변경/목표수익률도달/배당예정/배당확정/배당지급/중요공지/상품상태변경)을 위해 별도 `investment_notifications` 테이블을 새로 만들지 않는다. 대신 기존 `notifications`(DATABASE.md §7, STEP 03부터 존재)에 `product_id uuid FK→investment_products`(nullable)와 `campaign_id uuid FK→admin_push_campaigns`(nullable) 컬럼을 추가해 흡수한다. `type` 컬럼 값으로 `investment_notification_type` enum(신규, 12개 값)을 사용하되, 다른 목적의 알림도 이 테이블을 계속 쓸 수 있도록 컬럼 자체는 text로 유지한다.
- **영향 파일**: DATABASE.md §0(enum 추가), §7(notifications 컬럼 추가)
- **지금 결정 필요**: 예 — 신규 테이블 vs 기존 확장은 이후 재작업 비용이 크므로
- **추천 근거**: "기존 코드를 먼저 검사한다 / 기존 기능을 임의로 삭제하지 않는다"는 마스터 프롬프트 절대 원칙 2·3과 정확히 부합 — 이미 존재하는 in-app 알림 로그 테이블과 목적이 사실상 동일해 중복 테이블 생성을 피함

### D42. SYSTEM_NOTIFICATION vs ADMIN_PUSH 구분 방식
- **출처**: VIETS MASTER ARCHITECTURE §7 AUTOMATIC VS MANUAL NOTIFICATION
- **상태**: ✅ **ACCEPTED** (2026-09-01)
- **확정 내용**: 두 시스템을 별도 테이블로 완전히 분리하지 않는다. 대신 `notifications.campaign_id`의 유무로 구분한다 — NULL이면 SYSTEM_NOTIFICATION(투자/상담/배당/상태 등 자동 알림), 값이 있으면 ADMIN_PUSH(관리자가 `admin_push_campaigns`를 통해 직접 발송). "두 시스템을 혼합하지 않는다"는 요구사항은 **생성 로직(코드 경로)의 분리**로 해석한다 — 사용자에게 도달하는 in-app 알림함(inbox)까지 두 개로 쪼개면 UX가 파편화되므로, 사용자 화면에서는 하나의 알림함으로 유지한다.
- **영향 파일**: DATABASE.md §7
- **지금 결정 필요**: 예 — D41의 테이블 재사용 결정과 직결
- **추천 근거**: 데이터 모델을 단순하게 유지하면서도 "자동 발생"과 "관리자 발송"을 쿼리 한 줄(`campaign_id is null`)로 명확히 구분 가능

### D43. Admin Push Campaign 테이블 재설계 — notification_campaigns → admin_push_campaigns
- **출처**: VIETS MASTER ARCHITECTURE §5 ADMIN PUSH TARGET, §6 ADMIN PUSH CAMPAIGN
- **상태**: ✅ **ACCEPTED** (2026-09-01)
- **확정 내용**: 기존 `notification_campaigns`(DATABASE.md §7)를 `admin_push_campaigns`로 재정의한다. 컬럼 추가: `title text`, `content text`, `language language_code`(nullable — NULL이면 수신자 개인 설정 언어로 자동 매칭), `sent_count int NN default 0`, `success_count int NN default 0`, `failed_count int NN default 0`. `target_type`은 기존 `notification_target_type`(all/investors/region/product/watchlist/user) 대신 신규 `push_target_type` enum(`all_users`/`general_users`/`agency_members`/`all_investors`/`product_investors`/`product_favorites`/`segment`)을 사용한다. `status`는 text에서 `push_campaign_status` enum(draft/scheduled/sending/sent/failed/cancelled)으로 강화한다. `template_id`는 nullable로 유지해 재사용 템플릿 발송과 title/content 직접 입력(1회성 발송) 두 경로를 모두 지원한다. 중개업소 회원이 동시에 투자자인 경우 `all_investors`/`product_investors` 대상에도 포함되도록 대상 산정 쿼리는 D40의 `investors`/`agency_members` 테이블을 함께 조인한다.
- **영향 파일**: DATABASE.md §7, API.md(send-push/send-bulk-push 대상 필드 — 코드 미변경, 문서만 갱신 예정)
- **지금 결정 필요**: 예 — 아직 `supabase/migrations/*.sql`이 작성되지 않은 설계 문서 단계이므로(DATABASE.md 상태 참조) 지금 재정의해도 데이터 손실 위험이 전혀 없음
- **추천 근거**: 기존 테이블을 삭제/신규생성 이원화하지 않고 그대로 확장해 "기존 개발 상태를 유지한다"는 이번 지시의 전제와 일치, 이미 존재하던 `notification_deliveries`/`notification_templates`/`push_topics`도 변경 없이 계속 사용 가능

### D44. Property 1:1 상담(Chat) 최초 스키마 도입
- **출처**: VIETS MASTER ARCHITECTURE §8 PROPERTY CHAT NOTIFICATION
- **상태**: ✅ **ACCEPTED** (2026-09-01)
- **확정 내용**: 이전 6개 설계 문서 어디에도 상담/채팅 테이블이 없었다(최초 도입). `property_conversations`(property_id/customer_id/agency_id/broker_id/status/created_at/updated_at)와 `property_messages`(conversation_id/sender_id/sender_role/body/created_at) 2개 테이블을 신설한다. Chat 기능 자체의 활성화 여부는 `agency_permissions.permission_type='chat'`으로 게이팅한다(꺼져 있으면 해당 업체 소속 매물에 새 conversation 생성 자체를 차단). 고객에게는 일반 Push, 중개업소에게는 Push + 다국어(수신자 `profiles.default_language` 기준) 알림을 `notifications` 테이블(D41 확장분)로 발송한다. Voice/TTS 확장은 지금 스키마를 바꾸지 않고, 향후 `notification_channel` enum에 `'voice'` 값을 추가하는 정도로 확장 가능하다는 메모만 남긴다(D48 참조).
- **영향 파일**: DATABASE.md §0(conversation_status enum), §13(신규)
- **지금 결정 필요**: 예 — Property 상세 화면과 연결되는 다음 Phase(향후 실사용 기능 개발) 착수 전 스키마 골격이 필요
- **추천 근거**: "기존 Property 1:1 상담 시스템과 연결한다"는 지시 문구는 상담 시스템이 이미 존재함을 전제하지만, 6개 설계 문서 전수 검토 결과 실제로는 존재하지 않아 이번에 최초로 스키마를 설계했다 — 추측 없이 요구사항에 명시된 필드(property_id/conversation_id/customer_id/agency_id/broker_id)만 그대로 반영

### D45. notification_preferences의 product_id NULL 중복 방지 방식
- **출처**: VIETS MASTER ARCHITECTURE §4 CUSTOMER NOTIFICATION PREFERENCE
- **상태**: ✅ **ACCEPTED** (2026-09-01, 설계 노트)
- **확정 내용**: `notification_preferences`는 요구사항 그대로 `user_id/product_id/notification_type/enabled/threshold_value/threshold_unit/created_at/updated_at`으로 설계한다. `product_id`가 NULL이면 "전체 상품 공통 설정", 값이 있으면 "상품별 override"를 의미한다. 다만 Postgres의 일반 UNIQUE 제약은 NULL을 서로 다른 값으로 취급해 `(user_id, NULL, notification_type)` 조합의 중복 삽입을 막지 못하므로, 실제 `supabase/migrations/*.sql` 작성 시에는 `product_id IS NULL` 대상과 `product_id IS NOT NULL` 대상을 각각 겨냥한 **partial unique index 2개**로 구현하기로 지금 미리 기록해 둔다.
- **영향 파일**: DATABASE.md §7(notification_preferences)
- **지금 결정 필요**: 아니오 — 설계 노트로 지금 기록해 두고, 실제 index DDL은 STEP 4-2 이후 migration 작성 시점에 반영
- **추천 근거**: "단순 Boolean만으로 끝내지 않는다"는 요구사항을 만족하는 threshold 컬럼 설계에서 흔히 발생하는 실무 함정을 미리 문서화해 향후 재작업 방지

### D46. Agency 가입/온보딩 플로우 (PENDING — 사업 결정 필요)
- **출처**: VIETS MASTER ARCHITECTURE §1 파생
- **상태**: ⚪ PENDING
- **미결정 내용**: `agencies` row를 누가 최초로 생성하는가 — (a) 업체가 앱/웹에서 자체 가입 신청 후 Admin 승인, (b) Admin이 대행 등록 후 업체에 계정 발급, (c) 두 경로 병행. 이 결정에 따라 Agency 온보딩 화면 자체의 존재 여부가 달라진다.
- **영향 파일**: DEVELOPMENT_MASTER_CHECKLIST.md, DATABASE.md §12
- **추천안**: 제공 불가 — 순수 사업 프로세스 결정
- **결정 필요 시점**: Agency/Permission 기능 UI 개발(체크리스트 개발순서 5번 단계) 착수 전

### D47. Investor 전환 조건
- **출처**: VIETS MASTER ARCHITECTURE §2 파생
- **상태**: ✅ **ACCEPTED (2026-09-10)**
- **확정 내용(사용자 결정)**: **(b) 최초 투자 신청 시점에 자동 생성** — 심사/승인 단계를 두지 않는다. 같은 날 확정된
  D10(투자 의향 접수만, 결제 없음)과 정합적이다 — 실제 자금이동이 없는 단계에서 KYC 심사를 요구할 근거가 없기 때문.
- **구현(STEP 05, `20260910070155_investment_domain.sql`)**: `investment_orders`에 AFTER INSERT 트리거
  `ensure_investor_on_order()`(SECURITY DEFINER, `on conflict (user_id) do nothing`)를 걸어 첫 신청 시 `investors`
  행을 만든다. `investors`에는 클라이언트 INSERT 정책을 두지 않아 **이 트리거를 통해서만** 행이 생성된다(사용자가
  임의로 투자자 자격을 만들 수 없다). 두 번째 신청부터는 UNIQUE(user_id)로 중복 생성되지 않는다 — 로컬 검증 완료.
- **향후 KYC 도입 시**: `investors.status`(현재 text, 항상 'active')를 enum화하고 이 트리거의 생성 조건을 재검토한다.
- **영향 파일**: DEVELOPMENT_MASTER_CHECKLIST.md, DATABASE.md §1(investors), `supabase/migrations/20260910070155_investment_domain.sql`

### D48. TTS/Voice Push 확장 범위 (PENDING — 우선순위 낮음)
- **출처**: VIETS MASTER ARCHITECTURE §8 파생("향후 Voice/TTS 확장")
- **상태**: ⚪ PENDING(낮은 우선순위)
- **미결정 내용**: 중개업소 대상 Chat 알림을 향후 음성(TTS)으로도 전달할지, 어떤 TTS 공급자를 쓸지. 지금 당장 스키마를 바꾸지 않는다.
- **영향 파일**: DATABASE.md §0(notification_channel enum 확장 여지만 메모)
- **추천안**: 지금 결정 불필요 — Chat 텍스트 알림이 안정화된 이후 재검토
- **결정 필요 시점**: 없음(향후 필요 시점에 재논의)


### D49. Property Name/Address — 자동번역 금지 불변 규칙 (Immutable Rule)
- **출처**: 사용자 지시 "[FINAL IMMUTABLE RULE — ORIGINAL PROPERTY DATA]" (2026-09-09)
- **상태**: ✅ **ACCEPTED** (2026-09-09)
- **확정 내용**: 매물명(Property Name/Listing Name)과 매물 주소(Property Address)는 Agency/등록 권한이 있는 사용자가 입력한 원본 값을 그대로 저장·표시하는 authoritative 원본 데이터다. 앱 언어(vi/ko/en/zh/ja/th)를 변경해도 두 값은 자동 번역·음역(transliteration)·재작성·요약되지 않고 항상 등록된 원문 그대로 노출된다. 같은 원칙을 매물 참조번호/등록번호/법적 식별번호/에이전시·라이선스 번호에도 적용한다(원본 보존 대상). `property_name_vi`/`property_name_ko`/`property_name_en`/`property_name_zh`/`property_name_ja`/`property_name_th`, `address_vi`/`address_ko`/... 같은 언어별 자동번역 사본 컬럼은 **만들지 않는다** — 원본 값 하나만 source of truth로 둔다. 이 값은 Map/GPS/검색/매물 상세/매물 카드/Chat 매물 참조/즐겨찾기/Admin/Agency/Notification 등 어디서 재사용되든 동일한 원본 값을 그대로 참조한다.
  반대로 설명(description)/옵션(features)/편의시설(amenities)/마케팅 문구/설명성 정보/UI 라벨/시스템 메시지는 이 규칙의 대상이 아니며, 기존 Content Translation 파이프라인(I18N.md §3)으로 계속 다국어 처리한다(D17 참조 — 이름/주소를 제외한 나머지 콘텐츠의 자동번역 적용 여부는 계속 PENDING).
  Chat에서는 원본 사용자 메시지가 항상 source of truth이며, 수신자 쪽에는 메시지 자체의 표시(presentation)만 번역 적용한다 — 메시지 안에서 언급되는 매물명/주소는 번역하지 않는다. Notification 문구(알림 본문 텍스트)는 로컬라이즈할 수 있지만, 알림에 포함된 매물명/주소는 원본 그대로 유지한다.
  **검증 절차(향후 Property 등록/상세 기능 구현 시 QA 체크리스트에 포함)**: 매물 등록(예: 매물명 "Vinhomes Ocean Park 2 - Căn hộ A1203", 주소 "123 Đường Lê Lợi, Ngô Quyền, Hải Phòng") 후 앱 언어를 vi → ko → en → zh → ja → th 순서로 전환하며, 두 값이 매 언어에서 완전히 동일하게(글자 하나도 안 바뀌고) 유지되는지 확인한다.
- **영향 파일**: I18N.md §3.2(properties 표 갱신)/§3.4(신규 하위 섹션), DATABASE.md(향후 `properties` 테이블 설계 시 name/address 컬럼에 언어별 사본 컬럼을 두지 않는다는 스키마 주석으로 명시 — 테이블 자체는 아직 미생성, DEVELOPMENT_MASTER_CHECKLIST.md STEP 1 실행 결과 참조), DEVELOPMENT_MASTER_CHECKLIST.md, QA.md(향후 체크리스트 항목 추가 시)
- **지금 결정 필요**: 아니오(문서화 + 현재 코드베이스 정합성 확인만) — `properties` 테이블 자체가 이 저장소의 어떤 migration에도 아직 존재하지 않는다(DEVELOPMENT_MASTER_CHECKLIST.md "STEP 1 실행 결과" 참조, 현재는 `constants/mockData.ts` Mock 데이터). 다만 현재 Mock 구현이 이미 이 규칙과 충돌하지 않는지 코드베이스를 확인했다: `components/PropertyCard.tsx`/`app/property-detail/[id].tsx`의 `property.title`/`property.location` 렌더링은 어디에서도 `t()`로 감싸지 않고 원본 문자열을 그대로 출력한다(i18n 번역 파이프라인을 아예 거치지 않음) — 확인 완료, 위반 없음.
- **추천 근거**: 실거래 정보(매물명/주소)는 자동번역 시 법적·거래 신뢰성 리스크가 크다는 점이 I18N.md §3.2에 이미 "실거래 정보라 오역 리스크 존재(신중 검토 필요)"로 명시돼 있었다 — 이번 사용자 지시로 그 미결정 항목(D17) 중 "이름/주소"에 한해 확정하고, 그 외 콘텐츠(설명/옵션 등)의 번역 정책은 계속 PENDING으로 남긴다.

---

## MASTER_PROJECT_AUDIT — 신규 리스크 등록 (2026-09-09)

### D50. Git 저장소 백업 부재 — 최우선 리스크
- **출처**: MASTER_PROJECT_AUDIT.md §6.1 — 전체 코드베이스 감사에서 `git log`/`git status`/`git remote -v`를 직접 실행해 확인
- **상태**: ✅ **ACCEPTED**(방향) · **2026-09-10 해소 완료**
- **당시 확인된 사실**: 커밋 1개(`70489fb` 스캐폴드)뿐이고 원격 저장소 없음, `git status --short` 86줄. 미추적 파일에 `services/auth.ts`, `services/chat.ts`, `app/login.tsx`, `app/property-detail/`, `app/invest-detail/`, `app/invest-apply/`, `app/property-chat/`, `store/`, `supabase/migrations/` 등 애플리케이션 코드 사실상 전부가 포함되어 있었다(PC 손상 시 전체 소실).
- **왜 반복 지적에도 남아 있었는가**: STEP 4-13-14(2026-08-31)와 STEP 4-14(2026-09-09)에서 각각 "P1"으로 지적됐으나 두 STEP 모두 "사용자 승인 필요, 범위 밖"으로 제외 — 세 번째 재발견에서야 STEP 00으로 공식 등록됐다.
- **2026-09-10 실행 결과**: 로컬 커밋 2개(`70489fb`, `78c9968` — 104개 파일 추가) + `.gitignore`에 스크래치 파일 제외 반영 + 원격 저장소 `https://github.com/Kimchandong/Viets.git` 생성 및 `git push -u origin master` 성공. `git status` 클린. **단일 장애점 리스크 해소.**
- **영향 파일**: DEVELOPMENT_STORYBOARD.md STEP 00, DEVELOPMENT_MASTER_CHECKLIST.md PART E-1

### D51. Chat DB(property_conversations/property_messages) — migration 외부 생성 확인 및 편입 방향
- **출처**: MASTER_PROJECT_AUDIT.md §6.2/§2-F — `services/chat.ts` 주석: "필요한 Supabase 테이블/정책/버킷(SQL Editor·Storage에서 1회 실행)"
- **상태**: ✅ **ACCEPTED**(방향) — 실행은 STEP 07 예정(2026-09-10 기준 미실행)
- **확인된 사실**: Chat 기능(D44)은 완성되어 동작 중이지만(STEP 4-15), 그 스키마(`property_conversations`/`property_messages`, `chat-images` 버킷)는 `supabase/migrations/`의 어떤 파일에도 없다 — Dashboard SQL Editor에서 1회성으로 실행됐다. "DB 변경은 반드시 migration SQL로 관리한다"(원칙 8)에서 벗어난 유일하게 확인된 사례다.
- **결정 내용**: 이미 반영된 실제 스키마를 그대로 옮겨적는 형태로 정식 migration 파일을 작성해 편입한다(새로 만드는 것이 아니라 이미 있는 것을 기록으로 남기는 작업). STEP 07(Agency broker 배정 로직 추가와 함께 진행)로 배치 — 그 시점에 스키마도 확장(broker_id 등)해야 하므로 묶는 편이 효율적이다.
- **참고(2026-09-10)**: 같은 부류의 GRANT 누락 사고가 Property Domain에서 재발했다(STEP 02c) — 이번 편입 작업 시 GRANT 문이 함께 들어가는지 반드시 확인할 것.
- **영향 파일**: DEVELOPMENT_STORYBOARD.md STEP 07, DEVELOPMENT_MASTER_CHECKLIST.md PART E-2
