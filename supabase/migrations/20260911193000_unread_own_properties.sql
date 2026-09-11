-- [2026-09-11 사용자 지시] 상담 미읽음 — "내가 등록한 매물의 대화"로 좁힌다.
--
-- 직전 버전(20260911171500_read_marks.sql)은 "내가 이 대화의 고객이 아니면 고객
-- 메시지를 센다"로만 갈랐다. 그러면 남의 매물 대화까지 볼 수 있는 계정(관리자)에게는
-- **플랫폼 전체의 미답변 고객 메시지**가 잡힌다. 관리자가 보는 숫자와 실제로 그가
-- 답해야 할 건수가 달라지므로, 세는 대상을 두 갈래로 명확히 한다.
--
--   내가 문의한 대화        → 상대(담당자)가 보낸 메시지가 미읽음
--   내가 등록한 매물의 대화  → 고객이 보낸 메시지가 미읽음
--   그 외(볼 수는 있지만 내 매물도, 내 문의도 아닌 대화) → 세지 않는다
--
-- properties를 left join하는 이유: 매물이 비공개로 내려가 RLS에 걸리면 join이 행을
-- 통째로 떨어뜨려, 고객 쪽 미읽음까지 같이 사라진다. left join이면 p가 null이어도
-- 고객 갈래는 그대로 남고 created_by 비교만 조용히 거짓이 된다.
--
-- 투자 쪽(my_new_investment_count)은 바꾸지 않는다 — 투자상품 등록은 관리자·권한자만
-- 할 수 있으므로 "신규 등록된 상품 수"가 곧 사용자 지시의 범위다.
--
-- 이전 마이그레이션: 20260911171500_read_marks.sql

create or replace function public.my_unread_chat_count()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(count(*), 0)::integer
  from public.property_messages m
  join public.property_conversations c on c.id = m.conversation_id
  left join public.properties p on p.id = c.property_id
  left join public.user_read_marks r
    on r.user_id = auth.uid()
   and r.scope = 'property_chat'
   and r.ref_key = c.id::text
  where (
      (c.customer_id = auth.uid() and m.sender_type = 'agent')
      or (p.created_by = auth.uid() and m.sender_type = 'customer')
    )
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz);
$$;

comment on function public.my_unread_chat_count() is
  '내가 아직 읽지 않은 상담 메시지 수 — 내가 문의한 대화의 담당자 메시지 + 내가 등록한 매물의 고객 메시지. 어떤 대화가 보이는지는 RLS가 정한다.';

grant execute on function public.my_unread_chat_count() to authenticated;
