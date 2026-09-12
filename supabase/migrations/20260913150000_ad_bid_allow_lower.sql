-- ============================================================================
-- [2026-09-12 사용자 지시] 내 광고비를 올리는 것뿐 아니라 **낮추는 것**도 허용
--
-- 지금까지 자리가 꽉 차 있으면 "맨 아래 금액보다 높을 것"을 요구했다. 그 조건은
-- **새로 들어오는 매물**에만 필요하다 — 이미 자리를 가진 매물이 금액을 내리는 것은
-- 남의 자리를 빼앗는 일이 아니라 자기 순위를 스스로 내리는 일이다. 그런데 같은
-- 조건이 걸려 있어 한 번 1위에 들어가면 금액을 낮출 수 없었다.
--
-- 바뀌는 것: 그 매물이 **이미 그 자리를 갖고 있으면** 최소금액 이상이기만 하면
-- 얼마로든 바꿀 수 있다. 결과로 순위가 내려가고, 자리 수 밖으로 밀리면 기존 규칙대로
-- 탈락한다(그 경우 화면이 미리 경고한다).
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

  select true, agency_id, created_by
    into v_exists, v_agency, v_creator
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

  -- 이미 이 자리를 갖고 있는가 — 갖고 있으면 "진입"이 아니라 "금액 변경"이다.
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

  -- 밀려난 쪽에 알린다. 스스로 금액을 내려 밀려난 경우(자기 자신)에는 알리지 않는다 —
  -- 방금 자기가 한 행동을 알림으로 되돌려 주는 셈이다.
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
  '광고 클릭 단가 설정/변경. 새로 들어올 때만 맨 아래 금액 초과를 요구하고, 이미 자리를 가진 매물은 최소금액 이상이면 올리거나 내릴 수 있다.';
