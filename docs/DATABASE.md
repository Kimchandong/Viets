# DATABASE.md — Viet's

버전: v0.1 (설계 초안, 실제 migration SQL 미작성) · 작성일: 2026-08-26
상태: **설계 문서 — 실제 `supabase/migrations/*.sql`은 이 문서 승인 후 별도 작업으로 작성**(원칙 8: DB 변경은 반드시 migration SQL로 관리).

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

### user_devices
Push token/기기 관리를 겸함(원칙 19 Device Management).
- `id PK`
- `user_id uuid NN FK→auth.users(id) IDX`
- `device_id text NN` (기기 고유값)
- `platform text NN` ('ios'|'android')
- `push_token text` (FCM token — push_tokens와 역할 분리: 여기는 세션/기기 식별, push_tokens는 발송 대상 관리. Phase 8에서 통합 여부 재검토)
- `app_version text`
- `last_seen_at timestamptz`
- `UQ(user_id, device_id)`

RLS: Owner-Only.

### user_preferences
- `id PK`
- `user_id uuid NN UQ FK→auth.users(id)`
- `preferred_language language_code`
- `notification_opt_in jsonb NN default '{}'` (알림 종류별 on/off)
- `watch_regions jsonb` (관심 지역 목록, 캐시성 — 정본은 watchlists)

RLS: Owner-Only.

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
- `status property_status NN default 'draft' IDX`
- `embedding vector(1536)` (RAG용 — 제목+설명 임베딩, Phase 6에서 채움)
- `IDX GIST(geom)` (반경 검색), `IDX(status, category)`, `IDX(price)`, `IDX(rental_yield)`

RLS: Public-Read (status='active'인 행만), 그 외 status는 소유 admin/reviewer만. INSERT/UPDATE는 Admin-Write + 향후 "매물 등록 요청" 플로우가 생기면 owner 본인 제출 → reviewer 승인 구조(Phase 4에서 세부 설계).

트리거: `properties_geom_sync` (lat/lng → geom), `properties_updated_at`.

### property_images / property_documents
- `id PK`, `property_id uuid NN FK→properties IDX`, `url text NN`, `sort_order int default 0`
- `property_documents`에는 `doc_type text`, `title text` 추가 (등기부등본 등 — Private Storage + Signed URL)

RLS: property가 Public-Read 대상이면 이미지도 Public-Read, 문서는 로그인 필요 시 Auth-Read로 더 제한 가능(문서 민감도에 따라 SECURITY.md에서 세분화).

### property_locations
`properties.province_id/district_id/ward_id`로 이미 정규화했으므로, 이 테이블은 "다중 위치 태깅"(예: 한 개발단지가 여러 구역에 걸침) 등 1:N 관계가 필요할 때만 사용. 기본 설계는 properties에 내장된 단일 위치로 충분 — **이 테이블의 실제 필요 여부는 Phase 4 설계 시 재검증**(과설계 방지).

---

## 3. Investment Domain

### investment_products
- `id PK`
- `title text NN`, `property_id uuid FK→properties`
- `product_type investment_product_type NN`
- `target_amount numeric(18,2) NN`, `minimum_investment numeric(18,2) NN`
- `expected_return numeric(6,3)`, `investment_period_months int`
- `dividend_frequency text` ('monthly'|'quarterly'|'yearly')
- `risk_level investment_risk_level NN`
- `start_at timestamptz`, `end_at timestamptz`
- `status investment_product_status NN default 'draft' IDX`
- `raised_amount numeric(18,2) NN default 0` (모집률 표시용 — **derived cache**, 실제 정본은 investment_orders 합계이며 트리거로만 갱신, 클라이언트 직접 UPDATE 금지)
- `embedding vector(1536)`

RLS: Public-Read(status IN ('open','completed')), Admin/Reviewer는 전체. Write는 Admin-Write(생성은 `create-investment-product` Edge Function 경유 원칙 15).

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

RLS: Owner-Only SELECT. **INSERT/UPDATE는 Server-Only** — 클라이언트는 `create-investment-order` Edge Function만 호출, 함수 내부에서 service role로 기록(원칙 13: 단순 UPDATE로 잔액 관리 금지).

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

RLS: Owner-Only SELECT. Write는 오직 `investment_transactions` INSERT에 반응하는 **트리거/Edge Function**을 통해서만 재계산(클라이언트 직접 UPDATE 절대 금지 — 원칙 13 정면 대응).

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

---

## 4. User Engagement

### watchlists / favorites
- `id PK`, `user_id FK NN IDX`, `target_type text NN` ('property'|'investment_product'), `target_id uuid NN`, `UQ(user_id, target_type, target_id)`

RLS: Owner-Only (전체 CRUD 본인 소유 한정 — 이 테이블은 예외적으로 클라이언트 직접 write 허용, 금전 데이터가 아니므로).

### price_alerts
- `id PK`, `user_id FK NN`, `target_type text NN`, `target_id uuid NN`, `condition text NN` ('price_below'|'yield_above' 등), `threshold numeric NN`, `is_active bool default true`

RLS: Owner-Only.

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

### notifications (in-app 알림 로그, 사용자별)
- `id PK`, `user_id FK NN IDX`, `title text NN`, `body text`, `type text NN`, `deep_link text`, `is_read bool default false`, `IDX(user_id, is_read)`

RLS: Owner-Only.

### notification_templates
- `id PK`, `code text NN UQ`, `channel notification_channel NN`, `title_i18n jsonb NN`, `body_i18n jsonb NN`

RLS: Admin-only.

### notification_campaigns
- `id PK`, `template_id FK`, `target_type notification_target_type NN`, `target_filter jsonb` (지역/상품/세그먼트 조건), `scheduled_at timestamptz`, `sent_at timestamptz`, `status text NN default 'draft'`, `image_url text`, `deep_link text`, `created_by uuid FK→auth.users`

RLS: Admin-only(전체 CRUD, role 세분화는 SECURITY.md).

### notification_deliveries
- `id PK`, `campaign_id FK IDX`, `user_id FK IDX`, `push_token text`, `status push_delivery_status NN`, `sent_at`, `error text`

RLS: Admin-Read only, Server-Only write.

### push_tokens
- `id PK`, `user_id FK NN IDX`, `token text NN UQ`, `platform text NN`, `is_active bool default true`

RLS: Owner-Only.

### push_topics
- `id PK`, `code text NN UQ`, `description text` (FCM topic 매핑 — 지역/관심상품 구독 그룹)

RLS: Public-Read(코드 목록), Admin-Write.

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
| `investment_orders_confirm` | investment_orders AFTER UPDATE (status→confirmed) | investment_transactions 기록 + investment_holdings 재계산 (Edge Function 내부 트랜잭션 권장, DB 트리거는 보조 방어선) |
| `audit_log_admin_changes` | 관리 테이블(properties/investment_products/notification_campaigns 등) AFTER UPDATE/DELETE | audit_logs 자동 삽입 |
| `transactions_immutability_guard` | investment_transactions BEFORE UPDATE/DELETE | RAISE EXCEPTION (원칙: immutable) |

---

## 11. 미결정 / 확인 필요 항목

1. `property_locations` 테이블의 실제 필요 여부(1:N 위치 태깅 요구사항이 실제로 있는지) — Phase 4에서 재확인.
2. `investment_terms` 구조화 수준(개별 컬럼 vs jsonb) — 실제 상품 약관 샘플 확보 후 확정.
3. Embedding 차원(1536)은 OpenAI text-embedding-3-small 기준 가정 — LLM/Embedding Provider 확정 후 조정 가능.
4. `user_devices`와 `push_tokens`의 역할 중복 — Phase 8 설계 시 통합 여부 결정.
5. investment_holdings 재계산을 DB 트리거로 할지 Edge Function 트랜잭션으로 할지 — 금전 정합성 요구 수준에 따라 Phase 5에서 확정(현재는 Edge Function 우선 제안).

이 문서는 설계 초안이며, 실제 `supabase/migrations/*.sql` 작성은 별도 작업으로 진행하고 각 마이그레이션은 개별 리뷰를 거친다.
