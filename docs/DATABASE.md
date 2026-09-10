# DATABASE.md — Viet's

버전: v0.4 (STEP 4-1D + VIETS MASTER ARCHITECTURE 추가요구사항 + STEP 1 실행 반영) · 작성일: 2026-08-26 · 최종수정: 2026-09-01
상태: **설계 문서 겸 구현 현황 문서.** 대부분의 도메인은 여전히 설계 단계이며, 실제 `supabase/migrations/*.sql`은 이 문서 승인 후 별도 작업으로 작성한다(원칙 8: DB 변경은 반드시 migration SQL로 관리). 단, §1(Identity & Access) 중 profiles/user_roles와 §12(Agency Domain) 전체 + §9의 audit_logs는 이미 실제 migration SQL로 구현되었다 — 각각 `supabase/migrations/20260828083711_profiles_and_user_roles.sql`(STEP 4-3), `supabase/migrations/20260901071931_property_agency_foundation.sql`(STEP 1). 두 파일 모두 아직 연결된 Supabase 프로젝트에 push되었는지는 이 세션에서 확인 불가(셸 접근 없음) — Desktop에서 `npx supabase db push`로 반영 필요. 그 외 테이블(properties 포함)은 여전히 순수 설계 문서 상태다.

## 변경 이력

| 일자 | 변경 내용 | 근거 |
|---|---|---|
| 2026-08-27 | D9 ACCEPTED 반영 — §10 `investment_orders_confirm` 트리거를 SECONDARY(감사/보정용)로 재정의, §11에서 관련 PENDING 항목 제거 | DECISIONS.md D9 |
| 2026-08-27 | D6 ACCEPTED 반영 — property_locations 관련 §11 PENDING 항목 제거(properties 구조 자체는 변경 없음) | DECISIONS.md D6 |
| 2026-08-27 | D8 ACCEPTED 반영 — §1 user_devices에 `is_active` 추가, §7 push_tokens 제거(§1로 통합) | DECISIONS.md D8 |
| 2026-08-27 | D4 ACCEPTED 반영(차원만) — §11에서 embedding 차원 관련 PENDING 항목 제거, `vector(1536)` 값은 변경 없이 유지 | DECISIONS.md D4 |
| 2026-08-27 | D37 ACCEPTED 반영 — §3 investment_products에 `currency` 컬럼 추가 | DECISIONS.md D37 |
| 2026-08-27 | D38 ACCEPTED 반영 — §3 investment_transactions에 거래시점 FX 관련 결정(NOT REQUIRED) 메모 추가, 컬럼은 추가하지 않음 | DECISIONS.md D38 |
| 2026-09-01 | §0에 신규 enum 8종 추가. §1에 `investors` 테이블 추가. §7을 확장(notifications에 product_id/campaign_id 추가, notification_campaigns→admin_push_campaigns 재구성, notification_preferences 신규). §12 Agency Domain, §13 Property Consultation(Chat) 신규 섹션 추가. §10 트리거 3건 추가. §11에 D46~D48 3건 추가. 기존 §0~§11의 다른 내용/번호는 변경하지 않음 | DECISIONS.md D39~D45 ACCEPTED, D46~D48 PENDING / ARCHITECTURE.md §7 |
| 2026-09-01 | **STEP 1 실행**: §12(agencies/agency_members/agency_permissions) + §9의 audit_logs를 실제 migration SQL로 구현(설계 변경 아님, 이미 확정된 설계를 그대로 구현). `properties.agency_id`는 `properties` 테이블 자체가 아직 어떤 migration에도 없어 이번에 추가하지 못함 — DESIGN GAP으로 기록, §2 properties 섹션에 각주 추가 | DEVELOPMENT_MASTER_CHECKLIST.md "STEP 1 실행 결과", supabase/migrations/20260901071931_property_agency_foundation.sql |

표기: `PK` 기본키, `FK→table` 외래키, `UQ` unique, `IDX` 인덱스 대상, `NN` not null. 모든 테이블은 별도 명시 없는 한 `id uuid PK default gen_random_uuid()`, `created_at timestamptz NN default now()`를 공통으로 가진다. 갱신이 발생하는 테이블은 `updated_at timestamptz` + `BEFORE UPDATE` 트리거로 자동 갱신한다.

RLS 표기 규칙: **Public-Read** = 로그인 불문 SELECT 허용(공개 정보), **Auth-Read** = 로그인 사용자만 SELECT, **Owner-Only** = `user_id = auth.uid()` 행만 SELECT, **Admin-Write** = admin 계열 role만 INSERT/UPDATE/DELETE 가능(RBAC은 SECURITY.md), **Server-Only** = 클라이언트 권한 전혀 없음(Edge Function의 service role을 통해서만 write).

---

## 0. 공통 Enum

```sql
create type user_role as enum ('super_admin','admin','editor','reviewer','operator','user');
create type property_status as enum ('draft','pending_review','active','sold','off_market','archived');
create type property_category as enum ('apartment','villa','townhouse','land','office','retail','hotel','industrial');
create type investment_product_type as enum ('reit_share','co_investment','fund','bond_like');
create type investment_risk_level as enum ('low','medium','high');
create type investment_product_status as enum ('draft','pending_review','open','closed','fundraising_failed','completed','cancelled');
create type investment_order_status as enum ('pending','confirmed','failed','cancelled','refunded');
create type transaction_type as enum ('deposit','withdrawal','investment_buy','investment_sell','dividend_payout','fee','adjustment');
create type transaction_status as enum ('pending','completed','failed','reversed');
create type dividend_status as enum ('scheduled','paid','cancelled');
create type article_status as enum ('collected','processing','pending_review','published','rejected');
create type research_job_status as enum ('queued','running','completed','failed');
create type notification_channel as enum ('push','in_app');
create type notification_target_type as enum ('all','investors','region','product','watchlist','user');
create type push_delivery_status as enum ('queued','sent','delivered','failed','opened');
create type language_code as enum ('vi','ko','en','zh','ja');

-- 2026-09-01 추가 (VIETS MASTER ARCHITECTURE 추가요구사항, DECISIONS.md D39~D45)
create type agency_approval_status as enum ('pending','approved','rejected','suspended');
create type agency_permission_type as enum ('property_listing','post_writing','chat','account_active');
create type agency_member_role as enum ('owner','staff');
create type investment_notification_type as enum (
  'investment_applied',
  'investment_status_changed',
  'funding_rate_changed',
  'funding_goal_reached',
  'expected_return_changed',
  'actual_return_changed',
  'target_return_reached',
  'dividend_scheduled',
  'dividend_confirmed',
  'dividend_paid',
  'important_notice',
  'product_status_changed'
);
create type threshold_unit as enum ('percent','currency');
create type push_target_type as enum ('all_users','general_users','agency_members','all_investors','product_investors','product_favorites','segment');
create type push_campaign_status as enum ('draft','scheduled','sending','sent','failed','cancelled');
create type conversation_status as enum ('open','closed');
```

---

## 1. Identity & Access

### profiles
사용자 프로필 (auth.users 1:1 확장).
- `id uuid PK FK→auth.users(id)`
- `display_name text`
- `avatar_url text`
- `phone text`
- `default_language language_code NN default 'en'`
- `default_currency text NN default 'USD'`
- `kyc_status text` (향후 확장 자리, 값 enum화는 Phase 5에서 결정)
- `updated_at timestamptz`

RLS: Owner-Only (본인 row만 SELECT/UPDATE), INSERT는 `handle_new_user` 트리거(auth.users INSERT 시 자동 생성)로만 발생.

### user_roles
- `id PK`
- `user_id uuid NN FK→auth.users(id)`
- `role user_role NN`
- `granted_by uuid FK→auth.users(id)`
- `granted_at timestamptz NN default now()`
- `UQ(user_id, role)`

RLS: Owner-Only SELECT(본인 role 조회), 그 외 전부 Admin-Write. 일반 `user` role 부여는 신규가입 트리거가 자동 부여, 그 외 role은 Admin만 부여 가능.

**주의(2026-09-01): 이 테이블은 내부 운영 인력의 RBAC이다.** 아래 `investors`/§12의 `agency_members`는 고객 세그먼트를 나타내는 완전히 다른 축이며, `user_roles`와 절대 혼동하지 않는다(ARCHITECTURE.md §7.2 참조).

### user_devices — **D8(ACCEPTED, 2026-08-27): user_devices/push_tokens 통합 결과 정본(단일) 테이블**
기기/세션 lifecycle 정보와 push 발송 대상(delivery endpoint) 정보를 하나의 device record로 관리한다(원칙 19 Device Management). 이전에는 `push_tokens`로 분리되어 있었으나 D8 결정으로 통합, 별도 `push_tokens` 테이블은 제거되었다(§7 참조, DECISIONS.md D8).
- `id PK`
- `user_id uuid NN FK→auth.users(id) IDX`
- `device_id text NN` (기기 고유값)
- `platform text NN` ('ios'|'android')
- `push_token text` (FCM token — 발송 대상 식별자 역할도 겸함)
- `is_active bool NN default true` (push 발송 대상 활성 여부 — 통합 전 `push_tokens.is_active`에서 이관)
- `app_version text`
- `last_seen_at timestamptz`
- `UQ(user_id, device_id)`

RLS: Owner-Only.

### user_preferences
- `id PK`
- `user_id uuid NN UQ FK→auth.users(id)`
- `preferred_language language_code`
- `notification_opt_in jsonb NN default '{}'` (알림 종류별 on/off — 2026-09-01: 상품별/임계값 세분 설정은 이 컬럼을 확장하지 않고 신규 `notification_preferences` 테이블(§7)로 별도 관리한다. 이 컬럼은 계속 "전역 채널 on/off" 수준의 단순 설정 용도로만 사용)
- `watch_regions jsonb` (관심 지역 목록, 캐시성 — 정본은 watchlists)

RLS: Owner-Only.

### investors — **신규 (2026-09-01, DECISIONS.md D40 ACCEPTED)**
Viet's Investment/REIT 고객 자격을 나타내는 독립 테이블. 일반 회원/Agency 소속 여부와 무관하게, 이 테이블에 row가 있으면 투자자다 — 단일 `account_type` 컬럼으로 표현하지 않는다(ARCHITECTURE.md §7.2 참조).
- `id PK`
- `user_id uuid NN UQ FK→auth.users(id) IDX`
- `status text NN default 'active'` (값 enum화는 Phase 5 이후, 실제 KYC/심사 프로세스 확정 시 재검토 — `profiles.kyc_status`와 동일한 유예 사유)
- `created_at timestamptz NN default now()`

RLS: Owner-Only SELECT(본인 투자자 자격 확인). INSERT는 Server-Only — 투자자 전환 조건/트리거는 사업 결정 대기 항목(DECISIONS.md D47 PENDING, §11 참조)이므로 현재는 수동 승인 경로만 가정하고 클라이언트 직접 INSERT는 허용하지 않는다.

---

## 2. Property Domain

### locations
행정구역 마스터(province/district/ward 정규화).
- `id PK`
- `parent_id uuid FK→locations(id)` (self-referencing: province→district→ward)
- `level text NN` ('province'|'district'|'ward')
- `name text NN`, `name_en text`
- `IDX(parent_id)`

RLS: Public-Read. Admin-Write.

### developers / owners
- `id PK`, `name text NN`, `description text`, `logo_url text`, `contact jsonb`
- `owners`에는 `owner_type text` ('individual'|'company') 추가

RLS: Public-Read(활성 데이터만), Admin-Write.

### property_categories
카테고리 마스터(다국어 라벨 포함, `property_category` enum과 별도로 UI 표시용 메타 필요 시 사용).
- `id PK`, `code property_category NN UQ`, `label_i18n jsonb NN`

RLS: Public-Read, Admin-Write.

### properties
핵심 매물 테이블.
- `id PK`
- `title text NN`, `description text`
- `category property_category NN IDX`
- `price numeric(18,2) NN`, `currency text NN default 'VND'`
- `area numeric(10,2)`, `land_area numeric(10,2)`, `building_area numeric(10,2)`
- `year_built int`, `floors int`
- `rental_income numeric(18,2)`, `rental_yield numeric(6,3)`, `occupancy_rate numeric(5,2)`
- `address text`, `province_id uuid FK→locations`, `district_id uuid FK→locations`, `ward_id uuid FK→locations`
- `latitude double precision`, `longitude double precision`
- `geom geography(Point,4326)` (PostGIS — 지도 반경검색용, 위경도 변경 시 트리거로 자동 동기화)
- `owner_id uuid FK→owners`, `developer_id uuid FK→developers`
- `agency_id uuid FK→agencies` (nullable — 2026-09-01 설계, **STEP 1(2026-09-01) 시점에는 아직 실제 migration에 반영되지 않음**: `properties` 테이블 자체가 이 저장소의 어떤 migration으로도 생성된 적이 없어 ALTER 대상이 없다 — DEVELOPMENT_MASTER_CHECKLIST.md "STEP 1 실행 결과"의 DESIGN GAP 참조. `agencies`/`agency_permissions`는 이미 구현됨. 이 매물을 등록/관리하는 Agency, 개인/직영 매물은 NULL. §12 참조)
- `status property_status NN default 'draft' IDX`
- `embedding vector(1536)` (RAG용 — 제목+설명 임베딩, Phase 6에서 채움)
- `IDX GIST(geom)` (반경 검색), `IDX(status, category)`, `IDX(price)`, `IDX(rental_yield)`, `IDX(agency_id)`

RLS: Public-Read (status='active'인 행만), 그 외 status는 소유 admin/reviewer만. INSERT/UPDATE는 Admin-Write + 향후 "매물 등록 요청" 플로우가 생기면 owner 본인 제출 → reviewer 승인 구조(Phase 4에서 세부 설계). **2026-09-01: Agency가 직접 매물을 등록하는 경로는 `agency_permissions.permission_type='property_listing'`이 `enabled=true`인 경우에만 허용(§12 참조), 이 검사는 RLS/Edge Function 양쪽에서 이중 방어.**

트리거: `properties_geom_sync` (lat/lng → geom), `properties_updated_at`.

### property_images / property_documents
- `id PK`, `property_id uuid NN FK→properties IDX`, `url text NN`, `sort_order int default 0`
- `property_documents`에는 `doc_type text`, `title text` 추가 (등기부등본 등 — Private Storage + Signed URL)

RLS: property가 Public-Read 대상이면 이미지도 Public-Read, 문서는 로그인 필요 시 Auth-Read로 더 제한 가능(문서 민감도에 따라 SECURITY.md에서 세분화).

### property_locations
`properties.province_id/district_id/ward_id`로 이미 정규화했으므로, 이 테이블은 "다중 위치 태깅"(예: 한 개발단지가 여러 구역에 걸침) 등 1:N 관계가 필요할 때만 사용. 기본 설계는 properties에 내장된 단일 위치로 충분 — **D6(ACCEPTED, 2026-08-27): EXCLUDE — 이번 마이그레이션 대상에 포함하지 않는다.** properties의 기존 province_id/district_id/ward_id/latitude/longitude/geom 구조는 변경하지 않고 그대로 유지한다. 향후 실사용 요구가 확인되면 추가 마이그레이션으로 재도입한다(DECISIONS.md D6 참조).

---

## 3. Investment Domain

### investment_products
- `id PK`
- `title text NN`, `property_id uuid FK→properties`
- `product_type investment_product_type NN`
- `target_amount numeric(18,2) NN`, `minimum_investment numeric(18,2) NN`
- `currency text NN` (**D37(ACCEPTED, 2026-08-27)**: target_amount/minimum_investment/raised_amount의 기준 통화. default 값은 아직 결정하지 않았다 — `properties.currency`의 default('VND')를 자동으로 상속/적용하지 않으며, 통화 정책 확정 또는 STEP 4-2 migration 설계 시 default/check constraint를 최종 결정한다. DECISIONS.md D37 참조)
- `expected_return numeric(6,3)`, `investment_period_months int`
- `dividend_frequency text` ('monthly'|'quarterly'|'yearly')
- `risk_level investment_risk_level NN`
- `start_at timestamptz`, `end_at timestamptz`
- `status investment_product_status NN default 'draft' IDX`
- `raised_amount numeric(18,2) NN default 0` (모집률 표시용 — **derived cache**, 실제 정본은 investment_orders 합계이며 트리거로만 갱신, 클라이언트 직접 UPDATE 금지)
- `embedding vector(1536)`

RLS: Public-Read(status IN ('open','completed')), Admin/Reviewer는 전체. Write는 Admin-Write(생성은 `create-investment-product` Edge Function 경유 원칙 15).

**2026-09-01 참고: 이 테이블의 상태 변화(모집률/상태/예상수익률/실제수익률 변경 등)는 §7의 `investment_notification_type` 자동 알림과 연결된다** — 값이 바뀌는 지점(주로 investment_orders 처리 Edge Function, 수익률 갱신 Edge Function/Cron)에서 해당 알림 row를 함께 생성한다. 이 테이블 자체에는 알림 관련 컬럼을 추가하지 않는다(관심사 분리).

### investment_product_documents / investment_terms / investment_metrics
- `investment_product_documents`: `id PK`, `product_id FK NN IDX`, `title`, `url`, `doc_type`
- `investment_terms`: `id PK`, `product_id FK NN UQ`, 구조화된 약관 필드(운용기간, 조기상환조건, 수수료 구조 등 jsonb 또는 개별 컬럼 — Phase 5 상세 설계)
- `investment_metrics`: `id PK`, `product_id FK NN IDX`, `metric_date date NN`, `metric_type text`, `value numeric` (수익률 추이 등 시계열)

RLS: 전부 Public-Read(공개 상품 한정) / Admin-Write.

### investment_orders — **금융거래 (Server-Only write)**
- `id PK`
- `user_id uuid NN FK→auth.users IDX`
- `product_id uuid NN FK→investment_products IDX`
- `amount numeric(18,2) NN`
- `currency text NN`
- `status investment_order_status NN default 'pending' IDX`
- `order_type text NN` ('buy'|'sell')
- `created_at`, `confirmed_at timestamptz`

RLS: Owner-Only SELECT. **INSERT/UPDATE는 Server-Only** — 클라이언트는 `create-investment-order` Edge Function만 호출, 함수 내부에서 service role로 기록(원칙 13: 단순 UPDATE로 잔액 관리 금지). **2026-09-01: 이 함수 내부에서 `investment_applied`/`investment_status_changed` 알림 row도 함께 생성한다(§7).**

### investment_transactions — **원칙 7 요구사항, immutable**
- `id PK`
- `user_id uuid NN FK→auth.users IDX`
- `investment_product_id uuid FK→investment_products IDX`
- `transaction_type transaction_type NN`
- `amount numeric(18,2) NN`
- `currency text NN`
- `status transaction_status NN default 'pending'`
- `reference_id uuid` (관련 investment_orders.id 또는 dividends.id)
- `created_at timestamptz NN default now()`
- `IDX(user_id, created_at)`

RLS: Owner-Only SELECT. **모든 write는 Server-Only**. UPDATE/DELETE는 애플리케이션 레벨에서 금지(원칙: immutable) — 정정이 필요하면 `transaction_type='adjustment'`의 새 row를 추가하는 방식(회계 원장 패턴). Postgres 레벨에서도 UPDATE/DELETE를 막는 `REVOKE` + RLS `WITH CHECK (false)` 이중 방어.

거래시점 환율(FX) 저장: **D38(ACCEPTED, 2026-08-27) — 현재 NOT REQUIRED**. 이번 설계에는 환율 컬럼을 추가하지 않는다. D10(결제/정산 방식) 확정 시 재검토 대상(DECISIONS.md D38 참조).

### investment_holdings — **derived, Server-Only**
사용자별 보유 현황(정본은 investment_transactions, 이 테이블은 조회 성능을 위한 집계 캐시).
- `id PK`
- `user_id uuid NN FK→auth.users IDX`
- `product_id uuid NN FK→investment_products IDX`
- `units numeric(18,4) NN default 0`
- `total_invested numeric(18,2) NN default 0`
- `current_value numeric(18,2)`
- `updated_at timestamptz`
- `UQ(user_id, product_id)`

RLS: Owner-Only SELECT. Write는 오직 `investment_transactions` INSERT에 반응하는 **Edge Function 내부 단일 DB 트랜잭션**을 통해서만 재계산(D9 ACCEPTED, §10 참조) — 클라이언트 직접 UPDATE 절대 금지(원칙 13 정면 대응).

### dividends
- `id PK`
- `product_id uuid NN FK→investment_products IDX`
- `user_id uuid NN FK→auth.users IDX`
- `amount numeric(18,2) NN`
- `currency text NN`
- `status dividend_status NN default 'scheduled'`
- `scheduled_at timestamptz`, `paid_at timestamptz`
- `IDX(user_id, status)`

RLS: Owner-Only SELECT. Server-Only write(배당 지급 Edge Function/Cron에서만).

**2026-09-01 참고: 이 테이블의 status 전이(scheduled→paid 등)는 §7의 `dividend_scheduled`/`dividend_confirmed`/`dividend_paid` 알림과 연결된다.**

---

## 4. User Engagement

### watchlists / favorites
- `id PK`, `user_id FK NN IDX`, `target_type text NN` ('property'|'investment_product'), `target_id uuid NN`, `UQ(user_id, target_type, target_id)`

RLS: Owner-Only (전체 CRUD 본인 소유 한정 — 이 테이블은 예외적으로 클라이언트 직접 write 허용, 금전 데이터가 아니므로).

**2026-09-01 참고: `favorites`는 §5(Admin Push Target)의 `PRODUCT_FAVORITES` 세그먼트 판정에 사용된다(target_type='investment_product' 행 기준).**

### price_alerts
- `id PK`, `user_id FK NN`, `target_type text NN`, `target_id uuid NN`, `condition text NN` ('price_below'|'yield_above' 등), `threshold numeric NN`, `is_active bool default true`

RLS: Owner-Only.

(2026-09-01 참고: 이 테이블은 매물 가격/수익률에 대한 단순 조건 알림이며, §7의 `notification_preferences`(투자상품 알림 유형별 임계값)와는 별개 테이블로 유지한다 — 대상 도메인이 다르고(price_alerts는 매물 포함, notification_preferences는 투자상품 알림 전용) 기존 구조를 변경할 이유가 없어 통합하지 않았다.)

---

## 5. Content / AI Research

### article_sources
- `id PK`, `domain text NN UQ`, `name text`, `trust_score numeric(3,2) default 1.0`, `is_active bool default true`

RLS: Admin/Reviewer만 조회(내부 운영 데이터), Public-Read 불필요.

### articles
- `id PK`
- `source_id uuid FK→article_sources`
- `source_url text NN`, `source_domain text NN`, `source_title text`, `source_published_at timestamptz`
- `category text`, `status article_status NN default 'collected' IDX`
- `summary text` (AI 생성 요약 — **추론 표시**)
- `facts jsonb` (AI가 추출한 "확인된 사실" 구조화 필드 — summary와 분리해 원칙 8-9 "추론 vs 사실 구분" 반영)
- `related_property_ids uuid[]`, `related_product_ids uuid[]`
- `reviewed_by uuid FK→auth.users`, `published_at timestamptz`
- `embedding vector(1536)`
- `IDX(status)`, `IDX GIN(related_property_ids)`

RLS: Public-Read(status='published'만), Reviewer/Admin은 전체. Write는 Server-Only(AI 파이프라인) + Admin 리뷰 UPDATE(승인/반려).

### article_translations
- `id PK`, `article_id FK NN IDX`, `language language_code NN`, `title text`, `body text`, `summary text`, `UQ(article_id, language)`

RLS: Public-Read(원본 article이 published인 경우), Server-Only write(번역 Edge Function).

### article_embeddings
articles.embedding 컬럼으로 충분할 수 있으나, **청크 단위 임베딩**(긴 본문 분할)이 필요하면 별도 테이블 유지:
- `id PK`, `article_id FK NN IDX`, `chunk_index int`, `content text`, `embedding vector(1536)`
- `IDX ivfflat(embedding vector_cosine_ops)`

RLS: Server-Only(RAG 조회는 Edge Function에서 service role로 수행, 클라이언트 직접 접근 없음).

### research_jobs
- `id PK`, `job_type text NN`, `status research_job_status NN default 'queued' IDX`, `started_at`, `finished_at`, `error text`, `stats jsonb`

RLS: Admin-Read only, Server-Only write.

---

## 6. Market Data

### exchange_rates
- `id PK`, `base_currency text NN`, `quote_currency text NN default 'VND'`, `rate numeric(18,6) NN`, `fetched_at timestamptz NN`, `UQ(base_currency, quote_currency, fetched_at)`, `IDX(base_currency, quote_currency, fetched_at desc)`

RLS: Public-Read. Server-Only write(Cron).

### market_indicators
- `id PK`, `indicator_type text NN`, `region text`, `value numeric`, `unit text`, `period date NN`, `source text`
- `IDX(indicator_type, period desc)`

RLS: Public-Read. Server-Only write.

---

## 7. Notifications

**2026-09-01 확장 개요 (DECISIONS.md D41/D42/D43/D45 ACCEPTED, ARCHITECTURE.md §7.3~§7.6 참조):** 자동 발생 알림(SYSTEM_NOTIFICATION)과 관리자 발송(ADMIN_PUSH)을 하나의 `notifications` 수신함 테이블에 저장하되, `campaign_id`의 NULL 여부로 두 생성 경로를 구분한다. "단순 Boolean만으로 끝내지 않는" 사용자별 알림 설정은 신규 `notification_preferences`로 관리한다. 기존 `notification_campaigns`는 `admin_push_campaigns`로 재구성한다(§9 트리거·§7.6 참조) — 이 문서 전체가 "설계 문서, 실제 migration 미작성" 상태이므로(문서 최상단 상태 표기) 데이터 손실 없이 재구성 가능하다.

### notifications (in-app 알림 로그, 사용자별)
- `id PK`, `user_id FK NN IDX`, `title text NN`, `body text`, `type text NN`, `deep_link text`, `is_read bool default false`, `IDX(user_id, is_read)`
- `product_id uuid FK→investment_products` (nullable — 2026-09-01 추가. 어떤 투자상품에 대한 알림인지 연결. 투자상품과 무관한 알림(공지 등)은 NULL)
- `campaign_id uuid FK→admin_push_campaigns` (nullable — 2026-09-01 추가. **NULL = SYSTEM_NOTIFICATION(자동), NOT NULL = ADMIN_PUSH(관리자 발송)**. 이 컬럼 하나로 두 시스템의 생성 경로를 코드 레벨에서 분리하면서도 사용자 조회는 이 테이블 하나로 통일한다 — DECISIONS.md D42)
- `IDX(product_id)`, `IDX(campaign_id)`
- `type` 컬럼은 계속 자유 text로 두되(범용 재사용 목적), 투자 관련 알림은 `investment_notification_type` enum(§0)의 12개 값 중 하나를 사용하는 것을 규약으로 한다(DB 레벨 CHECK 제약은 걸지 않음 — 공지/기타 알림 등 enum 외 값도 계속 사용되므로).

RLS: Owner-Only.

### notification_templates
- `id PK`, `code text NN UQ`, `channel notification_channel NN`, `title_i18n jsonb NN`, `body_i18n jsonb NN`

RLS: Admin-only.

### notification_campaigns — **RESTRUCTURED → `admin_push_campaigns` (2026-09-01, DECISIONS.md D43 ACCEPTED)**
이 테이블은 아직 실제 스키마가 구현되지 않은 설계 문서 단계였으므로(본 문서 최상단 상태 표기 참조), 데이터 손실 없이 아래 `admin_push_campaigns`로 재구성한다. 원래 정의(`template_id, target_type notification_target_type, target_filter jsonb, scheduled_at, sent_at, status text, image_url, deep_link, created_by`)의 필드 대부분은 유지하되, §5/§6(Admin Push Target/Campaign) 요구사항을 만족하도록 필드를 확장하고 `target_type`/`status`를 전용 enum으로 강화한다.

### admin_push_campaigns — **신규 명칭 (구 notification_campaigns, 2026-09-01)**
Admin이 PC Admin에서 작성하는 수동 발송 캠페인. 즉시 발송/예약 발송/다국어/미리보기/발송이력/성공-실패 통계를 지원한다(ARCHITECTURE.md §7.6).
- `id PK`
- `template_id uuid FK→notification_templates` (nullable — 템플릿 없이 직접 작성도 허용)
- `title text NN`
- `content text NN`
- `target_type push_target_type NN` (`all_users`/`general_users`/`agency_members`/`all_investors`/`product_investors`/`product_favorites`/`segment`)
- `target_filter jsonb` (product_id 등 대상 세분화 조건 — `target_type='product_investors'`/`'product_favorites'`일 때 필수, `'segment'`일 때 향후 조건 기반 확장에 사용)
- `language language_code` (nullable — NULL이면 전체 언어 공통 발송, 값이 있으면 해당 언어 사용자만 대상)
- `scheduled_at timestamptz` (nullable — NULL이면 즉시 발송)
- `sent_at timestamptz`
- `sent_count int NN default 0`
- `success_count int NN default 0`
- `failed_count int NN default 0`
- `status push_campaign_status NN default 'draft' IDX` (draft/scheduled/sending/sent/failed/cancelled)
- `image_url text`, `deep_link text`
- `created_by uuid FK→auth.users`
- `created_at timestamptz NN default now()`

RLS: Admin-only(전체 CRUD, role 세분화는 SECURITY.md). **`sent_count`/`success_count`/`failed_count`/`status`(sending 이후 단계)의 갱신은 Server-Only** — Admin Dashboard가 발송 결과를 직접 UPDATE하지 않고 `send-admin-push` Edge Function이 발송 후 갱신한다(ARCHITECTURE.md §3.2/§7.6 원칙 적용).

### notification_deliveries
- `id PK`, `campaign_id FK IDX`, `user_id FK IDX`, `push_token text`, `status push_delivery_status NN`, `sent_at`, `error text`

RLS: Admin-Read only, Server-Only write.

(2026-09-01 참고: `campaign_id`는 이제 `admin_push_campaigns.id`를 가리킨다 — 테이블명 변경 외 이 테이블 자체의 구조 변경은 없음.)

### push_tokens — **제거됨(D8 ACCEPTED, 2026-08-27)**
`user_devices`(§1)로 통합됨 — push 발송 대상 식별은 `user_devices.push_token` / `user_devices.is_active`를 사용한다. API.md의 send-push/send-bulk-push 대상 테이블도 함께 갱신되었다(DECISIONS.md D8 참조).

### push_topics
- `id PK`, `code text NN UQ`, `description text` (FCM topic 매핑 — 지역/관심상품 구독 그룹)

RLS: Public-Read(코드 목록), Admin-Write.

### notification_preferences — **신규 (2026-09-01, DECISIONS.md D45 ACCEPTED)**
고객이 상품별/알림유형별로 ON/OFF와 임계값 조건을 설정한다. "단순 Boolean만으로 끝내지 않는다"는 요구사항에 따라 값 자체(threshold_value/threshold_unit)를 저장한다.
- `id PK`
- `user_id uuid NN FK→auth.users(id) IDX`
- `product_id uuid FK→investment_products` (nullable — **NULL이면 해당 user의 전체 상품 대상 기본 설정**, 특정 상품 지정 시 그 상품에 한정)
- `notification_type investment_notification_type NN`
- `enabled bool NN default true`
- `threshold_value numeric(18,4)` (nullable — 예: 80, 8.0. `funding_rate_changed`/`target_return_reached` 등 임계값이 의미 있는 유형에만 사용, 그 외 유형은 NULL)
- `threshold_unit threshold_unit` (nullable — percent/currency, threshold_value와 함께 사용)
- `created_at timestamptz NN default now()`
- `updated_at timestamptz`

**설계 노트 — NULL을 포함한 유일성 제약**: `(user_id, product_id, notification_type)` 조합은 논리적으로 유일해야 하지만, `product_id`가 NULL일 수 있고 Postgres는 UNIQUE 제약에서 NULL을 서로 다른 값으로 취급하므로 일반 `UNIQUE(user_id, product_id, notification_type)`으로는 "전체 상품 기본 설정"의 중복(같은 user_id + notification_type + product_id=NULL row가 여러 개 생기는 것)을 막지 못한다. 대신 두 개의 partial unique index를 사용한다:
```sql
create unique index notification_preferences_specific_uq
  on notification_preferences (user_id, product_id, notification_type)
  where product_id is not null;

create unique index notification_preferences_default_uq
  on notification_preferences (user_id, notification_type)
  where product_id is null;
```

RLS: Owner-Only(본인 설정 CRUD — watchlists/favorites와 동일하게 금전 데이터가 아니므로 클라이언트 직접 write 허용).

---

## 8. CMS

### banners / notices / faqs
- 공통: `id PK`, `title_i18n jsonb NN`, `body_i18n jsonb`, `is_active bool default true`, `sort_order int`, `starts_at`, `ends_at`
- `banners`: `image_url text NN`, `link_url text`
- `faqs`: `category text`

RLS: Public-Read(is_active만), Admin-Write.

---

## 9. System / Admin

### audit_logs (원칙 20 — 모든 관리자 행위 기록)
- `id PK`, `actor_id uuid NN FK→auth.users IDX`, `action text NN`, `target_table text`, `target_id uuid`, `before jsonb`, `after jsonb`, `ip_address inet`, `created_at IDX`

RLS: Admin-Read only(super_admin 우선 고려). **Insert는 DB 트리거로 자동 기록**(admin 관련 테이블 UPDATE/DELETE 시) — 애플리케이션 코드가 누락해도 남도록 트리거 기반을 우선하고, Edge Function에서 세부 컨텍스트(actor, ip)를 보강.

**2026-09-01 참고: `agency_permissions`(§12) 변경은 명시적으로 Audit Log 대상이다** — Agency 승인/권한 토글은 사업적으로 민감한 관리 행위이므로 §12의 트리거를 이 테이블과 연결한다(§10 트리거 요약 참조).

### system_logs
- `id PK`, `source text NN` (cron job 이름 등), `level text NN`, `message text`, `payload jsonb`, `created_at IDX`

RLS: Admin-Read only, Server-Only write.

### api_logs
- `id PK`, `function_name text NN IDX`, `user_id uuid`, `status_code int`, `duration_ms int`, `error text`, `created_at IDX`
- **민감정보(요청 body의 개인정보/금액 상세 등)는 기록하지 않는다** — 메타데이터 위주(원칙 19 "민감한 정보는 로그에 기록하지 않는다").

RLS: Admin-Read only, Server-Only write.

---

## 10. 트리거 요약

| 트리거 | 대상 | 목적 |
|---|---|---|
| `handle_new_user` | auth.users AFTER INSERT | profiles + user_roles('user') 자동 생성 |
| `properties_geom_sync` | properties BEFORE INSERT/UPDATE | lat/lng → PostGIS geom |
| `*_updated_at` | 갱신 가능한 전 테이블 | updated_at 자동 갱신 |
| `investment_orders_confirm` (SECONDARY) | investment_orders AFTER UPDATE (status→confirmed) | **PRIMARY 메커니즘 아님** — investment_transactions INSERT + investment_holdings 재계산의 주 처리는 `create-investment-order` Edge Function 내부 단일 DB 트랜잭션에서 수행한다(D9 ACCEPTED, 2026-08-27, DECISIONS.md 참조). 이 트리거는 감사/보정/방어적 검증(Edge Function 처리 누락 탐지 등) 목적의 SECONDARY 보조 수단으로만 사용한다. |
| `audit_log_admin_changes` | 관리 테이블(properties/investment_products/admin_push_campaigns 등) AFTER UPDATE/DELETE | audit_logs 자동 삽입 |
| `transactions_immutability_guard` | investment_transactions BEFORE UPDATE/DELETE | RAISE EXCEPTION (원칙: immutable) |
| `agency_permissions_audit_log` (2026-09-01 신규) | agency_permissions AFTER INSERT/UPDATE | audit_logs 자동 삽입 — Agency 권한 토글은 §9 원칙에 따라 반드시 감사 대상 |
| `admin_push_campaigns_stats_update` (2026-09-01 신규) | notification_deliveries AFTER INSERT/UPDATE (status 변경) | 소속 `admin_push_campaigns`의 `sent_count`/`success_count`/`failed_count` 집계 갱신 (Edge Function 결과 반영용 SECONDARY 보정 트리거 — PRIMARY 갱신은 `send-admin-push` Edge Function 내부에서 수행) |
| `property_messages_notify` (2026-09-01 신규) | property_messages AFTER INSERT | 상대방에게 알림 생성(§13) — 고객 수신자는 일반 Push, Agency 소속 수신자는 Push+다국어 처리 분기(ARCHITECTURE.md §7.7) |

---

## 11. 미결정 / 확인 필요 항목

(2026-08-27 STEP 4-1D 갱신: 이전 목록의 property_locations 필요 여부 / embedding 차원 / user_devices·push_tokens 역할 중복 / investment_holdings 재계산 방식 4개 항목은 CTO 승인으로 확정되어 이 목록에서 제거했다. 결정 내용은 DECISIONS.md D6/D4/D8/D9(모두 ACCEPTED)와 각각 본문 §2, embedding 컬럼 정의, §1/§7, §10을 참조.)

1. `investment_terms` 구조화 수준(개별 컬럼 vs jsonb) — 실제 상품 약관 샘플 확보 후 확정(DECISIONS.md D7, PENDING 유지).
2. Agency 가입/온보딩 플로우 — 신청 단계, 필요 서류, 자동/수동 승인 여부는 사업 결정 필요(DECISIONS.md D46, PENDING). 스키마(`agencies.approval_status`)는 이미 준비됨 — 플로우만 미확정.
3. 일반 회원의 Investor 전환 조건/트리거 — 자동 전환 vs 수동 신청 등(DECISIONS.md D47, PENDING). 스키마(`investors` 테이블)는 이미 준비됨 — INSERT를 발생시키는 비즈니스 로직만 미확정.
4. TTS/Voice Push 확장의 실제 적용 범위 — 어떤 알림 유형/언어부터 지원할지(DECISIONS.md D48, PENDING). §13의 Agency 알림 분기 구조는 이 확장을 전제로 설계했으나 실제 구현은 범위 미확정으로 보류.

이 문서는 설계 초안이며, 실제 `supabase/migrations/*.sql` 작성은 별도 작업으로 진행하고 각 마이그레이션은 개별 리뷰를 거친다.

---

## 12. Agency Domain (신규, 2026-09-01)

**설계 근거: DECISIONS.md D39(Agency 승인/권한 분리) ACCEPTED, ARCHITECTURE.md §7.1 참조. 구현 완료(STEP 1, 2026-09-01): `supabase/migrations/20260901071931_property_agency_foundation.sql`** — 아래 3개 테이블 + RLS + audit 연동까지 migration SQL로 실제 작성되었고, 이 세션의 임시 Postgres 16 인스턴스에서 실행 검증까지 마쳤다(연결된 실제 Supabase 프로젝트로의 `db push`는 Desktop에서 사용자가 직접 실행 필요). Agency 자체의 전역 승인 상태와, 승인된 Agency 안에서 기능별로 개별 토글되는 권한을 분리한다 — 하나의 필드로 통합하지 않는다.

### agencies
- `id PK`
- `name text NN`
- `approval_status agency_approval_status NN default 'pending' IDX` (pending/approved/rejected/suspended — Agency 전체를 게이트하는 상위 승인 상태)
- `business_registration_no text` (사업자등록번호 등 — 형식/검증 규칙은 온보딩 플로우 확정 시 결정, DECISIONS.md D46 PENDING)
- `contact jsonb`
- `approved_by uuid FK→auth.users` (nullable)
- `approved_at timestamptz` (nullable)
- `created_at timestamptz NN default now()`

RLS: Public-Read(approval_status='approved'인 행의 공개 가능 필드만 — 매물 상세 화면 등에서 "등록 Agency" 표시 목적. 구체적 컬럼 단위 제한은 SECURITY.md에서 세분화), Admin-Write(승인/반려/정지 처리).

### agency_members
Agency 소속 사용자(직원/대표) 관계.
- `id PK`
- `agency_id uuid NN FK→agencies IDX`
- `user_id uuid NN FK→auth.users(id) IDX`
- `role_in_agency agency_member_role NN default 'staff'` (owner/staff)
- `status text NN default 'active'` (active/removed — 소속 해제 시 row를 삭제하지 않고 status로 관리, 이력 보존)
- `UQ(agency_id, user_id)`
- `created_at timestamptz NN default now()`

RLS: Owner-Only SELECT(본인이 속한 agency_members row), 같은 agency의 owner는 자신 agency의 전체 멤버 SELECT 가능(RLS 정책에서 `agency_id IN (select agency_id from agency_members where user_id = auth.uid() and role_in_agency='owner')` 형태로 구현). Write는 Admin-Write + agency owner의 자기 소속 staff 초대/제거(세부 흐름은 D46 확정 후 API.md에 반영).

### agency_permissions — **EAV 구조 (2026-09-01, DECISIONS.md D39 ACCEPTED)**
승인된 Agency 안에서 기능 단위로 개별 토글되는 권한. 고정 boolean 컬럼 여러 개 대신 permission_type당 1 row 구조를 택해, 향후 새 권한 종류(특히 `post_writing`의 하위 유형 확장)가 추가돼도 이 테이블 구조 자체는 바뀌지 않는다.
- `id PK`
- `agency_id uuid NN FK→agencies IDX`
- `permission_type agency_permission_type NN` (property_listing/post_writing/chat/account_active)
- `enabled bool NN default false`
- `scope text` (nullable — 향후 post_writing 하위 유형 등 세분화 확장 자리, 현재는 미사용)
- `updated_by uuid FK→auth.users`
- `updated_at timestamptz`
- `UQ(agency_id, permission_type)`

**주의: `agencies.approval_status='approved'`이더라도 `agency_permissions`에 해당 permission_type row가 없거나 `enabled=false`이면 그 기능은 사용할 수 없다.** 즉 승인 여부와 개별 기능 권한은 AND 조건으로 결합되며 절대 하나의 필드로 합치지 않는다(D39 핵심 요구사항).

RLS: Public-Read(어떤 Agency가 어떤 기능을 쓸 수 있는지는 클라이언트가 UI 분기에 필요 — enabled 값만 공개, `updated_by` 등 내부 컬럼은 Admin-Read only로 컬럼 단위 제한 가능하나 Postgres RLS는 row 단위이므로 실제로는 뷰(view) 분리로 구현 예정, SECURITY.md에서 세부 설계). Write는 **Admin-Write만** — Agency 스스로 자기 권한을 토글할 수 없다. **모든 변경은 §9 audit_logs 대상**(`agency_permissions_audit_log` 트리거, §10 참조).

---

## 13. Property Consultation (Chat) (신규, 2026-09-01)

**설계 근거: DECISIONS.md D44(Property Chat 최초 스키마) ACCEPTED, ARCHITECTURE.md §7.7 참조.** 기존 Property 1:1 상담 요구사항(마스터 프롬프트)에 대한 최초의 실제 테이블 설계. Chat 기능 자체는 `agency_permissions.permission_type='chat'`이 `enabled=true`인 Agency에 한해 사용 가능(§12와 연결).

### property_conversations
- `id PK`
- `property_id uuid NN FK→properties IDX`
- `customer_id uuid NN FK→auth.users(id) IDX` (상담을 요청한 고객)
- `agency_id uuid FK→agencies` (nullable — 해당 매물이 Agency 소속이면 그 Agency, 개인/직영 매물이면 NULL)
- `broker_id uuid FK→auth.users(id)` (nullable — 실제 응대하는 담당자. `agency_id`가 있으면 해당 agency_members 중 1명, 없으면 직영 담당자)
- `status conversation_status NN default 'open'` (open/closed)
- `created_at timestamptz NN default now()`
- `IDX(customer_id)`, `IDX(agency_id)`, `IDX(broker_id)`

관계 보존: `property_id, agency_id, customer_id, broker_id`를 모두 이 테이블에 명시적으로 저장해, 이후 broker가 소속을 옮기거나 매물 소유가 바뀌어도 상담 이력이 당시 관계를 그대로 유지한다(요구사항 §8 원문 반영).

RLS: 대화 당사자(customer_id 또는 broker_id가 본인)만 SELECT — Owner-Only 변형(두 컬럼 중 하나가 `auth.uid()`인 행). Agency owner는 자신 agency의 전체 conversation을 볼 수 있도록 확장 가능(Phase 8 세부 설계). INSERT는 Auth-Read 사용자가 본인을 customer_id로 하여 생성(로그인 필요), broker_id 배정은 Server-Only 또는 Agency 측 로직.

### property_messages
- `id PK`
- `conversation_id uuid NN FK→property_conversations IDX`
- `sender_id uuid NN FK→auth.users(id)`
- `sender_role text NN` ('customer'|'broker')
- `body text NN`
- `created_at timestamptz NN default now() IDX`

RLS: 소속 `property_conversations`의 당사자만 SELECT/INSERT(RLS 서브쿼리로 `conversation_id`의 customer_id/broker_id 확인).

트리거: `property_messages_notify`(§10) — 새 메시지 발생 시 상대방에게 알림을 생성한다. 수신자가 고객이면 일반 Push, 수신자가 Agency 소속(broker)이면 Push + 다국어 처리 + 향후 Voice/TTS 확장 자리(TTS 자체는 범위 밖, DECISIONS.md D48 PENDING, §11 항목 4 참조).
