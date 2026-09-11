-- [2026-09-11 사용자 지시] 홈 상단 우측 알림 — 부동산(상담 미읽음) / 투자(신규 상품).
--
-- 지금까지 이 앱에는 "읽었다"는 기록이 어디에도 없었다. 홈 상단의 종 아이콘 숫자는
-- constants/mockData.ts의 MOCK_UNREAD_NOTIFICATION_COUNT라는 고정값이었다.
--
-- 읽음 표시를 항목 종류마다 따로 만들지 않고 한 테이블에 모은다. 기록해야 할 것이
-- "누가 / 무엇을 / 언제까지 봤는가" 하나뿐이라 테이블을 나누면 같은 모양이 두 벌이
-- 되고, 앞으로 다른 알림이 생길 때마다 또 하나씩 늘어난다.
--
-- 이전 마이그레이션: 20260911170000_boards.sql

-- ============================================================================
-- 1. 읽음 표시
-- ============================================================================

create table if not exists public.user_read_marks (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 무엇에 대한 읽음인지. 'property_chat' | 'investment_list'
  scope text not null,
  -- 대상 하나를 가리키는 키. 상담은 대화 id, 목록 전체를 보는 것(투자)은 빈 문자열.
  -- null이 아니라 빈 문자열인 이유: 기본키에 null이 들어가면 중복을 막지 못한다.
  ref_key text not null default '',
  last_read_at timestamptz not null default now(),
  primary key (user_id, scope, ref_key)
);

comment on table public.user_read_marks is
  '사용자가 무엇을 언제까지 봤는지. 읽지 않은 개수는 이 시각 이후에 생긴 것을 세서 구한다.';
comment on column public.user_read_marks.ref_key is
  '대상 키 — property_chat은 대화 id, investment_list처럼 목록 전체를 보는 scope는 빈 문자열.';

alter table public.user_read_marks enable row level security;

-- 남의 읽음 기록은 보이지도, 쓰이지도 않는다.
drop policy if exists "user_read_marks_select_own" on public.user_read_marks;

create policy "user_read_marks_select_own"
  on public.user_read_marks for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_read_marks_write_own" on public.user_read_marks;

create policy "user_read_marks_write_own"
  on public.user_read_marks for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 마이그레이션으로 만든 테이블에는 Supabase가 권한을 자동으로 주지 않는다.
grant select, insert, update, delete on public.user_read_marks to authenticated;

-- ============================================================================
-- 2. 읽음 처리
-- ============================================================================
--
-- security definer를 쓰지 않는다(기본값 invoker). 그래야 위 RLS가 그대로 적용돼
-- 남의 user_id로 기록을 남길 수 없다 — 함수 안에서 권한을 다시 검사할 필요가 없다.

create or replace function public.mark_read(target_scope text, target_ref text default '')
returns void
language sql
volatile
set search_path = public
as $$
  insert into public.user_read_marks (user_id, scope, ref_key, last_read_at)
  values (auth.uid(), target_scope, coalesce(target_ref, ''), now())
  on conflict (user_id, scope, ref_key)
  do update set last_read_at = now();
$$;

comment on function public.mark_read(text, text) is
  '지금 시각까지 읽은 것으로 표시한다. 호출자 권한으로 동작하므로 자기 기록만 남길 수 있다.';

grant execute on function public.mark_read(text, text) to authenticated;

-- ============================================================================
-- 3. 상담 미읽음 수
-- ============================================================================
--
-- property_messages에는 보낸 사람의 id가 없고 sender_type('customer' | 'agent')만
-- 있다. 그래서 "내가 보내지 않은 메시지"는 내가 이 대화에서 어느 쪽인지로 정한다 —
-- 내가 이 대화의 고객이면 agent가 보낸 것이, 아니면 customer가 보낸 것이 상대 메시지다.
--
-- 이 함수도 invoker다. 어떤 대화가 내게 보이는지는 이미 property_conversations /
-- property_messages의 RLS(can_manage_property_chat 등)가 정하고 있으므로, 그 판단을
-- 여기에 다시 적어 두면 둘이 어긋나는 순간 남의 상담 건수가 새어 나간다.

create or replace function public.my_unread_chat_count()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(count(*), 0)::integer
  from public.property_messages m
  join public.property_conversations c on c.id = m.conversation_id
  left join public.user_read_marks r
    on r.user_id = auth.uid()
   and r.scope = 'property_chat'
   and r.ref_key = c.id::text
  where m.sender_type = case when c.customer_id = auth.uid() then 'agent' else 'customer' end
    and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz);
$$;

comment on function public.my_unread_chat_count() is
  '내가 아직 읽지 않은 상담 메시지 수. 어떤 대화가 포함되는지는 RLS가 정한다.';

grant execute on function public.my_unread_chat_count() to authenticated;

-- ============================================================================
-- 4. 신규 투자상품 수
-- ============================================================================
--
-- 읽음 기록이 아직 없는 사람(앱을 처음 켠 경우)에게 '-infinity'를 쓰면 등록된 상품
-- 전체가 "신규"가 된다. 처음 보는 화면에 숫자가 수십으로 떠 있으면 알림이 아니라
-- 장식이 되므로, 기록이 없을 때는 최근 7일치만 새 것으로 본다.

create or replace function public.my_new_investment_count()
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(count(*), 0)::integer
  from public.investment_products p
  left join public.user_read_marks r
    on r.user_id = auth.uid()
   and r.scope = 'investment_list'
   and r.ref_key = ''
  where p.created_at > coalesce(r.last_read_at, now() - interval '7 days');
$$;

comment on function public.my_new_investment_count() is
  '마지막으로 투자 목록을 본 뒤 등록된 상품 수. 기록이 없으면 최근 7일치를 센다. 어떤 상품이 보이는지는 RLS가 정한다.';

grant execute on function public.my_new_investment_count() to anon, authenticated;
