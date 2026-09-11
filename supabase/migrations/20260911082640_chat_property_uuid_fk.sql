-- STEP 07-b — 채팅 property_id를 text → uuid + FK로 정리.
--
-- 배경: `property_conversations.property_id`는 Mock 시절(매물 id가 "p1" 같은 문자열이던
-- 때) 구조가 그대로 남아 text이고, `properties`에 FK가 없다. 2026-09-11 D51(스키마
-- migration 편입) 때는 데이터를 건드리지 않기 위해 현재 구조를 그대로 캡처만 했고
-- (20260911073649_chat_schema_capture.sql), 정리는 이 파일로 분리했다.
--
-- 지금 하는 이유: 실사용 상담 이력이 쌓이기 전이라 손실 없이 바꿀 수 있다. 그대로 두면
--   (a) 매물을 삭제해도 대화가 남아 어떤 매물 얘기인지 알 수 없는 행이 생기고,
--   (b) 존재하지 않는 매물 id로도 대화를 만들 수 있다.
--
-- 2026-09-11 사용자 결정: **변환 불가능한 레거시 대화는 삭제한다.**
--   'p1'은 Mock 시절 테스트 대화이지 실제 상담 이력이 아니다. uuid로 캐스팅 자체가
--   불가능하므로 남겨 둘 방법이 없다(컬럼을 nullable로 바꾸는 안은 "매물 없는 대화"를
--   계속 허용하게 되어 이 작업의 목적과 어긋난다).
--
-- 삭제 대상은 두 부류다. 둘 다 FK를 걸 수 없게 만드는 행이다:
--   1. property_id가 uuid 형식이 아닌 행 (예: 'p1')
--   2. uuid 형식이지만 properties에 그 id가 없는 행 (고아)
-- property_messages는 conversation_id FK가 ON DELETE CASCADE라 함께 지워진다.
--
-- 이 파일은 여러 번 적용해도 안전하다 — 이미 uuid로 바뀐 뒤에는 2~3번 블록이 건너뛴다.

-- ---------------------------------------------------------------------------
-- 1. 전환할 수 없는 대화 삭제
-- ---------------------------------------------------------------------------

do $$
declare
  removed_legacy int := 0;
  removed_orphan int := 0;
begin
  -- 이미 uuid로 전환된 환경(재적용/신규 환경)에서는 아무것도 하지 않는다.
  if (
    select data_type from information_schema.columns
    where table_schema = 'public'
      and table_name = 'property_conversations'
      and column_name = 'property_id'
  ) is distinct from 'text' then
    raise notice 'property_id is already uuid — skipping cleanup';
    return;
  end if;

  -- (1) uuid 형식이 아닌 값. 정규식으로 판정한다 — `::uuid` 캐스팅을 먼저 하면
  --     잘못된 값에서 22P02로 트랜잭션 전체가 중단된다.
  delete from public.property_conversations
  where property_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  get diagnostics removed_legacy = row_count;

  -- (2) uuid이지만 실제 매물이 없는 행. 위 삭제 이후라 남은 값은 전부 캐스팅 가능하다.
  delete from public.property_conversations c
  where not exists (
    select 1 from public.properties p where p.id = c.property_id::uuid
  );
  get diagnostics removed_orphan = row_count;

  raise notice 'removed % legacy conversation(s), % orphan conversation(s)', removed_legacy, removed_orphan;
end $$;

-- ---------------------------------------------------------------------------
-- 2. 컬럼 타입 전환
-- ---------------------------------------------------------------------------
-- UNIQUE (property_id, customer_id) 제약과 인덱스는 타입 변경을 따라 자동으로 재생성된다.

do $$
begin
  if (
    select data_type from information_schema.columns
    where table_schema = 'public'
      and table_name = 'property_conversations'
      and column_name = 'property_id'
  ) = 'text' then
    alter table public.property_conversations
      alter column property_id type uuid using property_id::uuid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. FK 연결
-- ---------------------------------------------------------------------------
-- ON DELETE CASCADE: 매물을 하드 삭제하면 그 매물의 상담 대화도 함께 사라진다
-- (property_images와 같은 규칙). 삭제의 기본 동작은 소프트 삭제(status='archived')이고
-- 하드 삭제는 admin 전용이라, 상담 이력이 의도치 않게 날아가는 경로는 아니다.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_conversations'::regclass
      and conname = 'property_conversations_property_id_fkey'
  ) then
    alter table public.property_conversations
      add constraint property_conversations_property_id_fkey
      foreign key (property_id) references public.properties (id) on delete cascade;
  end if;
end $$;

-- 대화 목록을 매물 기준으로 찾는 조회(매물 상세 → 내 상담)를 위한 인덱스.
create index if not exists property_conversations_property_idx
  on public.property_conversations (property_id);

comment on column public.property_conversations.property_id is
  '상담 대상 매물. 2026-09-11에 text → uuid + FK로 전환했다(Mock 시절 문자열 id 호환 구조 제거). 매물 하드 삭제 시 대화도 함께 삭제된다.';
