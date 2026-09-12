-- ============================================================================
-- [2026-09-12] 새로 등록한 매물도 no-agency로 거부되는 문제 수정
--
-- 앞선 수정(20260912210000)은 properties.agency_id가 비었을 때 my_active_agency_id()로
-- 채우게 했다. 그런데 그 함수는 **업체에 property_listing 권한이 켜져 있을 때만** 값을
-- 돌려준다. 그 권한이 없는 업체는
--   · 매물을 등록해도 properties.agency_id가 NULL로 저장되고(createProperty가 같은 함수를 쓴다),
--   · 광고를 걸 때도 같은 함수를 타므로 똑같이 NULL이라 no-agency가 났다.
--
-- 광고비는 업체 잔액에서 빠지는 돈이다. "매물을 몇 건 올릴 수 있는가"(property_listing)와
-- "광고비를 낼 업체가 누구인가"는 서로 다른 질문이므로, 광고 쪽 판정은 권한 플래그가
-- 아니라 **승인된 업체의 활성 멤버인가**만 본다.
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

    -- 승인된 업체의 활성 멤버면 충분하다 — property_listing 권한 여부는 보지 않는다.
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

  if v_dropped_agency is not null then
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

-- ----------------------------------------------------------------------------
-- 기존 데이터 재정리 — 권한 플래그와 무관하게 등록자의 승인 업체로 채운다
-- ----------------------------------------------------------------------------

update public.properties p
set agency_id = m.agency_id
from public.agency_members m
join public.agencies a on a.id = m.agency_id
where p.agency_id is null
  and p.created_by is not null
  and m.user_id = p.created_by
  and m.status = 'active'
  and a.approval_status = 'approved'
  and m.created_at = (
    select max(m2.created_at)
    from public.agency_members m2
    join public.agencies a2 on a2.id = m2.agency_id
    where m2.user_id = p.created_by
      and m2.status = 'active'
      and a2.approval_status = 'approved'
  );
