-- ============================================================================
-- [2026-09-12 사용자 지시] 광고비 차감을 "진입 시 1회"에서 **클릭당 과금**으로 바꾼다.
--
-- 바뀌는 것
--   · 순위에 적는 금액 = 고객이 그 매물을 한 번 눌렀을 때 빠져나가는 금액(클릭 단가).
--     진입할 때는 아무것도 차감하지 않는다.
--   · 노출 자리 수: 추천 5개, TOP10 10개. 그 아래로 밀린 매물은 **노출되지 않으므로
--     클릭도, 차감도 없다** — 등록 자체는 막지 않는다(금액을 올리면 다시 올라온다).
--   · 잔액이 없는 업체의 매물은 순위에서 자동으로 빠진다. 마지막 클릭에서는 남은
--     잔액만큼만 차감하고 화면 이동은 그대로 진행한다.
--   · 잔액이 0이 되면 등록자에게 알릴 거리를 남긴다(ad_notifications).
--
-- 이전 마이그레이션(20260912090000)의 property_ad_slots.bid_amount는 칼럼 이름을
-- 그대로 두고 의미만 바꾼다 — 이름을 바꾸면 이미 배포된 클라이언트가 없는 칼럼을
-- 읽는다. 주석으로 의미를 못박는다.
-- ============================================================================

comment on column public.property_ad_slots.bid_amount is
  '클릭 1회당 차감되는 광고비(입찰 단가). 순위는 이 금액 내림차순 — 진입 시점에는 차감하지 않는다.';

-- ----------------------------------------------------------------------------
-- 1. 잔액 조회(내부용)
-- ----------------------------------------------------------------------------
--
-- 왜 agency_balance를 쓰지 않는가: 그 함수는 "호출자가 그 업체의 멤버이거나
-- 관리자"일 때만 값을 돌려준다(남의 잔액을 못 보게 하는 장치). 광고 노출 판정은
-- 아무 고객이나 실행하므로 그 조건에서는 모든 업체가 0으로 보여 전부 숨겨진다.
-- 노출·과금 판정 전용으로, 클라이언트에는 주지 않는 내부 함수를 따로 둔다.

create or replace function public.agency_available_internal(target_agency uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(e.amount), 0)
  from public.balance_entries e
  where e.agency_id = target_agency;
$$;

revoke all on function public.agency_available_internal(uuid) from public, anon, authenticated;

comment on function public.agency_available_internal(uuid) is
  '광고 노출/과금 판정 전용 잔액. 클라이언트 실행 권한 없음 — 다른 security definer 함수 안에서만 쓴다.';

-- ----------------------------------------------------------------------------
-- 2. 노출 자리 수
-- ----------------------------------------------------------------------------

create or replace function public.ad_slot_capacity(p_placement public.ad_placement)
returns int
language sql
immutable
as $$
  select case when p_placement = 'featured' then 5 else 10 end;
$$;

comment on function public.ad_slot_capacity(public.ad_placement) is
  '노출 자리 수 — 추천 5, TOP10 10. 화면과 과금이 같은 값을 봐야 해서 한 곳에 둔다.';

-- ----------------------------------------------------------------------------
-- 3. 실제로 노출되는 슬롯
-- ----------------------------------------------------------------------------
--
-- security definer인 이유: 잔액은 업체별 집계(agency_balance)라 남의 업체 잔액을
-- 직접 읽을 권한이 없는 사용자도 "잔액이 남은 매물만" 목록을 받아야 한다. 돌려주는
-- 값에 금액 집계는 포함하지 않는다 — 노출 여부 판정에만 쓴다.

create or replace function public.active_ad_slots(p_placement text)
returns table (property_id uuid, bid_amount numeric, rank int)
language sql
security definer
set search_path = public
as $$
  with funded as (
    select
      s.property_id,
      s.bid_amount,
      s.updated_at
    from public.property_ad_slots s
    join public.properties p on p.id = s.property_id
    where s.placement = p_placement::public.ad_placement
      -- 감춰진 매물이 자리를 차지한 채 남지 않게 한다.
      and p.status = 'active'
      -- 잔액이 없으면 클릭해도 받을 돈이 없다 — 노출에서 뺀다(사용자 결정).
      and public.agency_available_internal(s.agency_id) > 0
  )
  select
    property_id,
    bid_amount,
    row_number() over (order by bid_amount desc, updated_at asc)::int as rank
  from funded
  order by bid_amount desc, updated_at asc
  limit public.ad_slot_capacity(p_placement::public.ad_placement);
$$;

revoke all on function public.active_ad_slots(text) from public;
grant execute on function public.active_ad_slots(text) to anon, authenticated;

comment on function public.active_ad_slots(text) is
  '지금 실제로 노출되는 광고 슬롯 — 잔액이 남은 업체의 공개 매물만, 클릭 단가 내림차순으로 자리 수만큼.';

-- ----------------------------------------------------------------------------
-- 4. 클릭 단가 설정 (차감 없음)
-- ----------------------------------------------------------------------------

drop function if exists public.purchase_ad_slot(uuid, text, numeric);

create or replace function public.set_ad_bid(
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

  if p_amount < v_min then
    return 'too-low';
  end if;

  -- 자리 수를 넘는 등록도 허용한다: 6위로 밀리면 노출되지 않을 뿐이고, 금액을 올리면
  -- 다시 올라온다. 여기서 막으면 "지금 5명이 차 있으니 아예 신청할 수 없다"가 된다.
  insert into public.property_ad_slots (property_id, placement, bid_amount, agency_id)
  values (p_property_id, v_placement, p_amount, v_agency)
  on conflict (property_id, placement)
  do update set bid_amount = excluded.bid_amount, updated_at = now();

  -- 추천 자리는 기존 화면들이 properties.featured를 보고 그린다.
  if v_placement = 'featured' then
    update public.properties
    set featured = true, featured_until = null
    where id = p_property_id;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.set_ad_bid(uuid, text, numeric) from public;
grant execute on function public.set_ad_bid(uuid, text, numeric) to authenticated;

comment on function public.set_ad_bid(uuid, text, numeric) is
  '광고 클릭 단가 설정/변경. 차감하지 않는다 — 돈은 고객이 눌렀을 때 charge_ad_click이 받는다.';

-- ----------------------------------------------------------------------------
-- 5. 알림 큐 — 잔액 소진
-- ----------------------------------------------------------------------------

create table if not exists public.ad_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  -- 같은 소진 건으로 알림이 반복 생성되지 않게 하는 잠금 키(업체+날짜 등).
  dedupe_key text,
  unique (user_id, kind, dedupe_key)
);

comment on table public.ad_notifications is
  '광고 관련 알림 대기열. 지금은 앱 안에서 읽고, 푸시 발송이 붙으면 이 행을 보낸다.';

alter table public.ad_notifications enable row level security;

drop policy if exists "ad_notifications_select_own" on public.ad_notifications;
create policy "ad_notifications_select_own"
  on public.ad_notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "ad_notifications_update_own" on public.ad_notifications;
create policy "ad_notifications_update_own"
  on public.ad_notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, update on public.ad_notifications to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 클릭 과금
-- ----------------------------------------------------------------------------
--
-- 반환값: 실제로 차감된 금액(0이면 차감 없음). 화면 이동은 이 값과 무관하게 진행한다 —
-- 잔액이 없다고 고객이 매물을 못 보게 하면 광고와 무관한 사용자가 피해를 본다.
--
-- 비로그인 고객도 클릭한다 — anon에게도 실행 권한을 준다. 대신 로그인 사용자는
-- 같은 매물·같은 자리에 대해 1시간 안의 반복 클릭을 한 번으로 친다(같은 사람이
-- 오가며 여러 번 눌러 광고비가 새는 것을 막는다). 비로그인은 식별자가 없어 이
-- 중복 방지가 불가능하므로, 운영에서 클릭 어뷰징이 보이면 IP 기준 방어를 서버
-- (엣지 함수)로 옮겨야 한다 — 여기서는 할 수 없다.

create table if not exists public.ad_click_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  placement public.ad_placement not null,
  viewer_id uuid references auth.users (id) on delete set null,
  charged numeric(18, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ad_click_log_dedupe_idx
  on public.ad_click_log (property_id, placement, viewer_id, created_at desc);

alter table public.ad_click_log enable row level security;
-- 클릭 기록은 함수(security definer)만 쓴다. 정책 없음 = 클라이언트 직접 접근 불가.

create or replace function public.charge_ad_click(p_property_id uuid, p_placement text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_placement public.ad_placement;
  v_agency uuid;
  v_bid numeric;
  v_available numeric;
  v_charge numeric;
  v_viewer uuid := auth.uid();
  v_owner uuid;
begin
  begin
    v_placement := p_placement::public.ad_placement;
  exception when others then
    return 0;
  end;

  select s.bid_amount, s.agency_id
    into v_bid, v_agency
  from public.property_ad_slots s
  where s.property_id = p_property_id and s.placement = v_placement;

  if v_bid is null then
    return 0;
  end if;

  -- 노출되지 않는 순위(6위 이하 등)는 과금하지 않는다 — 보지 못한 광고에 돈을 받을 수 없다.
  if not exists (
    select 1 from public.active_ad_slots(p_placement) a where a.property_id = p_property_id
  ) then
    return 0;
  end if;

  -- 같은 사람이 1시간 안에 다시 누른 경우는 이미 받은 것으로 본다.
  if v_viewer is not null and exists (
    select 1
    from public.ad_click_log l
    where l.property_id = p_property_id
      and l.placement = v_placement
      and l.viewer_id = v_viewer
      and l.created_at > now() - interval '1 hour'
  ) then
    return 0;
  end if;

  v_available := coalesce(public.agency_available_internal(v_agency), 0);
  if v_available <= 0 then
    return 0;
  end if;

  -- 마지막 클릭에서는 남은 잔액만큼만 받는다(사용자 결정) — 잔액을 음수로 만들지 않는다.
  v_charge := least(v_bid, v_available);

  insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
  values (
    v_agency,
    -v_charge,
    v_placement::text::public.balance_entry_kind,
    p_property_id,
    'click',
    v_viewer
  );

  insert into public.ad_click_log (property_id, placement, viewer_id, charged)
  values (p_property_id, v_placement, v_viewer, v_charge);

  -- 잔액이 0이 되면 등록자(업체 대표)에게 알릴 거리를 남긴다. dedupe_key를 업체+날짜로
  -- 두어 같은 날 여러 번 쌓이지 않게 한다.
  if v_available - v_charge <= 0 then
    select m.user_id into v_owner
    from public.agency_members m
    where m.agency_id = v_agency and m.status = 'active' and m.role_in_agency = 'owner'
    order by m.created_at asc
    limit 1;

    if v_owner is not null then
      insert into public.ad_notifications (user_id, kind, dedupe_key)
      values (v_owner, 'balance_empty', v_agency::text || ':' || to_char(now(), 'YYYY-MM-DD'))
      on conflict (user_id, kind, dedupe_key) do nothing;
    end if;
  end if;

  return v_charge;
end;
$$;

revoke all on function public.charge_ad_click(uuid, text) from public;
grant execute on function public.charge_ad_click(uuid, text) to anon, authenticated;

comment on function public.charge_ad_click(uuid, text) is
  '광고 클릭 과금 — 노출 중인 슬롯만, 남은 잔액을 넘지 않는 선에서 클릭 단가를 차감한다. 반환값은 실제 차감액(0 = 차감 없음).';
