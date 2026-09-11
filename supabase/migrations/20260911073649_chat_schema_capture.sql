-- STEP 07-a — Chat DB 스키마 migration 편입 (D51 해소).
--
-- 배경: `property_conversations` / `property_messages`는 2026-09-08 STEP 4-15에서
-- Supabase Dashboard의 SQL Editor로 직접 생성됐다. 이 프로젝트가 스스로 정한
-- "DB 변경은 반드시 migration SQL로 관리한다"(원칙 8)에서 벗어난 유일한 지점이었다
-- (MASTER_PROJECT_AUDIT §6.2, DECISIONS.md D51).
--
-- 이 파일은 **새로 만드는 것이 아니라 이미 있는 것을 기록으로 남기는 작업**이다.
-- 2026-09-11 시점의 실제 원격 스키마를 information_schema/pg_constraint/pg_policy로
-- 조회해 그대로 옮겨 적었다. 따라서:
--   - 모든 객체에 `if not exists` / 중복 방지 가드를 둔다. 이미 존재하는 운영 DB에
--     적용해도 아무것도 바뀌지 않고, 새 환경(staging 등)에서는 동일한 스키마가 생긴다.
--   - 기존 데이터(대화 2건/메시지 10건)는 건드리지 않는다.
--
-- 설계상 알려진 한계(2026-09-11 사용자 결정: 현재 구조 그대로 캡처):
--   `property_conversations.property_id`는 **text**이고 `properties`에 FK가 없다.
--   Mock 시절 문자열 id("p1")를 받으려고 그렇게 만들어졌고, 실제 매물이 UUID가 된
--   지금은 UUID 문자열이 들어간다. 그 결과 (a) 매물을 삭제해도 대화가 남고,
--   (b) 존재하지 않는 매물 id로도 대화를 만들 수 있다. 실사용 상담 이력이 쌓이기
--   전에 uuid + FK로 정리하는 편이 안전하며, 그 작업은 별도 STEP으로 분리한다.
--
-- translation_status/translation_attempts/translation_error/translated_at 4개 컬럼은
-- 20260910094520_translation_cache.sql이 이미 추가했다 — 이 파일에서는 다루지 않는다
-- (그 migration이 먼저 적용되는 순서를 전제로 한다).

-- ---------------------------------------------------------------------------
-- 1. property_conversations
-- ---------------------------------------------------------------------------

create table if not exists public.property_conversations (
  id uuid primary key default gen_random_uuid(),
  -- text인 이유는 위 주석 참조(Mock 시절 문자열 id 호환).
  property_id text not null,
  customer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- 한 사용자가 같은 매물에 대해 대화를 여러 개 만들지 않도록 막는다
  -- (services/chat.ts의 getOrCreateConversation이 이 제약을 전제로 동작한다).
  unique (property_id, customer_id)
);

comment on table public.property_conversations is
  '매물 1:1 상담 대화방. 2026-09-08 SQL Editor로 생성된 것을 2026-09-11에 migration으로 편입했다(D51). property_id가 text이고 properties FK가 없는 것은 Mock 시절 구조가 남은 것이다 — 별도 STEP에서 정리 예정.';

alter table public.property_conversations enable row level security;

-- 고객 본인만 자기 대화를 다룬다. 상담원(agent)은 아직 별도 로그인 계정이 없어
-- (mock 담당자 시뮬레이션) 이 정책 하나로 양쪽 메시지를 모두 처리한다.
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.property_conversations'::regclass
      and polname = 'customers manage own conversations'
  ) then
    create policy "customers manage own conversations"
      on public.property_conversations
      for all
      using (auth.uid() = customer_id)
      with check (auth.uid() = customer_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. property_messages
-- ---------------------------------------------------------------------------

create table if not exists public.property_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.property_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'agent')),
  original_text text not null,
  original_lang text not null,
  -- 언어코드 → 번역문. 메시지 단위 번역 캐시로, 같은 메시지를 다시 열 때 서버
  -- 왕복조차 하지 않는다(20260910094520 참조).
  translations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- 이미지 메시지는 original_text가 빈 문자열이고 이 컬럼에 Storage 공개 URL이 들어간다.
  image_url text
);

comment on table public.property_messages is
  '매물 상담 메시지. 2026-09-08 SQL Editor로 생성된 것을 2026-09-11에 migration으로 편입했다(D51).';

alter table public.property_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.property_messages'::regclass
      and polname = 'customers manage own messages'
  ) then
    create policy "customers manage own messages"
      on public.property_messages
      for all
      using (
        exists (
          select 1 from public.property_conversations c
          where c.id = property_messages.conversation_id
            and c.customer_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.property_conversations c
          where c.id = property_messages.conversation_id
            and c.customer_id = auth.uid()
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. GRANT (2026-09-10 규칙 — 정책만으로는 접근이 전면 거부된다)
-- ---------------------------------------------------------------------------
-- 이 두 테이블의 GRANT 누락은 2026-09-09에 이미 한 번 사고로 드러났고
-- (20260909090000_grant_chat_table_privileges.sql로 수정), 같은 부류가 Property
-- Domain에서 재발했다(20260910061326). 새 환경에서도 빠지지 않도록 여기서 함께 건다.

grant select, insert, update, delete on public.property_conversations to authenticated;
grant select, insert, update, delete on public.property_messages to authenticated;

-- 비로그인(anon)은 상담 기능 자체를 쓸 수 없으므로 어떤 권한도 주지 않는다.

-- ---------------------------------------------------------------------------
-- 4. 인덱스
-- ---------------------------------------------------------------------------
-- 대화별 메시지 조회(fetchMessages)가 가장 빈번한 쿼리다.

create index if not exists property_messages_conversation_created_idx
  on public.property_messages (conversation_id, created_at);

create index if not exists property_conversations_customer_idx
  on public.property_conversations (customer_id);
