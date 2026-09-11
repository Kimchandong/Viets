-- [2026-09-11 사용자 지시 — 3차] 정산 구조 정리.
--
-- 바뀐 것(이전 마이그레이션 20260911140800과 의미가 달라진 부분):
--   · deposit_with_license / deposit_without_license 는 "입금액"이 아니라
--     **매물 1건 등록 시 차감되는 등록비**다. 중개번호가 있는 업체(등록비 중개업소)와
--     없는 업체(등록비 일반)에 서로 다른 금액을 매긴다 → register_fee_agency /
--     register_fee_general 로 이름을 맞춘다.
--   · 그래서 별도로 두었던 property_register_fee 는 필요 없어졌다 — 위 두 값이
--     그 역할을 대신한다.
--   · 입금액은 이제 **신청자가 직접 적는다**(충전식). 관리자가 정할 값이 아니다.
--   · 계좌 안내는 자유 텍스트 한 칸 대신 은행명/예금주/계좌번호 세 칸으로 나눈다 —
--     화면에서 "은행명 · 예금주" 한 줄, "계좌번호" 한 줄로 배치해야 하므로 값이
--     따로 있어야 한다.
--
-- 이전 마이그레이션: 20260911140800_payment_and_balance.sql

-- ============================================================================
-- 1. payment_settings 재정리
-- ============================================================================
--
-- rename은 이미 바꾼 뒤 다시 돌리면 실패하므로 컬럼 존재를 확인하고 실행한다.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_settings'
      and column_name = 'deposit_with_license'
  ) then
    alter table public.payment_settings rename column deposit_with_license to register_fee_agency;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_settings'
      and column_name = 'deposit_without_license'
  ) then
    alter table public.payment_settings rename column deposit_without_license to register_fee_general;
  end if;
end
$$;

alter table public.payment_settings
  drop column if exists property_register_fee,
  drop column if exists bank_info,
  add column if not exists bank_name text,
  add column if not exists account_holder text,
  add column if not exists account_number text;

comment on column public.payment_settings.register_fee_agency is
  '등록비(중개업소) — 부동산중개번호를 등록한 업체가 매물 1건을 올릴 때 잔액에서 차감되는 금액.';
comment on column public.payment_settings.register_fee_general is
  '등록비(일반) — 중개번호가 없는 업체의 매물 1건당 차감액. 중개번호 유무로 요금을 다르게 한다는 사용자 결정에 따라 두 값을 따로 둔다.';
comment on column public.payment_settings.featured_daily_fee is
  '추천매물(1일) — 추천 노출 하루치 요금. 구매 일수를 곱해 차감한다.';
comment on column public.payment_settings.bank_name is '입금 계좌 은행명.';
comment on column public.payment_settings.account_holder is '예금주.';
comment on column public.payment_settings.account_number is '계좌번호.';

-- ============================================================================
-- 2. 등록비 차감 — 중개번호 유무로 금액이 갈린다
-- ============================================================================
--
-- 이전 버전은 payment_settings.property_register_fee 하나만 봤다. 이제 그 컬럼이
-- 없으므로, 매물을 올린 업체의 business_registration_no 유무로 두 요금 중 하나를 고른다.
-- 잔액이 모자라면 요금을 물리지 않고 매물을 미노출(draft)로 내리는 동작은 그대로다.

create or replace function public.charge_property_register(p_property_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_fee numeric;
  v_available numeric;
begin
  select agency_id into v_agency from public.properties where id = p_property_id;

  -- Agency 없이 등록하는 계정(관리자/개별 property_manage)은 요금 대상이 아니다.
  if v_agency is null then
    return true;
  end if;

  if not (public.is_admin_or_above() or public.is_active_agency_member(v_agency)) then
    raise exception 'forbidden';
  end if;

  select case
           when nullif(btrim(coalesce(a.business_registration_no, '')), '') is not null
             then s.register_fee_agency
           else s.register_fee_general
         end
    into v_fee
  from public.agencies a
  cross join public.payment_settings s
  where a.id = v_agency and s.id = 'default';

  -- 아직 요금을 정하지 않았으면(0) 차감하지 않는다.
  if coalesce(v_fee, 0) <= 0 then
    return true;
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

comment on function public.charge_property_register(uuid) is
  '매물 등록비 차감 — 업체의 중개번호 유무로 register_fee_agency / register_fee_general 중 하나를 고른다. 잔액이 모자라면 차감하지 않고 그 매물을 draft로 내린 뒤 false를 돌려준다.';
