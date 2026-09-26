-- ############################################################################
-- 2026-09-17 적용분 — 이 파일 하나를 통째로 Supabase SQL Editor에 붙여넣고 실행한다.
--
-- 들어 있는 것 (파일 2개를 순서대로 이어 붙였다):
--   1) 20260925000000_ad_click_self_and_dedupe_fix.sql
--      · 등록자 본인·업체 직원의 자가 클릭은 과금하지 않는다(로그에는 charged=0)
--      · 1시간 중복차감 판정을 로그인 사용자는 viewer_id만, 비로그인은 ip_hash만으로
--   2) 20260926000000_notify_agency_applied.sql
--      · 업체 등록 신청이 들어오면 관리자 전원에게 알림을 남기는 트리거(지금은 없음)
--
-- 적용 전 확인한 것(3차 검토):
--   · charge_ad_click의 인자·반환 타입이 기존 정의와 완전히 동일하다
--     → create or replace가 "cannot change return type"으로 실패하지 않는다
--   · ad_click_log.ip_hash 컬럼과 (property_id, placement, ip_hash, created_at) 인덱스가
--     이미 있다(20260912150000) → 새 판정문이 인덱스를 탄다
--   · ad_click_log.charged는 not null default 0이고 체크 제약이 없다
--     → 자가 클릭을 charged=0으로 남기는 insert가 막히지 않는다
--   · revoke → grant 순서라 service_role 실행 권한이 끊기지 않는다
--   · user_notifications.kind는 text이고 제약이 없다 → 'agency_applied'가 들어간다
--   · notify_user(uuid, text, jsonb, text, text) 시그니처와 호출이 일치한다
--
-- 결과 문구: "Success. No rows returned" 가 나오면 정상이다.
-- ############################################################################

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


-- ############################################################################
-- 2) 업체 등록 신청 알림
-- ############################################################################

-- ============================================================================
-- [2026-09-16 실기기 제보 — 결함 수정] 업체 등록 신청이 들어와도 관리자는 모른다
--
-- 제보: "관리자는 어떤 푸싱알람도 오지 않고(부동산중개업자만 알람 옴)"
--
-- 추적 결과 원인이 둘이었다. 이 마이그레이션은 그중 하나를 고친다.
--
--   원인 A — 업체 등록 신청 알림이 **아예 구현돼 있지 않다.**
--            agencies에 신청 행이 생겨도 트리거가 없고, app/agency-apply.tsx에도
--            sendNotificationPush 호출이 없다. 관리자는 admin-agencies 화면을 직접
--            열어 보기 전까지 신청이 들어온 것을 알 수 없다.
--            → 이 마이그레이션 + agency-apply.tsx + pushText.ts로 만든다.
--
--   원인 B — 관리자 알림의 목적지 '/admin-payments'가 앱의 푸시 경로 허용 목록
--            (services/push.ts PUSH_ROUTES)에 없어, 푸시를 눌러도 아무 일도
--            일어나지 않았다. → services/push.ts에서 고쳤다(코드 변경).
--
-- 입금 신고(notify_payment_requested)와 같은 모양으로 만든다: 관리자 전원에게 각각
-- notify_user를 불러 각자의 수신 설정이 적용되게 하고, dedupe_key에 agencies.id를 넣어
-- 한 신청당 한 번만 남게 한다.
-- ============================================================================

create or replace function public.notify_agency_applied()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
begin
  -- 심사 대기 상태로 들어온 신청만 알린다. 관리자가 상태를 바꾸는 UPDATE는
  -- 이 트리거를 타지 않는다(INSERT 전용).
  if new.approval_status is distinct from 'pending' then
    return new;
  end if;

  for v_admin in
    select ur.user_id
    from public.user_roles ur
    where ur.role in ('admin', 'super_admin')
  loop
    perform public.notify_user(
      v_admin,
      'agency_applied',
      jsonb_build_object('agency', coalesce(new.name, '')),
      '/admin-agencies',
      new.id::text
    );
  end loop;

  return new;
end;
$$;

comment on function public.notify_agency_applied() is
  '중개업체 등록 신청이 들어오면 관리자 전원에게 알린다. 입금 신고 알림(notify_payment_requested)과 같은 구조 — 관리자마다 notify_user를 따로 불러 각자의 수신 설정이 적용된다.';

drop trigger if exists agencies_notify_applied on public.agencies;

create trigger agencies_notify_applied
  after insert on public.agencies
  for each row
  execute function public.notify_agency_applied();

-- ----------------------------------------------------------------------------
-- 확인
-- ----------------------------------------------------------------------------
-- 트리거가 붙었는지:
--   select tgname from pg_trigger
--   where tgrelid = 'public.agencies'::regclass and not tgisinternal;
--
-- 관리자가 몇 명인지(알림이 그 수만큼 생긴다):
--   select count(*) from public.user_roles where role in ('admin','super_admin');
