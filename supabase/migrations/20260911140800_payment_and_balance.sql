-- [2026-09-11 사용자 지시] 결제·QR 입금·잔액 (2단계).
--
-- 흐름:
--   관리자가 QR과 금액을 미리 등록 → 승인된 중개업소가 MY > 결제 버튼으로 결제정보를
--   열고(업체명·입금금액·QR) QR로 입금 → "입금했습니다" 신고 → 관리자 목록에 뜸 →
--   관리자가 실제 입금을 확인하고 승인 → 잔액에 반영 → MY 상단에 사용잔액/현잔액 노출.
--
-- 사용자 정의(그대로 따른다):
--   사용잔액 = 지금 쓸 수 있는 돈 (총 입금 − 총 사용)   ← 크게(주황)
--   현잔액   = 지금까지 입금한 누적 금액                 ← 작게(회색)
--
-- 왜 잔액 컬럼을 두지 않고 원장(balance_entries)으로 쌓는가:
-- 잔액을 숫자 하나로 들고 있으면 "얼마가 왜 빠졌는지"가 남지 않는다. 입금 승인(+)과
-- 사용(−)을 한 테이블에 쌓으면 두 값이 언제나 합계로 맞아떨어지고, 관리자가 나중에
-- 내역을 짚을 수 있다. 잔액은 합계로 계산한다.
--
-- 요금(사용자 결정):
--   입금액   — 관리자가 정한 고정액 2종(중개번호 있음 / 없음)
--   매물 등록 — 1건당 고정액. **잔액이 모자라도 등록은 막지 않고 미노출(draft)로 저장한다.**
--   추천 매물 — 기간제(1일 요금 × 일수). 기간이 끝나면 추천에서 내려간다.
--
-- 이전 마이그레이션: 20260911135210_agency_application.sql

-- ============================================================================
-- 1. enum
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_request_status') then
    create type public.payment_request_status as enum ('pending', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'balance_entry_kind') then
    create type public.balance_entry_kind as enum (
      'deposit',            -- 관리자가 확인한 입금(+)
      'property_register',  -- 매물 등록 요금(−)
      'featured',           -- 추천 매물 기간 구매(−)
      'adjustment'          -- 관리자 수기 조정(±)
    );
  end if;
end
$$;

-- ============================================================================
-- 2. payment_settings — 관리자가 미리 등록하는 QR과 금액 (행 하나)
-- ============================================================================
--
-- 설정은 앱 전체에 하나뿐이라 id를 'default'로 고정한다. 여러 행이 생겨 "어느 것이
-- 진짜 설정인가"를 고민하게 되는 상황을 애초에 막는다.

create table if not exists public.payment_settings (
  id text primary key default 'default' check (id = 'default'),
  deposit_with_license numeric(18, 2) not null default 0,
  deposit_without_license numeric(18, 2) not null default 0,
  property_register_fee numeric(18, 2) not null default 0,
  featured_daily_fee numeric(18, 2) not null default 0,
  qr_image_path text,
  bank_info text,
  currency text not null default 'VND',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz
);

comment on column public.payment_settings.deposit_with_license is
  '부동산중개번호가 있는 업체의 입금액. 중개번호 유무로 조건을 달리한다는 사용자 결정에 따라 두 값을 따로 둔다.';
comment on column public.payment_settings.deposit_without_license is '중개번호가 없는 업체의 입금액.';
comment on column public.payment_settings.property_register_fee is '매물 1건 등록 시 차감액.';
comment on column public.payment_settings.featured_daily_fee is '추천 매물 1일 요금 — 구매 일수를 곱해 차감한다.';
comment on column public.payment_settings.qr_image_path is
  '입금용 QR 이미지의 storage 경로(공개 버킷 payment-assets). 입금하는 사람이 봐야 하므로 비공개로 두지 않는다.';

insert into public.payment_settings (id) values ('default') on conflict (id) do nothing;

alter table public.payment_settings enable row level security;

-- 금액과 QR은 입금할 사람이 봐야 한다 — 읽기는 열고, 쓰기는 관리자만.
drop policy if exists "payment_settings_select_all" on public.payment_settings;
create policy "payment_settings_select_all"
  on public.payment_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "payment_settings_update_admin" on public.payment_settings;
create policy "payment_settings_update_admin"
  on public.payment_settings for update
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- GRANT이 없으면 정책이 통과해도 permission denied가 난다(2026-09-09·10·11에 세 번
-- 겪은 자리 — 마이그레이션으로 만든 테이블에는 Supabase가 자동으로 주지 않는다).
grant select on public.payment_settings to anon;
grant select, update on public.payment_settings to authenticated;

-- QR 이미지 버킷 — 공개(입금 화면에서 바로 보여야 한다).
insert into storage.buckets (id, name, public)
values ('payment-assets', 'payment-assets', true)
on conflict (id) do nothing;

drop policy if exists "payment_assets_admin_write" on storage.objects;
create policy "payment_assets_admin_write"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'payment-assets' and public.is_admin_or_above());

drop policy if exists "payment_assets_admin_update" on storage.objects;
create policy "payment_assets_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'payment-assets' and public.is_admin_or_above())
  with check (bucket_id = 'payment-assets' and public.is_admin_or_above());

drop policy if exists "payment_assets_admin_delete" on storage.objects;
create policy "payment_assets_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'payment-assets' and public.is_admin_or_above());

-- ============================================================================
-- 3. payment_requests — 입금 신고
-- ============================================================================
--
-- 이 단계가 빠져 있으면 관리자가 승인할 대상 자체가 생기지 않는다(요구사항에 없던
-- 부분 — 입금은 은행에서 일어나므로 앱은 "입금했다"는 신고를 받아야 한다).

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  amount numeric(18, 2) not null check (amount > 0),
  status public.payment_request_status not null default 'pending',
  note text,
  reject_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payment_requests_status_idx on public.payment_requests (status);
create index if not exists payment_requests_agency_idx on public.payment_requests (agency_id);

alter table public.payment_requests enable row level security;

-- 읽기만 정책으로 연다. 쓰기는 전부 아래 함수를 거친다 — 신고 금액이나 상태를
-- 클라이언트가 직접 쓰게 두면 승인 없이 잔액을 만들 수 있다.
drop policy if exists "payment_requests_select_own" on public.payment_requests;
create policy "payment_requests_select_own"
  on public.payment_requests for select
  to authenticated
  using (public.is_active_agency_member(agency_id));

drop policy if exists "payment_requests_select_admin" on public.payment_requests;
create policy "payment_requests_select_admin"
  on public.payment_requests for select
  to authenticated
  using (public.is_admin_or_above());

grant select on public.payment_requests to authenticated;

-- ============================================================================
-- 4. balance_entries — 잔액 원장
-- ============================================================================

create table if not exists public.balance_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  /** 입금은 +, 사용은 −. 부호로 방향을 담아 합계 하나로 잔액이 나오게 한다. */
  amount numeric(18, 2) not null,
  kind public.balance_entry_kind not null,
  /** 어떤 매물/입금신고 때문에 생긴 줄인지 — 내역을 짚을 때 쓴다. */
  ref_id uuid,
  memo text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists balance_entries_agency_idx on public.balance_entries (agency_id, created_at desc);

alter table public.balance_entries enable row level security;

drop policy if exists "balance_entries_select_own" on public.balance_entries;
create policy "balance_entries_select_own"
  on public.balance_entries for select
  to authenticated
  using (public.is_active_agency_member(agency_id));

drop policy if exists "balance_entries_select_admin" on public.balance_entries;
create policy "balance_entries_select_admin"
  on public.balance_entries for select
  to authenticated
  using (public.is_admin_or_above());

-- INSERT/UPDATE/DELETE 정책을 일부러 두지 않는다 — 원장은 아래 SECURITY DEFINER
-- 함수들만 쓴다. 클라이언트가 직접 +1억짜리 줄을 넣을 길이 없어야 한다.
grant select on public.balance_entries to authenticated;

-- ============================================================================
-- 5. 추천 매물 기간
-- ============================================================================
--
-- 기간제(1일 요금 × 일수)라 "언제까지 추천인지"가 필요하다. featured만으로는 만료를
-- 표현할 수 없다 — featured는 그대로 두고(기존 화면이 그 값을 본다) 만료 시각을 더한다.

alter table public.properties
  add column if not exists featured_until timestamptz;

comment on column public.properties.featured_until is
  '추천 매물 노출 만료 시각. 기간제 유료 서비스라 featured=true여도 이 시각이 지나면 추천이 아니다 — 조회하는 쪽이 featured and (featured_until is null or featured_until > now())로 판단한다(NULL은 관리자가 수동 큐레이션한 무기한 추천).';

-- ============================================================================
-- 6. 잔액 조회
-- ============================================================================

create or replace function public.agency_balance(target_agency uuid)
returns table (total_deposited numeric, total_spent numeric, available numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(e.amount) filter (where e.amount > 0), 0) as total_deposited,
    coalesce(-sum(e.amount) filter (where e.amount < 0), 0) as total_spent,
    coalesce(sum(e.amount), 0) as available
  from public.balance_entries e
  where e.agency_id = target_agency
    and (public.is_admin_or_above() or public.is_active_agency_member(target_agency));
$$;

revoke all on function public.agency_balance(uuid) from public;
grant execute on function public.agency_balance(uuid) to authenticated;

comment on function public.agency_balance(uuid) is
  '이 Agency의 잔액 — total_deposited(누적 입금=현잔액), total_spent(누적 사용), available(쓸 수 있는 돈=사용잔액). 남의 Agency를 넣으면 전부 0이 돌아온다(SECURITY DEFINER라 RLS를 우회하므로 함수 안에서 직접 확인한다).';

-- ============================================================================
-- 7. 입금 신고 / 승인
-- ============================================================================

create or replace function public.submit_payment_request(p_amount numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_id uuid;
begin
  select m.agency_id into v_agency_id
  from public.agency_members m
  join public.agencies a on a.id = m.agency_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and a.approval_status = 'approved'
  order by m.created_at desc
  limit 1;

  if v_agency_id is null then
    raise exception 'not-approved-agency';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid-amount';
  end if;

  -- 같은 업체가 심사 중인 신고를 여러 건 쌓으면 관리자가 어느 입금인지 가릴 수 없다.
  if exists (
    select 1 from public.payment_requests
    where agency_id = v_agency_id and status = 'pending'
  ) then
    raise exception 'already-pending';
  end if;

  insert into public.payment_requests (agency_id, requested_by, amount, note)
  values (v_agency_id, auth.uid(), p_amount, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_payment_request(numeric, text) from public;
grant execute on function public.submit_payment_request(numeric, text) to authenticated;

create or replace function public.admin_review_payment(
  target_request uuid,
  approve boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.payment_requests;
begin
  if not public.is_admin_or_above() then
    raise exception 'forbidden';
  end if;

  select * into v_req from public.payment_requests where id = target_request for update;
  if v_req.id is null then
    raise exception 'not-found';
  end if;
  -- 이미 처리한 신고를 다시 승인해 잔액이 두 번 올라가는 일을 막는다.
  if v_req.status <> 'pending' then
    raise exception 'already-reviewed';
  end if;

  if approve then
    update public.payment_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = null
    where id = target_request;

    insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
    values (v_req.agency_id, v_req.amount, 'deposit', target_request, v_req.note, auth.uid());
  else
    update public.payment_requests
    set status = 'rejected',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        reject_reason = nullif(btrim(coalesce(reason, '')), '')
    where id = target_request;
  end if;
end;
$$;

revoke all on function public.admin_review_payment(uuid, boolean, text) from public;
grant execute on function public.admin_review_payment(uuid, boolean, text) to authenticated;

-- ============================================================================
-- 8. 사용 — 매물 등록 요금
-- ============================================================================
--
-- 사용자 결정: 잔액이 모자라도 등록을 막지 않고 **미노출(draft)로 저장**한다.
-- 그래서 이 함수는 "차감했는가"를 돌려주고, 못 했으면 그 매물을 draft로 내린다.
-- 요금이 0이면(아직 요금을 정하지 않은 초기 상태) 아무 것도 하지 않는다.

create or replace function public.charge_property_register(p_property_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee numeric;
  v_agency uuid;
  v_available numeric;
begin
  select property_register_fee into v_fee from public.payment_settings where id = 'default';
  if coalesce(v_fee, 0) <= 0 then
    return true;
  end if;

  select agency_id into v_agency from public.properties where id = p_property_id;
  -- Agency 없이 등록하는 계정(관리자/개별 property_manage)은 요금 대상이 아니다.
  if v_agency is null then
    return true;
  end if;

  if not (public.is_admin_or_above() or public.is_active_agency_member(v_agency)) then
    raise exception 'forbidden';
  end if;

  -- 같은 매물에 두 번 물리지 않는다(수정으로 다시 저장해도 요금은 등록 1회분이다).
  if exists (
    select 1 from public.balance_entries
    where kind = 'property_register' and ref_id = p_property_id
  ) then
    return true;
  end if;

  select available into v_available from public.agency_balance(v_agency);

  if coalesce(v_available, 0) < v_fee then
    update public.properties set status = 'draft' where id = p_property_id;
    return false;
  end if;

  insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
  values (v_agency, -v_fee, 'property_register', p_property_id, null, auth.uid());

  return true;
end;
$$;

revoke all on function public.charge_property_register(uuid) from public;
grant execute on function public.charge_property_register(uuid) to authenticated;

-- ============================================================================
-- 9. 사용 — 추천 매물(기간제)
-- ============================================================================

create or replace function public.purchase_featured(p_property_id uuid, p_days int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daily numeric;
  v_cost numeric;
  v_agency uuid;
  v_available numeric;
  v_from timestamptz;
begin
  if p_days is null or p_days <= 0 then
    raise exception 'invalid-days';
  end if;

  select featured_daily_fee into v_daily from public.payment_settings where id = 'default';
  if coalesce(v_daily, 0) <= 0 then
    raise exception 'fee-not-set';
  end if;

  select agency_id, greatest(coalesce(featured_until, now()), now())
    into v_agency, v_from
  from public.properties
  where id = p_property_id;

  if v_agency is null then
    raise exception 'no-agency';
  end if;

  if not (public.is_admin_or_above() or public.is_active_agency_member(v_agency)) then
    raise exception 'forbidden';
  end if;

  v_cost := v_daily * p_days;

  select available into v_available from public.agency_balance(v_agency);
  if coalesce(v_available, 0) < v_cost then
    return false;
  end if;

  insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
  values (v_agency, -v_cost, 'featured', p_property_id, p_days::text || 'd', auth.uid());

  -- 이미 추천 중이면 남은 기간 뒤에 이어 붙인다(중복 구매로 기간이 사라지지 않게).
  update public.properties
  set featured = true,
      featured_until = v_from + make_interval(days => p_days)
  where id = p_property_id;

  return true;
end;
$$;

revoke all on function public.purchase_featured(uuid, int) from public;
grant execute on function public.purchase_featured(uuid, int) to authenticated;

comment on function public.purchase_featured(uuid, int) is
  '추천 매물 기간 구매 — 1일 요금 × 일수를 차감하고 featured_until을 늘린다. 잔액이 모자라면 아무것도 바꾸지 않고 false. 이미 추천 중이면 남은 기간 뒤에 이어 붙인다.';
