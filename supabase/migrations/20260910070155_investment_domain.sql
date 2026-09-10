-- STEP 05 — Investment Domain (투자 의향 접수 범위).
--
-- 사업 결정 반영:
--   D10 = "투자 의향 접수만"(금액 저장, 실제 결제/정산 없음) — PG 연동/입출금/배당
--         지급은 이번 범위에서 제외한다. 따라서 DATABASE.md §3의
--         investment_transactions / investment_holdings / dividends 3개 테이블은
--         이번 migration에서 만들지 않는다(실제 데이터가 생길 수 없는 테이블).
--   D47 = "첫 투자 신청 시 investors 자동 생성"(심사 없음) — 아래 트리거로 구현.
--
-- ⚠️ GRANT 필수(2026-09-10 규칙, DATABASE.md 상단): RLS 정책만으로는 접근이 전부 막힌다.

-- ---------------------------------------------------------------------------
-- 0. enum (DATABASE.md §0 정의 그대로)
-- ---------------------------------------------------------------------------

create type public.investment_product_type as enum ('reit_share', 'co_investment', 'fund', 'bond_like');
create type public.investment_risk_level as enum ('low', 'medium', 'high');
create type public.investment_product_status as enum (
  'draft', 'pending_review', 'open', 'closed', 'fundraising_failed', 'completed', 'cancelled'
);
create type public.investment_order_status as enum ('pending', 'confirmed', 'failed', 'cancelled', 'refunded');

-- ---------------------------------------------------------------------------
-- 1. investors — 투자자 자격 (DATABASE.md §1)
-- ---------------------------------------------------------------------------

create table public.investors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- 값 enum화는 실제 KYC/심사 프로세스 확정 시로 유예(DATABASE.md §1 원문 유지).
  -- D47(첫 신청 시 자동 생성, 심사 없음)이므로 현재 생성되는 값은 항상 'active'다.
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index investors_user_id_idx on public.investors (user_id);

comment on table public.investors is
  '투자자 자격. D47(2026-09-10 확정): 첫 투자 신청 시 investment_orders 트리거로 자동 생성되며 별도 심사 단계가 없다. 심사/KYC 도입 시 status 값을 enum화하고 트리거를 재검토한다.';

alter table public.investors enable row level security;

-- 본인 투자자 자격만 조회 가능. INSERT는 정책을 두지 않는다 — 아래 트리거
-- (SECURITY DEFINER)로만 생성되며 클라이언트 직접 INSERT는 차단된다.
create policy "investors_select_own"
  on public.investors for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. investment_products — 투자상품 (DATABASE.md §3)
-- ---------------------------------------------------------------------------

create table public.investment_products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  property_id uuid references public.properties(id) on delete set null,
  product_type public.investment_product_type not null,
  target_amount numeric(18, 2) not null,
  minimum_investment numeric(18, 2) not null,
  -- D37(ACCEPTED): 통화 default를 properties에서 상속하지 않는다 — 명시 입력.
  currency text not null default 'VND',
  expected_return numeric(6, 3),
  investment_period_months int,
  dividend_frequency text check (dividend_frequency in ('monthly', 'quarterly', 'yearly')),
  risk_level public.investment_risk_level not null,
  start_at timestamptz,
  end_at timestamptz,
  status public.investment_product_status not null default 'draft',
  -- derived cache: 정본은 investment_orders 합계다. D10(의향 접수만) 범위에서는
  -- 실제 입금이 없으므로 관리자가 직접 관리하는 값으로 시작한다(트리거 없음).
  raised_amount numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index investment_products_status_idx on public.investment_products (status);
create index investment_products_property_id_idx on public.investment_products (property_id);

comment on column public.investment_products.raised_amount is
  '모집 금액 캐시. D10(투자 의향 접수만, 2026-09-10) 범위에서는 실제 입금이 없어 트리거 자동 집계를 두지 않는다 — 관리자 입력값. 결제/정산 도입 시 investment_orders 합계 기반 트리거로 교체한다.';

alter table public.investment_products enable row level security;

-- 공개 조회: 모집중(open)/완료(completed) 상품만. 나머지 상태는 admin 계열만.
create policy "investment_products_select_public"
  on public.investment_products for select
  to anon, authenticated
  using (status in ('open', 'completed'));

create policy "investment_products_select_admin"
  on public.investment_products for select
  to authenticated
  using (public.is_admin_or_above());

create policy "investment_products_insert_admin"
  on public.investment_products for insert
  to authenticated
  with check (public.is_admin_or_above());

create policy "investment_products_update_admin"
  on public.investment_products for update
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

create policy "investment_products_delete_admin"
  on public.investment_products for delete
  to authenticated
  using (public.is_admin_or_above());

create trigger investment_products_updated_at
  before update on public.investment_products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. investment_orders — 투자 신청(의향) (DATABASE.md §3)
-- ---------------------------------------------------------------------------

create table public.investment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.investment_products(id) on delete restrict,
  amount numeric(18, 2) not null check (amount > 0),
  currency text not null default 'VND',
  status public.investment_order_status not null default 'pending',
  order_type text not null default 'buy' check (order_type in ('buy', 'sell')),
  -- 의향 접수 단계에서 담당자가 연락할 수단. profiles.phone과 별개로, 신청 시점에
  -- 사용자가 입력한 값을 그대로 보관한다(프로필 변경과 무관하게 신청 이력 보존).
  contact_phone text,
  note text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index investment_orders_user_id_idx on public.investment_orders (user_id, created_at desc);
create index investment_orders_product_id_idx on public.investment_orders (product_id);

comment on table public.investment_orders is
  '투자 신청. D10(2026-09-10 확정: 투자 의향 접수만)에 따라 실제 결제/체결은 없다 — 클라이언트가 status=pending 행만 직접 생성할 수 있고, confirmed/cancelled 등 상태 전이는 admin만 수행한다. 결제 도입 시 DATABASE.md §3 원안대로 create-investment-order Edge Function(Server-Only write)으로 교체한다.';

alter table public.investment_orders enable row level security;

create policy "investment_orders_select_own"
  on public.investment_orders for select
  to authenticated
  using (user_id = auth.uid());

create policy "investment_orders_select_admin"
  on public.investment_orders for select
  to authenticated
  using (public.is_admin_or_above());

-- 본인 신청만, 그리고 반드시 pending 상태로만 생성 가능하다(사용자가 자기 신청을
-- 곧바로 confirmed로 만들 수 없게 강제).
create policy "investment_orders_insert_own_pending"
  on public.investment_orders for insert
  to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- 상태 전이(승인/취소 처리)는 admin만. 사용자는 자기 신청을 수정할 수 없다
-- (취소가 필요하면 담당자에게 요청 — 의향 접수 단계의 운영 방식).
create policy "investment_orders_update_admin"
  on public.investment_orders for update
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- ---------------------------------------------------------------------------
-- 4. D47 — 첫 투자 신청 시 investors 자동 생성
-- ---------------------------------------------------------------------------

create or replace function public.ensure_investor_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 이미 투자자면 아무 것도 하지 않는다(UNIQUE(user_id) 기준).
  insert into public.investors (user_id)
  values (new.user_id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

comment on function public.ensure_investor_on_order() is
  'D47(2026-09-10 확정): 첫 투자 신청 시 투자자 자격을 자동 부여한다. SECURITY DEFINER인 이유 — investors에는 클라이언트 INSERT 정책이 없어 이 트리거를 통해서만 행이 생성되도록 하기 위함이다.';

create trigger investment_orders_ensure_investor
  after insert on public.investment_orders
  for each row execute function public.ensure_investor_on_order();

-- ---------------------------------------------------------------------------
-- 5. GRANT
-- ---------------------------------------------------------------------------

grant select on public.investment_products to anon, authenticated;
grant insert, update, delete on public.investment_products to authenticated;

grant select on public.investors to authenticated;

-- 사용자는 신청 생성/조회만. 삭제 권한은 주지 않는다(신청 이력은 보존).
grant select, insert on public.investment_orders to authenticated;
grant update on public.investment_orders to authenticated;
