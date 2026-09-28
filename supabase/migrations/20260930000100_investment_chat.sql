-- ============================================================================
-- 투자 상담 + 직원 권한 적용
--
-- [2026-09-28 사용자 지시]
--   · 투자 상품에도 상담 버튼을 둔다. 상담 상대는 관리자 또는 직원이다.
--   · 직원은 매물·투자 상담 목록을 보고, 중개업소를 관리·승인한다.
--   · 고객이 상담을 걸면 관리자·직원에게 푸시가 간다.
--
-- 매물 상담(property_conversations / property_messages)과 같은 모양으로 만든다.
-- 다르게 만들면 화면과 번역 캐시를 두 벌로 관리하게 된다.
--
-- 매물 쪽과 달라지는 점 하나: investment_id는 처음부터 **uuid + FK**다.
-- 매물 쪽 property_id가 text라 "삭제된 매물의 상담이 남는" 문제가 있는데
-- (20260911073649 주석), 같은 문제를 새로 만들 이유가 없다.
-- ============================================================================

-- ── 1. 대화방 ───────────────────────────────────────────────────────────────
create table if not exists public.investment_conversations (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references public.investment_products (id) on delete cascade,
  customer_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 한 사람이 같은 상품에 대화를 여러 개 만들지 않게 한다.
  unique (investment_id, customer_id)
);

comment on table public.investment_conversations is
  '투자상품 1:1 상담 대화방. 상담 상대는 관리자 또는 chat_support 권한을 가진 직원이다.';

create index if not exists investment_conversations_customer_idx
  on public.investment_conversations (customer_id);

-- ── 2. 메시지 ───────────────────────────────────────────────────────────────
create table if not exists public.investment_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.investment_conversations (id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'agent')),
  original_text text not null,
  original_lang text not null,
  -- 언어코드 → 번역문. 매물 상담과 같은 메시지 단위 번역 캐시다.
  translations jsonb not null default '{}'::jsonb,
  -- 번역 시도 상태. 매물 쪽(20260916 STEP T-2)에서 뒤늦게 붙인 컬럼들인데,
  -- 없으면 번역이 실패하는 메시지를 **화면을 열 때마다** 다시 번역 호출한다.
  -- 같은 실수를 반복하지 않으려고 처음부터 넣는다.
  translation_status text not null default 'pending'
    check (translation_status in ('pending', 'translated', 'failed', 'skipped')),
  translation_attempts integer not null default 0,
  translation_error text,
  translated_at timestamptz,
  image_url text,
  created_at timestamptz not null default now()
);

comment on table public.investment_messages is
  '투자 상담 메시지. property_messages와 같은 구조 — 화면과 번역 로직을 공유한다.';

create index if not exists investment_messages_conversation_idx
  on public.investment_messages (conversation_id, created_at);

-- ── 3. 상담을 볼 수 있는 사람 ───────────────────────────────────────────────
-- 관리자, 투자상품 담당자, 그리고 상담 전담 직원.
create or replace function public.can_manage_investment_chat()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin_or_above()
    or public.has_user_permission('investment_manage')
    or public.has_user_permission('chat_support');
$$;

comment on function public.can_manage_investment_chat() is
  '투자 상담을 볼 수 있는가. 투자상품은 플랫폼이 직접 올리므로 매물처럼 업체별로 갈리지 않는다 — 상품 id가 필요 없다.';

revoke all on function public.can_manage_investment_chat() from public;
grant execute on function public.can_manage_investment_chat() to authenticated;

-- 매물 상담에도 직원 권한을 더한다. 기존 조건은 그대로 두고 한 줄만 붙인다.
create or replace function public.can_manage_property_chat(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin_or_above()
    or public.has_user_permission('property_manage')
    -- [2026-09-28] 상담 전담 직원.
    or public.has_user_permission('chat_support')
    or exists (
      select 1
      from public.properties p
      where p.id = target_property_id
        and public.can_manage_agency_property(p.agency_id)
    );
$$;

-- ── 4. RLS ─────────────────────────────────────────────────────────────────
alter table public.investment_conversations enable row level security;
alter table public.investment_messages enable row level security;

drop policy if exists "investment_conversations_customer" on public.investment_conversations;
create policy "investment_conversations_customer"
  on public.investment_conversations
  for all
  using (auth.uid() = customer_id)
  with check (auth.uid() = customer_id);

drop policy if exists "investment_conversations_manager" on public.investment_conversations;
create policy "investment_conversations_manager"
  on public.investment_conversations
  for select
  using (public.can_manage_investment_chat());

drop policy if exists "investment_messages_customer" on public.investment_messages;
create policy "investment_messages_customer"
  on public.investment_messages
  for all
  using (
    exists (
      select 1 from public.investment_conversations c
      where c.id = conversation_id and c.customer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.investment_conversations c
      where c.id = conversation_id and c.customer_id = auth.uid()
    )
    -- 고객은 고객 말풍선만 쓸 수 있다. 담당자 행세를 막는다.
    and sender_type = 'customer'
  );

drop policy if exists "investment_messages_manager" on public.investment_messages;
create policy "investment_messages_manager"
  on public.investment_messages
  for all
  using (public.can_manage_investment_chat())
  with check (public.can_manage_investment_chat() and sender_type = 'agent');

grant select, insert, update, delete on public.investment_conversations to authenticated;
grant select, insert, update, delete on public.investment_messages to authenticated;

-- ── 5. 알림 ────────────────────────────────────────────────────────────────
-- 고객이 말을 걸면 관리자·직원 전원에게 알린다. 관리자마다 notify_user를 따로 불러
-- 각자의 수신 설정이 적용되게 한다(payment_requested와 같은 방식).
create or replace function public.notify_investment_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_investment uuid;
  v_staff uuid;
begin
  -- 담당자가 쓴 말에는 관리자에게 알리지 않는다 — 자기들끼리 알림이 돈다.
  if new.sender_type <> 'customer' then
    return new;
  end if;

  select c.investment_id into v_investment
    from public.investment_conversations c
   where c.id = new.conversation_id;

  select p.title into v_title
    from public.investment_products p
   where p.id = v_investment;

  for v_staff in
    select ur.user_id from public.user_roles ur where ur.role in ('admin', 'super_admin')
    union
    select up.user_id from public.user_permissions up
     where up.permission_type = 'chat_support' and up.enabled
  loop
    -- 이미 **읽은** 알림은 치운다. notify_user는 dedupe_key가 겹치면 아무것도
    -- 하지 않으므로(on conflict do nothing), 이 줄이 없으면 한 대화에서 알림이
    -- 딱 한 번만 간다 — 담당자가 첫 문의를 읽고 나면 고객이 다시 말을 걸어도
    -- 영영 조용하다. 그렇다고 메시지마다 남기면 수신함이 채팅 로그가 된다.
    --
    -- 그래서 "안 읽은 알림이 있으면 더 쌓지 않고, 읽었으면 다시 알린다" —
    -- 채팅 앱이 실제로 하는 동작이고, 수신함에는 대화당 최대 한 줄만 남는다.
    delete from public.user_notifications
     where user_id = v_staff
       and kind = 'investment_chat'
       and dedupe_key = new.conversation_id::text
       and read_at is not null;

    perform public.notify_user(
      v_staff,
      'investment_chat',
      jsonb_build_object('title', coalesce(v_title, '')),
      '/invest-chat/' || new.conversation_id::text,
      new.conversation_id::text
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists investment_messages_notify on public.investment_messages;

create trigger investment_messages_notify
  after insert on public.investment_messages
  for each row
  execute function public.notify_investment_chat();

-- ── 6. 계정 검색에 직원 권한 두 칸 추가 ─────────────────────────────────────
-- 반환 칸이 늘어나므로 먼저 지운다 — create or replace로는 시그니처를 바꿀 수 없다.
drop function if exists public.admin_search_users(text);

create function public.admin_search_users(search text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  is_admin boolean,
  investment_manage boolean,
  property_manage boolean,
  chat_support boolean,
  agency_manage boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'permission denied: admin only'
      using errcode = 'insufficient_privilege';
  end if;

  if search is null or length(btrim(search)) < 2 then
    raise exception 'search term must be at least 2 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  select
    u.id,
    -- auth.users.email은 varchar(255)라 text로 캐스팅해야 선언과 맞는다(20260924 참고).
    u.email::text,
    p.display_name,
    exists (
      select 1 from public.user_roles r
      where r.user_id = u.id and r.role in ('admin', 'super_admin')
    ),
    exists (
      select 1 from public.user_permissions up
      where up.user_id = u.id and up.permission_type = 'investment_manage' and up.enabled
    ),
    exists (
      select 1 from public.user_permissions up
      where up.user_id = u.id and up.permission_type = 'property_manage' and up.enabled
    ),
    exists (
      select 1 from public.user_permissions up
      where up.user_id = u.id and up.permission_type = 'chat_support' and up.enabled
    ),
    exists (
      select 1 from public.user_permissions up
      where up.user_id = u.id and up.permission_type = 'agency_manage' and up.enabled
    )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email ilike '%' || btrim(search) || '%'
     or coalesce(p.display_name, '') ilike '%' || btrim(search) || '%'
  order by u.email
  limit 20;
end;
$$;

comment on function public.admin_search_users(text) is
  '관리자 전용 계정 검색(이메일/표시이름 부분일치, 최대 20건). 직원 권한(chat_support/agency_manage) 두 칸을 2026-09-28에 더했다.';

grant execute on function public.admin_search_users(text) to authenticated;
