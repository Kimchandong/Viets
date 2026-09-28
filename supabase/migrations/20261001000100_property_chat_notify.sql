-- ============================================================================
-- 매물 1:1 상담 알림 — 투자 상담과 같은 규칙으로
--
-- [2026-09-28 사용자 지시] 매물 상담에는 알림 트리거가 **아예 없었다.** 홈 화면의
-- 숫자 배지(my_unread_chat_count)만 있어서, 앱을 열어 보지 않으면 문의가 온 줄
-- 알 수 없었다. 투자 상담과 같은 구조를 넣는다.
--
-- 받는 사람이 투자 쪽과 다르다. 투자 상품은 플랫폼이 직접 올리므로 관리자가 받지만,
-- 매물은 업체가 올린다 — 관리자 전원에게 보내면 **매물 수만큼 알림이 쏟아진다.**
-- 그래서:
--   · 그 매물을 올린 업체의 활성 구성원
--   · 상담 전담 직원(chat_support)
--   · 업체가 없는 매물(플랫폼이 직접 올린 것)만 관리자 전원
-- 관리자가 모든 매물 상담을 받고 싶으면 자기 계정에 chat_support를 주면 된다.
--
-- 이전 마이그레이션: 20261001000000_chat_notify_every_message.sql
-- ============================================================================

create or replace function public.notify_property_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_property text;
  v_agency uuid;
  v_customer uuid;
  v_kind text;
  v_link text;
  v_target uuid;
begin
  select c.property_id, c.customer_id
    into v_property, v_customer
    from public.property_conversations c
   where c.id = new.conversation_id;

  -- property_id가 text다(Mock 시절 구조가 남은 것 — 20260911073649 주석).
  -- uuid가 아닌 옛 값이 섞여 있을 수 있어 캐스팅이 아니라 text 비교로 맞춘다.
  select p.title, p.agency_id
    into v_title, v_agency
    from public.properties p
   where p.id::text = v_property;

  v_link := '/property-chat/' || v_property || '?conversationId=' || new.conversation_id::text;
  v_kind := case when new.sender_type = 'customer'
                 then 'property_chat'
                 else 'property_chat_reply'
            end;

  for v_target in
    select t.user_id
      from (
        -- 그 매물 업체의 활성 구성원.
        select m.user_id
          from public.agency_members m
         where new.sender_type = 'customer'
           and v_agency is not null
           and m.agency_id = v_agency
           and m.status = 'active'
        union
        -- 상담 전담 직원.
        select up.user_id
          from public.user_permissions up
         where new.sender_type = 'customer'
           and up.permission_type = 'chat_support'
           and up.enabled
        union
        -- 업체가 없는 매물은 받을 사람이 없다 — 관리자가 받는다.
        select ur.user_id
          from public.user_roles ur
         where new.sender_type = 'customer'
           and v_agency is null
           and ur.role in ('admin', 'super_admin')
        union
        -- 담당자가 보낸 경우. 위 세 갈래는 조건이 false라 비어 있다.
        select v_customer
         where new.sender_type <> 'customer'
      ) t
  loop
    if v_target is null or v_target = auth.uid() then
      continue;
    end if;

    -- 이전 알림을 치우고 다시 넣는다 — 지우지 않으면 notify_user가
    -- on conflict do nothing으로 넘어가, 두 번째 메시지부터 조용해진다.
    delete from public.user_notifications
     where user_id = v_target
       and kind = v_kind
       and dedupe_key = new.conversation_id::text;

    perform public.notify_user(
      v_target,
      v_kind,
      jsonb_build_object('title', coalesce(v_title, '')),
      v_link,
      new.conversation_id::text
    );
  end loop;

  return new;
end;
$$;

comment on function public.notify_property_chat() is
  '매물 상담 알림 — 메시지마다 양쪽에 보낸다. 받는 쪽은 그 매물 업체의 구성원과 상담 직원이고, 업체가 없는 매물만 관리자가 받는다.';

drop trigger if exists property_messages_notify on public.property_messages;

create trigger property_messages_notify
  after insert on public.property_messages
  for each row
  execute function public.notify_property_chat();
