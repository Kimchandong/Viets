-- ============================================================================
-- [2026-09-16 실기기 제보 — 광고 과금 결함 2건] charge_ad_click 4번째 정의
--
-- 제보 내용 그대로:
--   ① "광고클릭시 등록자가 클릭해도 돈이 빠져나가고"
--   ② "1시간 이내 중복차감을 잡은게 한계정에 제한둔것도 아니고 어떤 클릭이든
--      1시간 이내는 차감되지 않게 만들어 놓고"
--
-- ── ① 자가 클릭 과금 ──────────────────────────────────────────────────────
-- 지금 함수에는 **클릭한 사람이 누구인지 보는 검사가 아예 없다.** 매물 등록자
-- 본인이 자기 광고를 눌러도 자기 업체 잔액이 깎인다. 업체 직원이 목록을 확인하려고
-- 누르는 것만으로도 돈이 나간다.
--
-- 고침: 클릭한 사람이 그 매물의 등록자(created_by)이거나, 그 매물을 가진 업체의
-- 활성 구성원이면 **과금하지 않는다.** 로그에는 charged=0으로 남겨 "눌렸지만 돈은
-- 안 나갔다"가 보이게 한다 — 아예 안 남기면 나중에 "왜 클릭 수가 안 맞나"가 된다.
--
-- ── ② 중복 방지가 전역으로 걸린 문제 ──────────────────────────────────────
-- 기존 판정은 이랬다:
--
--     (p_viewer is not null and l.viewer_id = p_viewer)
--     or (p_ip_hash is not null and l.ip_hash = p_ip_hash)
--
-- OR이라 **둘 중 하나만 걸려도** 무과금이다. 그런데 엣지 함수(ad-click)는 요청에서
-- IP를 못 찾으면 문자열 "unknown"을 해시해서 보낸다 — 그러면 **모든 사용자가 같은
-- ip_hash**를 갖는다. 한 사람이 누르는 순간 1시간 동안 다른 모든 사람의 클릭이
-- 무과금이 된다. 제보가 정확하다.
--
-- 통신사 NAT처럼 여러 사용자가 실제로 같은 IP를 쓰는 경우에도 같은 일이 벌어진다.
--
-- 고침: **로그인한 사람은 자기 자신만 기준**이 된다. IP는 비로그인 클릭에만 쓴다.
--   · p_viewer가 있으면 → viewer_id가 같은 과거 클릭만 본다.
--   · p_viewer가 없으면 → ip_hash가 같은 과거 클릭만 본다.
-- 엣지 함수도 함께 고쳐, IP를 못 구하면 "unknown"을 해시하지 않고 **null**을 보낸다
-- (20260925 ad-click/index.ts). null이면 이 함수는 IP 기준 판정을 건너뛴다.
--
-- 나머지 동작(노출 중인 자리만 과금 · 잔액 이하만 차감 · 잔액 0이면 그 업체 광고 전부
-- 내림)은 그대로다.
-- ============================================================================

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
  v_creator uuid;
  v_bid numeric;
  v_available numeric;
  v_charge numeric;
  v_owner uuid;
  v_self boolean;
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

  -- --------------------------------------------------------------------------
  -- ① 자기 광고를 자기가 누른 경우 — 과금하지 않는다
  -- --------------------------------------------------------------------------
  --
  -- 두 경로를 본다: 매물을 등록한 본인, 그리고 그 매물을 가진 업체의 활성 구성원.
  -- 업체는 여러 명이 쓰므로 등록자만 보면 직원이 누를 때 그대로 돈이 나간다.
  if p_viewer is not null then
    select p.created_by into v_creator
    from public.properties p
    where p.id = p_property_id;

    v_self := (v_creator = p_viewer)
      or (v_agency is not null and exists (
            select 1 from public.agency_members m
            where m.agency_id = v_agency
              and m.user_id = p_viewer
              and m.status = 'active'
          ));

    if coalesce(v_self, false) then
      -- 눌린 사실은 남기고 금액만 0으로 둔다. 나중에 "내부 클릭이 몇 건이었나"를
      -- 셀 수 있어야 광고 성과를 해석할 수 있다.
      insert into public.ad_click_log (property_id, placement, viewer_id, charged, ip_hash)
      values (p_property_id, v_placement, p_viewer, 0, p_ip_hash);

      return next;
      return;
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- ② 1시간 중복 방지 — 로그인한 사람은 자기 자신만 기준
  -- --------------------------------------------------------------------------
  --
  -- 예전처럼 viewer OR ip로 보면, 같은 IP(공용 와이파이·통신사 NAT·엣지가 IP를
  -- 못 구해 모두 같은 해시가 된 경우)를 쓰는 남의 클릭이 내 클릭을 막는다.
  if p_viewer is not null then
    if exists (
      select 1
      from public.ad_click_log l
      where l.property_id = p_property_id
        and l.placement = v_placement
        and l.created_at > now() - interval '1 hour'
        and l.viewer_id = p_viewer
    ) then
      return next;
      return;
    end if;
  elsif p_ip_hash is not null then
    if exists (
      select 1
      from public.ad_click_log l
      where l.property_id = p_property_id
        and l.placement = v_placement
        and l.created_at > now() - interval '1 hour'
        and l.viewer_id is null
        and l.ip_hash = p_ip_hash
    ) then
      return next;
      return;
    end if;
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
    --
    -- 순서가 중요하다 — featured를 **먼저** 끄고 그 다음 자리를 지운다. 반대로 하면
    -- 아래 update의 exists 조건이 이미 사라진 행을 찾게 되어 featured가 켜진 채 남는다.
    -- (2026-09-16 재정의 시 이 순서를 한 번 뒤집었다가 되돌렸다.)
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

revoke all on function public.charge_ad_click(uuid, text, text, uuid) from public;
grant execute on function public.charge_ad_click(uuid, text, text, uuid) to service_role;

comment on function public.charge_ad_click(uuid, text, text, uuid) is
  '광고 클릭 과금. 등록자 본인과 그 업체 활성 구성원의 클릭은 과금하지 않는다(로그에는 charged=0으로 남는다). 1시간 중복 방지는 로그인한 사람이면 viewer_id만, 비로그인이면 ip_hash만 기준으로 본다 — 예전처럼 OR로 보면 같은 IP를 쓰는 남의 클릭이 내 클릭을 막았다(2026-09-16 수정).';
