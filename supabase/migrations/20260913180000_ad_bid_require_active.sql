-- ============================================================================
-- [2026-09-12 감사 결과] 광고 자리는 **공개(active) 매물만** 살 수 있다
--
-- 20260913120000에서 "공개를 벗어나면 자리를 반납한다"는 트리거를 넣었지만,
-- 반대 방향 — 이미 비공개인 매물이 새로 자리를 사는 길 — 은 막혀 있지 않았다.
-- 화면에서는 목록을 공개 매물로 걸러 두었어도, RPC를 직접 부르면 보류/거래완료
-- 매물이 자리를 차지할 수 있다. 그 자리는 고객 화면에 절대 노출되지 않으므로
-- (조회가 status='active'만 본다) 남의 자리를 막기만 하는 유령 행이 된다.
--
-- 서버에서 막는다: 광고는 "지금 팔 수 있는 매물"에만 의미가 있다.
-- 나머지 동작은 20260913150000과 같다(자리를 가진 매물은 금액을 내릴 수 있다).
-- ============================================================================

create or replace function public.set_ad_bid(
  p_property_id uuid,
  p_placement text,
  p_amount numeric
)
returns table (result text, dropped_owner uuid, dropped_property uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_placement public.ad_placement;
  v_agency uuid;
  v_creator uuid;
  v_exists boolean;
  v_status text;
  v_min numeric;
  v_cap int;
  v_count int;
  v_last numeric;
  v_holds boolean;
  v_dropped_property uuid;
  v_dropped_agency uuid;
  v_owner uuid;
begin
  result := 'failed';
  dropped_owner := null;
  dropped_property := null;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid-amount' using errcode = '22023';
  end if;

  begin
    v_placement := p_placement::public.ad_placement;
  exception when others then
    raise exception 'invalid-placement' using errcode = '22023';
  end;

  select true, agency_id, created_by, status
    into v_exists, v_agency, v_creator, v_status
  from public.properties
  where id = p_property_id;

  if not coalesce(v_exists, false) then
    raise exception 'no-property' using errcode = '42501';
  end if;

  if v_agency is null then
    if not (public.is_admin_or_above() or v_creator = auth.uid()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    select m.agency_id
      into v_agency
    from public.agency_members m
    join public.agencies a on a.id = m.agency_id
    where m.user_id = auth.uid()
      and m.status = 'active'
      and a.approval_status = 'approved'
    order by m.created_at desc
    limit 1;

    if v_agency is null then
      result := 'no-agency';
      return next;
      return;
    end if;

    update public.properties set agency_id = v_agency where id = p_property_id;
  else
    if not (public.is_admin_or_above() or public.is_active_agency_member(v_agency)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- 권한을 확인한 뒤에 상태를 본다 — 남의 매물 상태를 오류 메시지로 흘리지 않는다.
  if v_status is distinct from 'active' then
    result := 'not-active';
    return next;
    return;
  end if;

  select case when v_placement = 'featured' then featured_min_bid else top10_min_bid end
    into v_min
  from public.payment_settings
  where id = 'default';

  if coalesce(v_min, 0) <= 0 then
    raise exception 'min-bid-not-set' using errcode = '22023';
  end if;

  if p_amount < v_min then
    result := 'too-low';
    return next;
    return;
  end if;

  if public.agency_available_internal(v_agency) <= 0 then
    result := 'no-balance';
    return next;
    return;
  end if;

  v_cap := public.ad_slot_capacity(v_placement);

  select exists (
    select 1 from public.property_ad_slots
    where property_id = p_property_id and placement = v_placement
  ) into v_holds;

  if not v_holds then
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
        result := 'too-low';
        return next;
        return;
      end if;
    end if;
  end if;

  insert into public.property_ad_slots (property_id, placement, bid_amount, agency_id)
  values (p_property_id, v_placement, p_amount, v_agency)
  on conflict (property_id, placement)
  do update set bid_amount = excluded.bid_amount, agency_id = excluded.agency_id, updated_at = now();

  delete from public.property_ad_slots
  where id in (
    select id
    from public.property_ad_slots
    where placement = v_placement
    order by bid_amount desc, updated_at asc
    offset v_cap
  )
  returning property_id, agency_id into v_dropped_property, v_dropped_agency;

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

  if v_dropped_agency is not null and v_dropped_property is distinct from p_property_id then
    select m.user_id into v_owner
    from public.agency_members m
    where m.agency_id = v_dropped_agency
      and m.status = 'active'
      and m.role_in_agency = 'owner'
    order by m.created_at asc
    limit 1;

    if v_owner is not null then
      insert into public.ad_notifications (user_id, kind, dedupe_key)
      values (
        v_owner,
        'slot_dropped',
        v_dropped_property::text || ':' || v_placement::text || ':' || to_char(now(), 'YYYY-MM-DD')
      )
      on conflict (user_id, kind, dedupe_key) do nothing;

      dropped_owner := v_owner;
      dropped_property := v_dropped_property;
    end if;
  end if;

  result := 'ok';
  return next;
end;
$$;

revoke all on function public.set_ad_bid(uuid, text, numeric) from public;
grant execute on function public.set_ad_bid(uuid, text, numeric) to authenticated;

comment on function public.set_ad_bid(uuid, text, numeric) is
  '광고 클릭 단가 설정/변경. 공개(active) 매물만 자리를 살 수 있다. 새로 들어올 때만 맨 아래 금액 초과를 요구하고, 이미 자리를 가진 매물은 최소금액 이상이면 올리거나 내릴 수 있다.';
