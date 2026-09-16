-- ============================================================================
-- [2026-09-16 확정-결정사항 6·7] set_ad_bid — 순위를 약속으로 만들고, 거절 이유를 나눈다
--
-- **이것은 set_ad_bid의 8번째 정의다.** 앞선 7번(20260912120000 · 20260912180000 ·
-- 20260912200000 · 20260912210000 · 20260912230000 · 20260913150000 · 20260913180000)은
-- 전부 "고칠 때마다 조건이 하나씩 붙은" 흔적이고, 그래서 지금까지 이 함수가 어떤
-- 규칙으로 도는지 어느 문서에도 정리돼 있지 않았다. 이번 정의의 규칙은
-- claude/불일치-목록.md 4절에 표로 적어 두었다 — 다음에 고칠 때 그 표를 같이 고친다.
--
-- 고치는 이유 두 가지(3단계 감사에서 드러난 것):
--
-- ① 화면과 서버가 서로 다른 규칙이었다.
--    화면(app/ad-slots.tsx)은 "N위를 산다"며 누른 줄의 금액 + 1을 요구하는데,
--    서버는 **맨 아래 자리** 금액만 넘으면 통과시켰다. 서버가 느슨한 쪽이라 돈이
--    새지는 않았지만, 화면이 약속한 순위를 서버가 지켜 주지 않았다.
--    사용자 결정: **화면 모델을 유지하고 서버가 순위를 검사한다.**
--
-- ② `too-low` 하나가 서로 다른 두 실패를 뜻했다.
--    "관리자가 정한 최소금액 미달"과 "다른 업체 금액을 못 넘김"이 같은 코드로 와서,
--    화면은 둘을 구분하지 못하고 **자기가 계산한 값**을 안내 문구에 넣었다. 그 값이
--    실제 필요 금액과 다를 수 있었다.
--    사용자 결정: **below-min / outbid로 나누고 서버가 필요 금액을 함께 돌려준다.**
--
-- 순위 경쟁에서 지면 어떻게 하나(사용자 결정): **거절하고, 화면이 자리 목록을 다시
-- 읽어 현재 금액을 보여 준다.** 자동으로 한 단계 아래 순위에 넣지 않는다 — 사용자가
-- 의도하지 않은 자리에 돈을 쓰게 된다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 옛 정의를 내린다
-- ----------------------------------------------------------------------------
--
-- 인자가 3개에서 4개로 늘고 p_rank에 기본값이 있다. 옛 3인자 정의를 남겨 두면
-- set_ad_bid(uuid, text, numeric) 호출이 어느 쪽인지 모호해져 Postgres가 거부한다.
-- 그래서 create or replace가 아니라 drop 후 create다.

drop function if exists public.set_ad_bid(uuid, text, numeric);

-- ----------------------------------------------------------------------------
-- 2. 새 정의
-- ----------------------------------------------------------------------------
--
-- p_rank는 **1부터 세는 목표 순위**다. NULL이면 지금까지와 같이 "꼴찌만 넘으면
-- 된다"로 동작한다 — 순위를 지정하지 않는 호출(있다면)이 조용히 깨지지 않게 한다.
--
-- required_amount를 함께 돌려준다. 화면이 스스로 계산한 값 대신 이 값을 보여 준다.

create or replace function public.set_ad_bid(
  p_property_id uuid,
  p_placement text,
  p_amount numeric,
  p_rank int default null
)
returns table (
  result text,
  dropped_owner uuid,
  dropped_property uuid,
  required_amount numeric
)
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
  v_at_rank numeric;
  v_actual_rank int;
  v_holds boolean;
  v_dropped_property uuid;
  v_dropped_agency uuid;
  v_owner uuid;
begin
  result := 'failed';
  dropped_owner := null;
  dropped_property := null;
  required_amount := null;

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

  v_cap := public.ad_slot_capacity(v_placement);

  -- [확정 6] 목표 순위가 자리 수를 넘으면 애초에 살 수 없는 자리다. 화면이 보내는
  -- 값이라 정상 사용에서는 오지 않지만, 직접 호출을 막아 둔다.
  if p_rank is not null and (p_rank < 1 or p_rank > v_cap) then
    result := 'rank-invalid';
    return next;
    return;
  end if;

  -- [확정 7] 최소금액 미달 — 필요 금액은 최소금액 그 자체다.
  if p_amount < v_min then
    result := 'below-min';
    required_amount := v_min;
    return next;
    return;
  end if;

  if public.agency_available_internal(v_agency) <= 0 then
    result := 'no-balance';
    return next;
    return;
  end if;

  select exists (
    select 1 from public.property_ad_slots
    where property_id = p_property_id and placement = v_placement
  ) into v_holds;

  -- --------------------------------------------------------------------------
  -- 순위 검사
  -- --------------------------------------------------------------------------
  --
  -- 이미 자리를 가진 매물이 금액만 바꾸는 경우는 지금까지처럼 검사하지 않는다
  -- (2026-09-12 사용자 지시 — 올리는 것뿐 아니라 내리는 것도 가능해야 한다).
  --
  -- p_rank가 있으면 **그 자리에 지금 있는 금액**을 넘어야 한다. 없으면(NULL)
  -- 예전 규칙 그대로 맨 아래 금액을 넘으면 된다.
  if not v_holds then
    if p_rank is not null then
      select bid_amount into v_at_rank
      from public.property_ad_slots
      where placement = v_placement and property_id <> p_property_id
      order by bid_amount desc, updated_at asc
      offset p_rank - 1 limit 1;

      -- 그 순위가 비어 있으면(아직 그만큼 안 찼다) 넘을 상대가 없다 — 최소금액만 보면 된다.
      if v_at_rank is not null and p_amount <= v_at_rank then
        result := 'outbid';
        required_amount := v_at_rank + 1;
        return next;
        return;
      end if;
    else
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
          result := 'outbid';
          required_amount := coalesce(v_last, 0) + 1;
          return next;
          return;
        end if;
      end if;
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- 자리 넣기 — 넣은 뒤 실제 순위를 다시 확인한다
  -- --------------------------------------------------------------------------
  --
  -- 위 검사와 아래 insert 사이에 다른 업체가 같은 자리를 채울 수 있다(읽고 쓰는
  -- 사이의 틈). 그 경우 약속한 순위보다 아래에 들어가는데, 그건 "N위를 산다"는
  -- 약속을 어기는 것이다.
  --
  -- 안쪽 begin/exception 블록은 진입 시점에 세이브포인트를 만든다. 확인에 실패하면
  -- 여기서 예외를 던져 **이 블록 안의 insert만 되돌린다** — 함수 전체가 죽지 않으므로
  -- 이유 코드를 정상적으로 돌려줄 수 있다.
  if p_rank is not null and not v_holds then
    begin
      insert into public.property_ad_slots (property_id, placement, bid_amount, agency_id)
      values (p_property_id, v_placement, p_amount, v_agency)
      on conflict (property_id, placement)
      do update set bid_amount = excluded.bid_amount, agency_id = excluded.agency_id, updated_at = now();

      -- 별칭을 rank로 두지 않는다 — 윈도우 함수와 이름이 겹쳐 읽는 사람이 헷갈린다.
      select ranked.rank_no into v_actual_rank
      from (
        select property_id,
               row_number() over (order by bid_amount desc, updated_at asc) as rank_no
        from public.property_ad_slots
        where placement = v_placement
      ) ranked
      where ranked.property_id = p_property_id;

      if coalesce(v_actual_rank, v_cap + 1) > p_rank then
        raise exception 'rank-taken' using errcode = 'P0001';
      end if;
    exception when sqlstate 'P0001' then
      -- insert가 되돌아갔다. 되돌아간 상태에서 그 자리의 현재 금액을 다시 읽는다.
      select bid_amount into v_at_rank
      from public.property_ad_slots
      where placement = v_placement and property_id <> p_property_id
      order by bid_amount desc, updated_at asc
      offset p_rank - 1 limit 1;

      result := 'outbid';
      required_amount := coalesce(v_at_rank, 0) + 1;
      return next;
      return;
    end;
  else
    insert into public.property_ad_slots (property_id, placement, bid_amount, agency_id)
    values (p_property_id, v_placement, p_amount, v_agency)
    on conflict (property_id, placement)
    do update set bid_amount = excluded.bid_amount, agency_id = excluded.agency_id, updated_at = now();
  end if;

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

revoke all on function public.set_ad_bid(uuid, text, numeric, int) from public;
grant execute on function public.set_ad_bid(uuid, text, numeric, int) to authenticated;

comment on function public.set_ad_bid(uuid, text, numeric, int) is
  '광고 클릭 단가 설정/변경. 공개(active) 매물만. p_rank를 주면 그 순위를 약속으로 검사하고(넣은 뒤 실제 순위를 다시 확인해 어긋나면 되돌린다), NULL이면 맨 아래 자리만 넘으면 된다. 거절 시 result는 below-min / outbid / no-balance / no-agency / not-active / rank-invalid 중 하나이고 required_amount에 필요한 금액이 담긴다. 이미 자리를 가진 매물은 최소금액 이상이면 올리거나 내릴 수 있다.';
