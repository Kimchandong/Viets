-- STEP 07-c — 매물 담당자가 상담 대화를 읽고 답할 수 있게 한다(채팅 양방향).
--
-- 배경(2026-09-11): 채팅은 "고객 1명 ↔ mock 담당자 자동응답"을 전제로 만들어졌다.
-- 정책이 `auth.uid() = customer_id` 하나뿐이라, **대화를 만든 본인만** 그 대화를 본다.
-- 그래서 중개업소 계정으로 같은 매물의 상담에 들어가면 상대 대화가 보이는 게 아니라
-- 자기 이름으로 된 새 대화방이 하나 더 생겼다 — 두 계정이 서로 대화하는 것이 구조상
-- 불가능했다.
--
-- 이 파일은 기존 고객 정책을 **그대로 두고**, 담당자용 정책을 추가한다(정책은 OR로
-- 결합된다). 고객이 보는 범위는 조금도 넓어지지 않는다.
--
-- "담당자"의 정의는 매물 쪽 권한 체계를 그대로 따른다:
--   1) admin 계열,
--   2) 관리자가 부여한 `property_manage` 권한 보유자(직원·운영자 등),
--   3) 그 매물을 보유한 Agency의 활성 멤버 중 property_listing 권한이 있는 계정.
-- 3번은 Agency 온보딩(D46)이 정해지기 전이라 아직 실제로 쓰이지 않지만, 지금
-- 넣어 두면 그때 정책을 다시 건드릴 필요가 없다.

-- ---------------------------------------------------------------------------
-- 1. 판정 헬퍼
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER인 이유: properties를 조회해 agency_id를 얻어야 하는데, 호출자의
-- 권한으로 읽으면 비공개(draft) 매물에서 판정이 어긋난다. 판정에 필요한 최소 정보만
-- 읽고 boolean만 돌려주므로 정보가 새지 않는다.
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
    or exists (
      select 1
      from public.properties p
      where p.id = target_property_id
        and public.can_manage_agency_property(p.agency_id)
    );
$$;

revoke all on function public.can_manage_property_chat(uuid) from public;
grant execute on function public.can_manage_property_chat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. property_conversations — 담당자 읽기
-- ---------------------------------------------------------------------------
-- INSERT는 주지 않는다: 상담은 고객이 시작한다. 담당자가 먼저 말을 걸 수 있게 하려면
-- "어느 고객에게"를 정하는 UI가 먼저 필요하다(지금은 없다).
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.property_conversations'::regclass
      and polname = 'managers read property conversations'
  ) then
    create policy "managers read property conversations"
      on public.property_conversations
      for select
      to authenticated
      using (public.can_manage_property_chat(property_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. property_messages — 담당자 읽기 / 답장 / 번역 캐시 쓰기
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.property_messages'::regclass
      and polname = 'managers read property messages'
  ) then
    create policy "managers read property messages"
      on public.property_messages
      for select
      to authenticated
      using (
        exists (
          select 1 from public.property_conversations c
          where c.id = property_messages.conversation_id
            and public.can_manage_property_chat(c.property_id)
        )
      );
  end if;

  -- 답장은 **agent 메시지로만** 허용한다. 담당자가 고객인 척 글을 남길 수 없다.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.property_messages'::regclass
      and polname = 'managers send agent messages'
  ) then
    create policy "managers send agent messages"
      on public.property_messages
      for insert
      to authenticated
      with check (
        sender_type = 'agent'
        and exists (
          select 1 from public.property_conversations c
          where c.id = property_messages.conversation_id
            and public.can_manage_property_chat(c.property_id)
        )
      );
  end if;

  -- UPDATE가 필요한 이유: 화면이 메시지를 보여줄 때 번역 결과를 그 행의
  -- translations 컬럼에 캐시한다(services/chat.ts getTranslatedText). 담당자가
  -- 고객 메시지를 자기 언어로 볼 때도 같은 캐시를 써야 하므로 쓰기가 필요하다.
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.property_messages'::regclass
      and polname = 'managers update message translations'
  ) then
    create policy "managers update message translations"
      on public.property_messages
      for update
      to authenticated
      using (
        exists (
          select 1 from public.property_conversations c
          where c.id = property_messages.conversation_id
            and public.can_manage_property_chat(c.property_id)
        )
      )
      with check (
        exists (
          select 1 from public.property_conversations c
          where c.id = property_messages.conversation_id
            and public.can_manage_property_chat(c.property_id)
        )
      );
  end if;
end $$;
