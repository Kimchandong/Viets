-- ============================================================================
-- [2026-09-12 사용자 지시] 광고 슬롯 — 추천매물 / TOP10 (오버추어식 금액 순위)
--
-- 바뀌는 것: 추천매물이 "1일 요금 × 일수"(purchase_featured)에서 **입찰 금액 순위**로
-- 바뀐다. 매물은 원하는 순위를 눌러 그 자리에 있는 매물의 광고비보다 높은 금액을
-- 내면 그 순위로 들어가고, 밀려난 매물은 순위가 한 칸 내려간다(환불 없음 — 사용자 결정).
--
-- 왜 properties에 칼럼을 더 붙이지 않고 별도 테이블인가:
--   ① 한 매물이 추천과 TOP10을 동시에 살 수 있어야 해서 자리마다 행이 하나씩 필요하다.
--   ② 순위 조회가 "placement별 금액 내림차순"인데, properties에 칼럼을 두면
--      추천/TOP10 두 벌의 인덱스를 매물 테이블에 달아야 한다.
--
-- 과금(사용자 결정): 진입할 때 입찰 금액을 **1회** 차감한다. 매일 빠져나가지 않고,
-- 더 높은 금액이 들어와 밀려날 때까지 그 순위를 유지한다. 같은 매물이 금액을 올리면
-- 차액만 받는다 — 전액을 다시 받으면 순위를 올릴수록 이미 낸 돈이 사라진다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 잔액 사용 종류에 'top10' 추가
-- ----------------------------------------------------------------------------
-- 기존 'featured'는 그대로 쓴다(추천 자리 구매). TOP10은 다른 상품이라 내역에서
-- 구분돼야 한다 — 업체가 "무엇에 썼는지"를 정산 화면에서 읽는다.

alter type public.balance_entry_kind add value if not exists 'top10';

-- ----------------------------------------------------------------------------
-- 2. 자리 종류
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ad_placement') then
    create type public.ad_placement as enum (
      'featured',  -- 추천매물 캐러셀 (자리 수 제한 없음, 금액 순)
      'top10'      -- 홈 "최근 TOP10" (열 자리 고정)
    );
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. 관리자 설정 — 자리별 최소 진입금액
-- ----------------------------------------------------------------------------
-- featured_daily_fee는 남겨 두되 더 이상 쓰지 않는다. 지우면 기존 관리자 화면이
-- 저장할 때 없는 칼럼을 쓰려다 실패한다 — 화면을 함께 바꾼 다음 정리한다.

alter table public.payment_settings
  add column if not exists featured_min_bid numeric(18, 2) not null default 0,
  add column if not exists top10_min_bid numeric(18, 2) not null default 0;

comment on column public.payment_settings.featured_min_bid is
  '추천매물 자리의 최소 진입금액. 비어 있는 순위로 들어갈 때의 하한 — 이미 누가 있는 순위는 그 매물의 금액보다 높아야 한다.';
comment on column public.payment_settings.top10_min_bid is
  'TOP10 자리의 최소 진입금액. 열 자리가 모두 찼다면 10위 금액보다 높아야 들어갈 수 있다.';
comment on column public.payment_settings.featured_daily_fee is
  '[사용 안 함 — 2026-09-12] 추천매물이 기간제에서 금액 순위(입찰)로 바뀌면서 featured_min_bid로 대체됐다. 과거 데이터 참고용으로만 남긴다.';

-- ----------------------------------------------------------------------------
-- 4. 슬롯 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.property_ad_slots (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  placement public.ad_placement not null,
  -- 지금까지 이 자리에 낸 누적 금액 = 현재 순위를 결정하는 값.
  bid_amount numeric(18, 2) not null check (bid_amount > 0),
  -- 차감 대상 업체. 매물의 소속이 바뀌어도 "누가 냈는지"는 남아야 한다.
  agency_id uuid not null references public.agencies (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, placement)
);

comment on table public.property_ad_slots is
  '매물이 구매한 광고 자리. 순위는 placement별 bid_amount 내림차순 — 같은 금액이면 먼저 산 쪽이 위(updated_at 오름차순).';

-- 순위 조회 전용 인덱스. 정렬 순서를 그대로 담아 둬야 TOP10을 읽을 때 정렬이 생략된다.
create index if not exists property_ad_slots_rank_idx
  on public.property_ad_slots (placement, bid_amount desc, updated_at asc);

alter table public.property_ad_slots enable row level security;

-- 순위는 누구나 본다 — 홈 화면이 비로그인 상태에서도 TOP10을 그린다.
drop policy if exists "ad_slots_select_all" on public.property_ad_slots;
create policy "ad_slots_select_all"
  on public.property_ad_slots for select
  to anon, authenticated
  using (true);

-- INSERT/UPDATE/DELETE policy 없음(deny). 구매는 아래 함수로만 — 클라이언트가 직접
-- 쓸 수 있으면 금액을 적어 넣고 돈은 내지 않는 경로가 생긴다.

grant select on public.property_ad_slots to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. 구매
-- ----------------------------------------------------------------------------
--
-- 반환값:
--   'ok'              — 구매 완료
--   'too-low'         — 최소금액 또는 목표 순위의 금액보다 낮음
--   'insufficient'    — 잔액 부족
--   그 외는 예외(권한/설정 오류)

create or replace function public.purchase_ad_slot(
  p_property_id uuid,
  p_placement text,
  p_amount numeric
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_placement public.ad_placement;
  v_agency uuid;
  v_min numeric;
  v_current numeric;
  v_charge numeric;
  v_available numeric;
  v_threshold numeric;
  v_slot_count int;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid-amount' using errcode = '22023';
  end if;

  begin
    v_placement := p_placement::public.ad_placement;
  exception when others then
    raise exception 'invalid-placement' using errcode = '22023';
  end;

  select agency_id into v_agency from public.properties where id = p_property_id;
  if v_agency is null then
    raise exception 'no-agency' using errcode = '42501';
  end if;

  if not (public.is_admin_or_above() or public.is_active_agency_member(v_agency)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select case when v_placement = 'featured' then featured_min_bid else top10_min_bid end
    into v_min
  from public.payment_settings
  where id = 'default';

  if coalesce(v_min, 0) <= 0 then
    raise exception 'min-bid-not-set' using errcode = '22023';
  end if;

  -- 이 매물이 이미 그 자리를 갖고 있으면 "금액 올리기"다. 새 금액은 지금보다 높아야
  -- 하고, 차액만 받는다.
  select bid_amount into v_current
  from public.property_ad_slots
  where property_id = p_property_id and placement = v_placement;

  if v_current is not null and p_amount <= v_current then
    return 'too-low';
  end if;

  if p_amount < v_min then
    return 'too-low';
  end if;

  -- TOP10은 열 자리뿐이다. 이미 열이 차 있다면 10위 금액보다 높아야 들어간다 —
  -- 그보다 낮으면 11위가 되어 아무 데도 보이지 않는데 돈만 받는 셈이 된다.
  if v_placement = 'top10' then
    select count(*) into v_slot_count
    from public.property_ad_slots
    where placement = 'top10' and property_id <> p_property_id;

    if v_slot_count >= 10 then
      select bid_amount into v_threshold
      from public.property_ad_slots
      where placement = 'top10' and property_id <> p_property_id
      order by bid_amount desc, updated_at asc
      offset 9 limit 1;

      if p_amount <= coalesce(v_threshold, 0) then
        return 'too-low';
      end if;
    end if;
  end if;

  v_charge := p_amount - coalesce(v_current, 0);

  select available into v_available from public.agency_balance(v_agency);
  if coalesce(v_available, 0) < v_charge then
    return 'insufficient';
  end if;

  insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
  values (
    v_agency,
    -v_charge,
    v_placement::text::public.balance_entry_kind,
    p_property_id,
    'bid:' || p_amount::text,
    auth.uid()
  );

  insert into public.property_ad_slots (property_id, placement, bid_amount, agency_id)
  values (p_property_id, v_placement, p_amount, v_agency)
  on conflict (property_id, placement)
  do update set bid_amount = excluded.bid_amount, updated_at = now();

  -- 추천 자리는 기존 화면들이 properties.featured를 보고 그린다. 기간제가 아니므로
  -- featured_until은 비운다 — 밀려날 때까지 유지되는 자리다.
  if v_placement = 'featured' then
    update public.properties
    set featured = true, featured_until = null
    where id = p_property_id;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.purchase_ad_slot(uuid, text, numeric) from public;
grant execute on function public.purchase_ad_slot(uuid, text, numeric) to authenticated;

comment on function public.purchase_ad_slot(uuid, text, numeric) is
  '광고 자리 구매(추천/TOP10). 금액 순위이며 진입 시 1회 차감한다. 금액을 올릴 때는 차액만 받는다. 반환: ok / too-low / insufficient.';

comment on function public.purchase_featured(uuid, int) is
  '[사용 안 함 — 2026-09-12] 추천매물 기간제 구매. 금액 순위(purchase_ad_slot)로 대체됐다.';
