-- ============================================================================
-- [2026-09-12 사용자 지시] 탈락 알림
--
-- 잔액 소진은 이미 알리고 있었지만, **금액 경쟁에서 밀려 자리가 삭제된 경우**에는
-- 아무 알림이 없었다. 광고주 입장에서는 잔액이 멀쩡히 남아 있는데 노출만 끊긴
-- 상태라 원인을 알 수 없다.
--
-- set_ad_bid가 "누구를 밀어냈는지"를 함께 돌려주도록 바꾸고, 그 자리에 알림 행을
-- 남긴다. 실제 푸시 발송은 엣지 함수 ad-bid가 이 반환값을 보고 처리한다 —
-- Postgres에서 외부로 HTTP를 보낼 수 없기 때문이다(ad-click과 같은 구조).
-- ============================================================================

drop function if exists public.set_ad_bid(uuid, text, numeric);

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
  do update set bid_amount = excluded.bid_amount, updated_at = now();

  -- 자리 수를 넘긴 맨 아래를 밀어낸다. 누구를 밀어냈는지 알아야 알릴 수 있으므로
  -- returning으로 받아 둔다(한 번의 진입으로 밀려나는 것은 최대 한 곳이다).
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

  -- 밀려난 쪽의 업체 대표에게 알림을 남긴다. dedupe_key에 매물과 자리를 넣어,
  -- 같은 매물이 같은 자리에서 여러 번 밀려나도 하루에 한 번만 쌓이게 한다.
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
  '광고 클릭 단가 설정. 밀려난 자리는 삭제하고 그 업체 대표에게 탈락 알림을 남긴다. 반환: result(ok/too-low/no-balance) + 밀려난 대표/매물.';
