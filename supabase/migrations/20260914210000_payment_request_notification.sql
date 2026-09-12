-- ============================================================================
-- [2026-09-12 실기기 테스트 지시] 업체가 입금을 신고하면 **관리자에게도** 알린다
--
-- 지금까지 알림은 한 방향이었다 — 관리자가 승인하면 업체가 알림을 받았다. 그런데
-- 승인을 하려면 관리자가 먼저 신고가 들어온 것을 알아야 한다. 지금은 관리자가
-- 정산 관리 화면을 직접 열어 보기 전까지 모른다. 돈이 들어와 있는데 며칠씩 반영되지
-- 않을 수 있다.
--
-- 받는 사람이 여럿(관리자 전원)이라는 점이 기존 알림과 다르다. notify_user를
-- 관리자마다 한 번씩 부른다 — 각자의 수신 설정이 따로 적용되어야 하기 때문이다
-- (한 사람이 꺼 두면 그 사람만 안 받는다).
-- ============================================================================

create or replace function public.notify_payment_requested()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_name text;
  v_admin uuid;
begin
  select name into v_agency_name from public.agencies where id = new.agency_id;

  for v_admin in
    select ur.user_id
    from public.user_roles ur
    where ur.role in ('admin', 'super_admin')
  loop
    perform public.notify_user(
      v_admin,
      'payment_requested',
      jsonb_build_object('agency', coalesce(v_agency_name, ''), 'amount', new.amount),
      '/admin-payments',
      -- 신고 한 건당 한 번. 관리자마다 행이 따로 생기므로 user_id가 함께 유일키를 이룬다.
      new.id::text
    );
  end loop;

  return new;
end;
$$;

comment on function public.notify_payment_requested() is
  '업체가 입금을 신고하면 관리자 전원에게 알린다. 관리자마다 notify_user를 따로 불러 각자의 수신 설정이 적용되게 한다.';

drop trigger if exists payment_requests_notify_new on public.payment_requests;

create trigger payment_requests_notify_new
  after insert on public.payment_requests
  for each row
  execute function public.notify_payment_requested();
