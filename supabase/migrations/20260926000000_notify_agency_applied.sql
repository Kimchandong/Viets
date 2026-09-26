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
