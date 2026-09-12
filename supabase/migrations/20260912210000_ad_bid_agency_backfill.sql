-- ============================================================================
-- [2026-09-12] 광고 설정 실패(no-agency) 수정
--
-- 증상: 승인된 중개업소가 자기 매물에 광고를 설정하면 no-agency로 거부됐다.
--
-- 원인: properties.agency_id는 nullable이고, **매물을 등록한 시점에 업체가 없었으면
-- NULL로 남는다**(등록 후에 업체 승인을 받은 경우, 또는 관리자가 올린 매물).
-- set_ad_bid는 그 값으로 차감 대상 업체를 정하므로 NULL이면 진행할 수 없었다.
--
-- 처방: agency_id가 비어 있을 때는
--   ① 호출자가 그 매물을 관리할 수 있는지 따로 확인하고(등록자 본인 또는 관리자),
--   ② 호출자의 활성 업체를 찾아 **properties.agency_id에 채워 넣은 뒤** 진행한다.
-- 매물 소유 관계를 한 번 정리해 두면 정산·문의·권한 판정이 모두 같은 값을 보게 된다.
-- 활성 업체가 없는 계정(업체 없는 관리자 등)은 차감할 잔액 자체가 없으므로
-- no-agency를 그대로 돌려준다 — 화면이 그 사유를 안내한다.
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
    -- 업체가 비어 있는 매물 — 등록자 본인이나 관리자만 손댈 수 있다.
    if not (public.is_admin_or_above() or v_creator = auth.uid()) then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    v_agency := public.my_active_agency_id();
    if v_agency is null then
      -- 차감할 업체 잔액이 없다. 광고를 걸 수 없다.
      result := 'no-agency';
      return next;
      return;
    end if;

    -- 다음부터는 이 값을 그대로 쓰도록 매물에 적어 둔다.
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

comment on function public.set_ad_bid(uuid, text, numeric) is
  '광고 클릭 단가 설정. 매물에 업체가 비어 있으면 등록자의 활성 업체로 채운 뒤 진행한다. 반환: result(ok/too-low/no-balance/no-agency) + 밀려난 대표/매물.';

-- ----------------------------------------------------------------------------
-- 기존 데이터 정리 — 등록자의 활성 업체로 agency_id를 채운다
-- ----------------------------------------------------------------------------
--
-- 업체 승인 전에 올린 매물들이 NULL로 남아 있다. 광고뿐 아니라 정산·권한 판정도
-- 이 값을 보므로 지금 한 번 맞춰 둔다. 등록자가 여러 업체에 속해 있으면 가장 최근에
-- 합류한 활성 업체를 쓴다(my_active_agency_id와 같은 기준).

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
