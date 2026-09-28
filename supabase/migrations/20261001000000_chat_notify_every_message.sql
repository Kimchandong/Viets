-- ============================================================================
-- 투자 상담 알림 — 메시지마다, 양쪽 모두에게
--
-- [2026-09-28 사용자 지시] 직전 구현의 두 가지를 뒤집는다.
--
--   1) "담당자가 안 읽었으면 다시 알리지 않는다" → 틀렸다.
--      연달아 온 메시지도 새 메시지다. 알림이 유실되거나 눌리지 않았을 수도 있는데,
--      그때 한 번 놓치면 영영 조용해진다. 메시지마다 알린다.
--
--   2) 알림이 담당자에게만 갔다 → 답장은 고객도 받아야 한다.
--      kind를 나눈다: investment_chat(담당자가 받음) / investment_chat_reply(고객이 받음).
--      한 kind로 합치면 수신함 문구를 "누가 보냈는가"에 따라 바꿀 수 없다.
--
-- 수신함이 채팅 로그가 되는 것은 여전히 막는다: 새로 넣기 전에 **그 대화의 이전
-- 알림을 지운다**(읽음 여부와 무관). 그래서 대화당 한 줄만 남고, 그 한 줄은 늘
-- 가장 최근 메시지를 가리킨다. 새 행은 pushed_at이 비어 있으므로 푸시도 매번 나간다.
--
-- 읽고 있는 중일 때 배너를 띄우지 않는 것은 앱이 판단한다(services/push.ts) —
-- "지금 무슨 화면을 보고 있는가"는 서버가 알 수 없는 사실이다.
--
-- 이전 마이그레이션: 20260930000100_investment_chat.sql
-- ============================================================================

create or replace function public.notify_investment_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_investment uuid;
  v_customer uuid;
  v_kind text;
  v_link text;
  v_target uuid;
begin
  select c.investment_id, c.customer_id
    into v_investment, v_customer
    from public.investment_conversations c
   where c.id = new.conversation_id;

  select p.title into v_title
    from public.investment_products p
   where p.id = v_investment;

  v_link := '/invest-chat/' || new.conversation_id::text;
  v_kind := case when new.sender_type = 'customer'
                 then 'investment_chat'
                 else 'investment_chat_reply'
            end;

  for v_target in
    -- 고객이 보냈으면 관리자와 상담 담당 직원에게, 담당자가 보냈으면 그 고객에게.
    select case when new.sender_type = 'customer' then t.user_id else v_customer end
      from (
        select ur.user_id
          from public.user_roles ur
         where new.sender_type = 'customer'
           and ur.role in ('admin', 'super_admin')
        union
        select up.user_id
          from public.user_permissions up
         where new.sender_type = 'customer'
           and up.permission_type = 'chat_support'
           and up.enabled
        union
        -- 담당자가 보낸 경우를 위한 한 줄. 위 두 갈래는 조건이 false라 비어 있다.
        select v_customer
         where new.sender_type <> 'customer'
      ) t
  loop
    if v_target is null then
      continue;
    end if;

    -- 보낸 사람 자신에게는 알리지 않는다. 담당자가 여럿이라 목록에 자기가 낄 수 있고,
    -- 고객이 자기 대화에 관리자 권한까지 가진 계정일 수도 있다.
    if v_target = auth.uid() then
      continue;
    end if;

    -- 이 대화의 이전 알림을 치운다. notify_user는 dedupe_key가 겹치면 아무것도
    -- 하지 않으므로(on conflict do nothing), 지우지 않으면 두 번째 메시지부터
    -- 알림도 푸시도 나가지 않는다.
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

comment on function public.notify_investment_chat() is
  '투자 상담 알림 — 메시지마다 양쪽에 보낸다. 대화당 한 줄만 남기려고 이전 알림을 지우고 다시 넣는다(읽음 여부 무관).';
