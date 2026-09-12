-- ============================================================================
-- [2026-09-12 사용자 지시] 광고 운영 규칙 확정 + 최소 충전액
--
--   ① 최소 충전액 100,000 VND(상한 없음). 승인할 때 관리자가 **실제 입금된 금액**을
--      직접 적어 넣을 수 있다 — 신고 금액과 송금액이 어긋나는 경우가 있기 때문이다.
--   ③ 잔액이 0이 되면 그 업체의 광고 자리를 **삭제**한다. 노출만 빼는 것이 아니라
--      자리 자체를 비워야 남은 업체들의 순위가 다시 정렬된다.
--   ④ 자리 수 밖으로 밀려난 업체도 **삭제**한다. 대기열로 남지 않으며, 다시 들어오려면
--      새로 금액을 설정해야 한다. 금액은 1원 차이로도 순위가 갈린다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 최소 충전액
-- ----------------------------------------------------------------------------

alter table public.payment_settings
  add column if not exists min_deposit numeric(18, 2) not null default 100000;

comment on column public.payment_settings.min_deposit is
  '입금 신고 1건의 최소 금액. 상한은 두지 않는다 — 소액 충전이 반복되면 관리자 승인 업무만 늘어난다.';

update public.payment_settings set min_deposit = 100000 where id = 'default' and min_deposit = 0;

create or replace function public.submit_payment_request(p_amount numeric, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_id uuid;
  v_min numeric;
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

  -- [2026-09-12 사용자 지시] 최소 충전액 미만은 접수하지 않는다.
  select min_deposit into v_min from public.payment_settings where id = 'default';
  if p_amount < coalesce(v_min, 0) then
    raise exception 'below-min-deposit';
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

-- ----------------------------------------------------------------------------
-- 2. 승인 시 관리자가 실제 입금액을 적는다
-- ----------------------------------------------------------------------------
--
-- p_amount가 null이면 신고 금액 그대로 반영한다(기존 동작). 값을 주면 그 금액으로
-- 잔액을 올리고 신고 행의 금액도 실제 입금액으로 고쳐 둔다 — 나중에 내역을 볼 때
-- "신고는 50만인데 잔액은 30만"처럼 어긋나 보이면 원인을 찾을 수 없다.

create or replace function public.admin_review_payment(
  target_request uuid,
  approve boolean,
  reason text default null,
  p_amount numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.payment_requests;
  v_amount numeric;
begin
  if not public.is_admin_or_above() then
    raise exception 'forbidden';
  end if;

  select * into v_req from public.payment_requests where id = target_request for update;
  if v_req.id is null then
    raise exception 'not-found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'already-reviewed';
  end if;

  if approve then
    v_amount := coalesce(p_amount, v_req.amount);
    if v_amount <= 0 then
      raise exception 'invalid-amount';
    end if;

    update public.payment_requests
    set status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        reject_reason = null,
        amount = v_amount
    where id = target_request;

    insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
    values (v_req.agency_id, v_amount, 'deposit', target_request, v_req.note, auth.uid());
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

revoke all on function public.admin_review_payment(uuid, boolean, text, numeric) from public;
grant execute on function public.admin_review_payment(uuid, boolean, text, numeric) to authenticated;

-- 인자 3개짜리 옛 버전은 없앤다 — 둘이 공존하면 PostgREST가 어느 쪽을 부를지 모호해진다.
drop function if exists public.admin_review_payment(uuid, boolean, text);

-- ----------------------------------------------------------------------------
-- 3. 노출 목록 — 이제 "살아 있는 자리"가 곧 노출이다
-- ----------------------------------------------------------------------------
--
-- 밀려난 자리와 잔액이 없는 자리를 모두 삭제하므로, 남아 있는 행은 전부 노출된다.
-- 그래도 limit과 잔액 조건은 남겨 둔다 — 삭제가 일어나기 직전의 짧은 순간이나
-- 예외로 남은 행이 화면에 새어 나오지 않게 하는 안전장치다.

create or replace function public.active_ad_slots(p_placement text)
returns table (property_id uuid, bid_amount numeric, rank int)
language sql
security definer
set search_path = public
as $$
  with funded as (
    select s.property_id, s.bid_amount, s.updated_at
    from public.property_ad_slots s
    join public.properties p on p.id = s.property_id
    where s.placement = p_placement::public.ad_placement
      and p.status = 'active'
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

-- ----------------------------------------------------------------------------
-- 4. 자리 설정 — 넘치면 맨 아래를 밀어낸다(삭제)
-- ----------------------------------------------------------------------------

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
  v_cap int;
  v_count int;
  v_last numeric;
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

  -- 잔액이 없으면 들어와도 곧바로 빠진다 — 들어오기 전에 막는다.
  if public.agency_available_internal(v_agency) <= 0 then
    return 'no-balance';
  end if;

  v_cap := public.ad_slot_capacity(v_placement);

  -- [2026-09-12 사용자 지시 ④] 자리가 꽉 찼다면 맨 아래(v_cap위) 금액보다 높아야
  -- 들어올 수 있다. 낮은 금액으로 대기열에 쌓이는 일은 없다 — 1원 차이로도 순위가 갈린다.
  select count(*) into v_count
  from public.property_ad_slots
  where placement = v_placement and property_id <> p_property_id;

  if v_count >= v_cap then
    select bid_amount into v_last
    from public.property_ad_slots
    where placement = v_placement and property_id <> p_property_id
    order by bid_amount desc, updated_at asc
    offset v_cap - 1 limit 1;

    if p_amount <= coalesce(v_last, 0) then
      return 'too-low';
    end if;
  end if;

  insert into public.property_ad_slots (property_id, placement, bid_amount, agency_id)
  values (p_property_id, v_placement, p_amount, v_agency)
  on conflict (property_id, placement)
  do update set bid_amount = excluded.bid_amount, updated_at = now();

  -- 자리 수를 넘긴 맨 아래 행을 지운다(밀려난 업체는 대기열이 아니라 탈락이다).
  delete from public.property_ad_slots
  where id in (
    select id
    from public.property_ad_slots
    where placement = v_placement
    order by bid_amount desc, updated_at asc
    offset v_cap
  );

  -- 지워진 매물의 추천 표시도 함께 내린다.
  if v_placement = 'featured' then
    update public.properties
    set featured = true, featured_until = null
    where id = p_property_id;

    update public.properties p
    set featured = false
    where p.featured
      and not exists (
        select 1 from public.property_ad_slots s
        where s.property_id = p.id and s.placement = 'featured'
      );
  end if;

  return 'ok';
end;
$$;

revoke all on function public.set_ad_bid(uuid, text, numeric) from public;
grant execute on function public.set_ad_bid(uuid, text, numeric) to authenticated;

comment on function public.set_ad_bid(uuid, text, numeric) is
  '광고 클릭 단가 설정. 자리가 찼으면 맨 아래 금액보다 높아야 진입하고, 밀려난 자리는 삭제된다. 반환: ok / too-low / no-balance.';

-- ----------------------------------------------------------------------------
-- 5. 클릭 과금 — 잔액이 0이 되면 그 업체의 자리를 모두 삭제
-- ----------------------------------------------------------------------------

create or replace function public.charge_ad_click(
  p_property_id uuid,
  p_placement text,
  p_ip_hash text,
  p_viewer uuid
)
returns table (charged numeric, depleted boolean, owner_id uuid)
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
  v_owner uuid;
begin
  charged := 0;
  depleted := false;
  owner_id := null;

  begin
    v_placement := p_placement::public.ad_placement;
  exception when others then
    return next;
    return;
  end;

  select s.bid_amount, s.agency_id
    into v_bid, v_agency
  from public.property_ad_slots s
  where s.property_id = p_property_id and s.placement = v_placement;

  if v_bid is null then
    return next;
    return;
  end if;

  if not exists (
    select 1 from public.active_ad_slots(p_placement) a where a.property_id = p_property_id
  ) then
    return next;
    return;
  end if;

  -- 같은 사람(로그인) 또는 같은 곳(IP)에서 1시간 안의 재클릭은 과금하지 않는다.
  if exists (
    select 1
    from public.ad_click_log l
    where l.property_id = p_property_id
      and l.placement = v_placement
      and l.created_at > now() - interval '1 hour'
      and (
        (p_viewer is not null and l.viewer_id = p_viewer)
        or (p_ip_hash is not null and l.ip_hash = p_ip_hash)
      )
  ) then
    return next;
    return;
  end if;

  v_available := coalesce(public.agency_available_internal(v_agency), 0);
  if v_available <= 0 then
    return next;
    return;
  end if;

  v_charge := least(v_bid, v_available);

  insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
  values (
    v_agency,
    -v_charge,
    v_placement::text::public.balance_entry_kind,
    p_property_id,
    'click',
    p_viewer
  );

  insert into public.ad_click_log (property_id, placement, viewer_id, charged, ip_hash)
  values (p_property_id, v_placement, p_viewer, v_charge, p_ip_hash);

  charged := v_charge;

  if v_available - v_charge <= 0 then
    depleted := true;

    -- [2026-09-12 사용자 지시 ③] 잔액이 바닥나면 그 업체의 광고 자리를 모두 없앤다.
    -- 노출만 빼고 행을 남겨 두면 남은 업체들의 순위가 그 자리에 묶여 재정렬되지 않는다.
    -- 다시 광고하려면 충전 후 새로 금액을 설정해야 한다.
    update public.properties p
    set featured = false
    where p.agency_id = v_agency
      and exists (
        select 1 from public.property_ad_slots s
        where s.property_id = p.id and s.placement = 'featured'
      );

    delete from public.property_ad_slots where agency_id = v_agency;

    select m.user_id into v_owner
    from public.agency_members m
    where m.agency_id = v_agency and m.status = 'active' and m.role_in_agency = 'owner'
    order by m.created_at asc
    limit 1;

    owner_id := v_owner;

    if v_owner is not null then
      insert into public.ad_notifications (user_id, kind, dedupe_key)
      values (v_owner, 'balance_empty', v_agency::text || ':' || to_char(now(), 'YYYY-MM-DD'))
      on conflict (user_id, kind, dedupe_key) do nothing;
    end if;
  end if;

  return next;
end;
$$;

revoke all on function public.charge_ad_click(uuid, text, text, uuid) from public, anon, authenticated;

comment on function public.charge_ad_click(uuid, text, text, uuid) is
  '광고 클릭 과금(엣지 함수 ad-click 전용). 잔액이 0이 되면 그 업체의 광고 자리를 모두 삭제하고 알림을 남긴다.';
