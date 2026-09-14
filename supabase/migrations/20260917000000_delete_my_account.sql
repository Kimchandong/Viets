-- 20260917000000_delete_my_account.sql
--
-- [2026-09-14 사용자 결정] 앱 안에서 사용자가 직접 자기 계정을 지운다.
--
-- Apple(2022-06~)·Google(2024~)은 "계정을 만들 수 있는 앱은 앱 안에서 계정 삭제를
-- 제공해야 한다"를 심사에서 강제한다. 출시 전 DB 초기화와는 다른 것이다 — 초기화는
-- 한 번이고, 이 기능은 출시 후 사용자가 언제든 쓴다.
--
-- ---------------------------------------------------------------------------
-- 스키마를 먼저 읽고 짰다. 그대로 두면 안 되는 것이 세 가지 있었다.
-- ---------------------------------------------------------------------------
--
--   1. properties.created_by 는 SET NULL 이다.
--      auth.users 한 줄만 지우면 **등록한 매물이 공개된 채 그대로 남는다.**
--      주인 없는 매물이 계속 노출되므로 함수에서 먼저 지운다.
--
--   2. user_permissions.granted_by 는 NO ACTION 이다.
--      남에게 권한을 준 적이 있는 계정은 이 참조 때문에 **삭제 자체가 막힌다.**
--      먼저 NULL로 끊는다.
--
--   3. property_conversations.customer_id 는 NOT NULL + CASCADE 였다.
--      고객이 탈퇴하면 대화가 통째로 사라져 **중개업자도 상담 이력을 잃는다.**
--      2026-09-14 사용자 결정(B안): 대화는 남기고 고객 쪽만 비운다.
--      property_messages 에는 사용자 id가 없고 sender_type('customer'/'agency')만
--      있으므로, customer_id 를 비우면 개인 식별자는 남지 않는다.
--      상담원 접근 정책은 can_manage_property_chat(property_id) 기반이라
--      customer_id 와 무관하다 — NULL 이 되어도 중개업자는 그대로 읽는다.
--
-- 나머지(프로필·역할·권한·찜·알림·푸시토큰·투자주문·업체멤버·신고)는 FK가 이미
-- CASCADE 라 auth.users 삭제가 알아서 정리한다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 대화는 남기고 고객만 비운다
-- ---------------------------------------------------------------------------

alter table public.property_conversations
  alter column customer_id drop not null;

-- 제약 이름은 환경마다 다를 수 있으므로 이름을 찾아서 바꾼다.
do $$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join unnest(con.conkey) with ordinality k(attnum, ord) on true
  join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = k.attnum
  where con.contype = 'f'
    and con.conrelid = 'public.property_conversations'::regclass
    and att.attname = 'customer_id'
  limit 1;

  if v_name is not null then
    execute format(
      'alter table public.property_conversations drop constraint %I', v_name);
  end if;
end $$;

alter table public.property_conversations
  add constraint property_conversations_customer_id_fkey
  foreign key (customer_id) references auth.users(id) on delete set null;

comment on column public.property_conversations.customer_id is
  '상담을 건 고객. 탈퇴하면 NULL이 된다(대화와 메시지는 남는다 — 중개업자의 상담 이력). 화면에서는 "삭제된 사용자"로 표시한다.';

-- ---------------------------------------------------------------------------
-- 2. 계정 삭제
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_agency uuid;
  v_available numeric;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  -- [2026-09-14 사용자 지시] 관리자 계정은 어떤 일이 있어도 유지되어야 한다.
  -- 화면에서 버튼을 숨기는 것으로는 부족하다 — 여기서 막아야 실제로 막힌다.
  if exists (
    select 1
    from public.user_roles
    where user_id = v_uid
      and role::text in ('super_admin', 'admin')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'admin');
  end if;

  -- 잔액은 사용자가 아니라 **업체** 단위다. 소속 업체에 정산되지 않은 돈이 남아
  -- 있으면 지우지 않는다 — 지우고 나면 누구 돈인지 따질 방법이 없어진다.
  -- (무료 기간에는 항상 0이라 이 분기에 걸리지 않는다.)
  for v_agency in
    select agency_id from public.agency_members where user_id = v_uid
  loop
    select b.available into v_available from public.agency_balance(v_agency) b;
    if coalesce(v_available, 0) <> 0 then
      return jsonb_build_object(
        'ok', false, 'reason', 'balance', 'agency_id', v_agency);
    end if;
  end loop;

  -- 삭제를 막는 참조(NO ACTION)를 먼저 끊는다.
  update public.user_permissions
     set granted_by = null
   where granted_by = v_uid;

  -- 등록 매물은 직접 지운다(위 주석 1번). 매물에 딸린 사진·문서·광고 자리는
  -- properties FK가 CASCADE라 함께 사라진다.
  delete from public.properties where created_by = v_uid;

  -- 나머지는 CASCADE / SET NULL 이 처리한다. 세션도 auth.sessions CASCADE로
  -- 함께 끊기므로 이 호출 뒤 토큰은 더 이상 쓸 수 없다.
  delete from auth.users where id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.delete_my_account() is
  '본인 계정 삭제(스토어 심사 필수). 관리자 계정과 업체 잔액이 남은 계정은 거부한다. 반환: {ok:true} 또는 {ok:false, reason:"admin"|"balance"|"not_signed_in"}.';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

commit;
