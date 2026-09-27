-- ============================================================================
-- [2026-09-27 사용자 지시] 관리자 푸시(알림) 메시지
--
-- 관리자가 제목·본문·사진·유튜브·링크를 적어 보내고, 보낸 내용은 앱 알림함에서
-- 다시 볼 수 있다.
--
-- 왜 본문을 저장하나: 푸시 알림에는 제목과 짧은 문구만 실린다. 사진 9장과 영상은
-- 알림창에 담을 수 없다. 본문은 여기 남겨 두고, 알림을 누르면 이 행을 열어 보여 준다
-- (user_notifications.link가 그 화면을 가리킨다).
--
-- 왜 사진을 board-images 버킷에 두나: 관리자만 올리고 누구나 보는 공개 이미지라
-- 게시판 이미지와 성격이 같다. 새 버킷을 만들면 정책 4개를 또 붙여야 하고 달라지는
-- 것은 경로뿐이다.
-- ============================================================================

create table if not exists public.push_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  /** 'property' | 'invest' — 알림을 눌렀을 때 어느 쪽 이야기인지 구분한다. */
  topic text not null check (topic in ('property', 'invest')),

  -- ── 발송 대상 ─────────────────────────────────────────────────────────
  -- [2026-09-27 사용자 지시] 세 가지다.
  --   all       전체 가입 계정
  --   interest  매물/투자 관심 계정 — 어느 쪽인지는 audience_topics에 담는다(다중 선택)
  --   investors 실제 투자 이력이 있는 계정
  audience text not null default 'all'
    check (audience in ('all', 'interest', 'investors')),
  /** audience='interest'일 때만 의미가 있다. {'property'}, {'invest'}, 또는 둘 다. */
  audience_topics text[] not null default '{}',

  /** 본문 위에 띄울 유튜브 링크. 없으면 NULL. */
  youtube_url text,
  /** 본문 아래 붙일 외부 링크. 없으면 NULL. */
  link_url text,
  /** 사진 공개 URL 배열. 최대 9장 제한은 앱에서 건다. */
  image_urls text[] not null default '{}',
  /** 실제로 알림함에 들어간 수 — 보낸 뒤에 채운다. */
  sent_count integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.push_campaigns is
  '관리자가 보낸 푸시 메시지의 본문과 발송 대상. 알림함에서 다시 열어 본다.';

alter table public.push_campaigns enable row level security;

-- 읽기: 로그인한 사용자 누구나. 자기에게 온 알림을 눌러 열어야 한다.
drop policy if exists "push_campaigns_select_authenticated" on public.push_campaigns;

create policy "push_campaigns_select_authenticated"
  on public.push_campaigns for select
  to authenticated
  using (true);

drop policy if exists "push_campaigns_insert_admin" on public.push_campaigns;

create policy "push_campaigns_insert_admin"
  on public.push_campaigns for insert
  to authenticated
  with check (public.is_admin_or_above());

grant select, insert on public.push_campaigns to authenticated;


-- ----------------------------------------------------------------------------
-- 대상 계정 목록
-- ----------------------------------------------------------------------------
--
-- 세 규칙을 한 곳에 둔다 — 인원 수를 세는 곳과 실제로 보내는 곳이 **같은 정의**를
-- 써야 "발송가능인원 120명"이라고 보여 주고 80명에게만 가는 일이 없다.
--
--   all       auth.users 전부
--   interest  favorites에 그 종류를 담아 둔 사용자
--             (favorites.target_type: 'property' | 'investment_product')
--   investors investment_orders에 행이 있는 사용자
create or replace function public.push_campaign_audience(
  p_audience text,
  p_topics text[] default '{}'
)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from auth.users u
  where p_audience = 'all'

  union

  select distinct f.user_id
  from public.favorites f
  where p_audience = 'interest'
    and (
      (f.target_type = 'property' and 'property' = any(p_topics))
      or (f.target_type = 'investment_product' and 'invest' = any(p_topics))
    )

  union

  select distinct o.user_id
  from public.investment_orders o
  where p_audience = 'investors';
$$;

revoke all on function public.push_campaign_audience(text, text[]) from public;
grant execute on function public.push_campaign_audience(text, text[]) to authenticated;


-- ----------------------------------------------------------------------------
-- 발송가능인원 — 화면이 보내기 전에 보여 준다
-- ----------------------------------------------------------------------------
create or replace function public.push_audience_count(
  p_audience text,
  p_topics text[] default '{}'
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.push_campaign_audience(p_audience, p_topics);
$$;

revoke all on function public.push_audience_count(text, text[]) from public;
grant execute on function public.push_audience_count(text, text[]) to authenticated;


-- ----------------------------------------------------------------------------
-- 보내기
-- ----------------------------------------------------------------------------
--
-- 앱에서 사용자 목록을 받아 한 명씩 넣지 않는 이유: 사용자 수만큼 왕복이 생기고,
-- 그러려면 앱이 전체 사용자 목록을 읽을 수 있어야 한다(그 자체가 열면 안 되는 문이다).
-- 여기서 한 번에 넣고 **넣은 개수만** 돌려준다.
create or replace function public.send_push_campaign(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.push_campaigns;
  v_count integer := 0;
begin
  if not public.is_admin_or_above() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_campaign from public.push_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'campaign-not-found' using errcode = 'P0002';
  end if;

  -- notify_user를 쓰면 "알림을 끈 사용자는 건너뛴다"는 판단이 한 곳에서 처리된다.
  perform public.notify_user(
    a.user_id,
    'admin_message',
    jsonb_build_object('title', v_campaign.title),
    '/push-message/' || v_campaign.id::text,
    v_campaign.id::text
  )
  from public.push_campaign_audience(v_campaign.audience, v_campaign.audience_topics) a;

  select count(*) into v_count
  from public.user_notifications
  where kind = 'admin_message' and dedupe_key = v_campaign.id::text;

  update public.push_campaigns set sent_count = v_count where id = p_campaign_id;
  return v_count;
end;
$$;

revoke all on function public.send_push_campaign(uuid) from public;
grant execute on function public.send_push_campaign(uuid) to authenticated;

comment on function public.send_push_campaign(uuid) is
  '푸시 메시지를 대상 계정의 알림함에 넣고 그 수를 돌려준다. 실제 발송은 앱이 send-push 엣지 함수를 부른다.';
