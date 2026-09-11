-- [2026-09-11 사용자 지시] 게시판 — 공지사항 / QA / FAQ.
--
-- 홈의 "시장 소식"은 constants/mockData.ts의 MOCK_MARKET_INSIGHTS 3건을 그대로
-- 뿌리고 있었다(코드에 박힌 베트남어 문장, 번역 안 됨, 눌러도 "준비중"). 그 자리를
-- 관리자가 올린 공지사항 최신 10건으로 바꾼다.
--
-- 세 게시판은 한 테이블(board_posts)에 kind로 나눠 담는다. 필드가 거의 같기 때문이다
-- — 공지는 제목+본문, FAQ는 질문+답변, QA는 질문+본문에 관리자 답변이 붙는 형태라
-- 전부 "제목 하나 + 본문 하나"로 떨어진다. 테이블을 셋으로 나누면 RLS·GRANT·인덱스·
-- 서비스 함수가 세 벌이 되고, 홈에서 여러 종류를 같이 뽑을 때도 union이 필요해진다.
--
-- 번역 정책(사용자 결정):
--   공지사항 / FAQ  → 등록할 때 6개 언어를 미리 만들어 title_i18n / body_i18n에 담는다.
--   QA              → 번역하지 않는다(소셜로그인 계정의 익명 글).
-- 그래서 번역 결과 칼럼은 null을 허용한다 — QA 행은 비어 있는 게 정상이다.
--
-- 번역 자체는 앱에서 기존 translate 엣지 함수를 불러 채운다. DB에서 부르지 않는
-- 이유는 그 함수가 호출자 JWT를 검사하고 사용량을 translation_usage_log에 남기기
-- 때문이다 — 관리자 화면의 번역 사용량 집계에 이 글들도 같이 잡혀야 한다.
--
-- 이전 마이그레이션: 20260911161016_property_region.sql

-- ============================================================================
-- 1. 게시판 종류
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'board_kind') then
    create type public.board_kind as enum ('notice', 'qa', 'faq');
  end if;
end
$$;

-- ============================================================================
-- 2. 글
-- ============================================================================

create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  kind public.board_kind not null,

  -- 작성자가 쓴 원문. 공지/FAQ는 관리자가, QA는 로그인 사용자가 쓴다.
  title text not null,
  body text not null default '',

  -- 원문이 어느 언어로 쓰였는지. 번역할 때 출발 언어로 쓰고, 보는 사람의 언어가
  -- 이것과 같으면 번역본 대신 원문을 보여 준다.
  source_lang text not null default 'ko',

  -- 언어코드 -> 번역문. 공지/FAQ만 채워진다(QA는 null).
  title_i18n jsonb,
  body_i18n jsonb,

  author_id uuid references auth.users (id) on delete set null,

  -- QA 답변 — 관리자만 쓴다. 답변이 하나뿐이라 별도 테이블을 두지 않는다.
  answer_body text,
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,

  -- 공지 상단 고정. FAQ에서는 정렬 우선순위로도 쓴다.
  pinned boolean not null default false,
  sort_order integer not null default 0,

  -- 관리자가 임시로 내릴 수 있어야 한다 — 지우면 되돌릴 수 없다.
  published boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.board_posts is
  '게시판 글 — 공지사항(notice) / 익명 질문(qa) / 자주 묻는 질문(faq). kind로 나눈다.';
comment on column public.board_posts.source_lang is
  '원문 언어. 보는 사람의 언어가 이 값과 같으면 title/body 원문을 그대로 쓴다.';
comment on column public.board_posts.title_i18n is
  '언어코드 -> 번역된 제목. 등록할 때 앱이 translate 엣지 함수로 채운다. QA는 번역하지 않으므로 null.';
comment on column public.board_posts.answer_body is
  'QA 답변(관리자 전용). 공지/FAQ에서는 쓰지 않는다 — FAQ의 답변은 body에 들어간다.';

create index if not exists board_posts_kind_created_idx
  on public.board_posts (kind, created_at desc);

-- 공지 목록은 "고정 먼저, 그다음 최신순"으로 뽑는다.
create index if not exists board_posts_kind_pinned_idx
  on public.board_posts (kind, pinned desc, created_at desc);

create index if not exists board_posts_author_idx
  on public.board_posts (author_id);

-- ============================================================================
-- 3. 공지 첨부 이미지 — 최대 3장
-- ============================================================================
--
-- property_images와 같은 모양으로 둔다. 개수 제한은 트리거로 막는다 — 화면에서만
-- 막으면 나중에 다른 경로로 들어올 때 4장째가 조용히 들어온다.

create table if not exists public.board_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts (id) on delete cascade,
  url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.board_post_images is
  '공지사항 첨부 이미지. 글당 최대 3장(board_post_images_limit 트리거).';

create index if not exists board_post_images_post_idx
  on public.board_post_images (post_id, sort_order);

create or replace function public.enforce_board_image_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.board_post_images where post_id = new.post_id) >= 3 then
    raise exception 'board post % already has 3 images', new.post_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists board_post_images_limit on public.board_post_images;

create trigger board_post_images_limit
  before insert on public.board_post_images
  for each row execute function public.enforce_board_image_limit();

-- ============================================================================
-- 4. 첨부 이미지 버킷
-- ============================================================================
--
-- 공지 이미지는 비로그인 사용자에게도 보여야 하므로 공개 버킷이다(매물 사진과 같다).
-- 업로드는 관리자만.

insert into storage.buckets (id, name, public)
values ('board-images', 'board-images', true)
on conflict (id) do nothing;

drop policy if exists "board_images_read_public" on storage.objects;

create policy "board_images_read_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'board-images');

drop policy if exists "board_images_insert_admin" on storage.objects;

create policy "board_images_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'board-images' and public.is_admin_or_above());

drop policy if exists "board_images_update_admin" on storage.objects;

create policy "board_images_update_admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'board-images' and public.is_admin_or_above());

drop policy if exists "board_images_delete_admin" on storage.objects;

create policy "board_images_delete_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'board-images' and public.is_admin_or_above());

-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table public.board_posts enable row level security;
alter table public.board_post_images enable row level security;

-- 읽기 — 게시된 글은 로그인 없이도 보인다. 홈 화면이 비로그인 상태에서도 공지를
-- 보여 줘야 하고, QA도 "목록은 전체 공개"로 정했다(작성자만 익명으로 가린다 —
-- 화면에서 이름을 띄우지 않는 것이지 행을 감추는 게 아니다).
drop policy if exists "board_posts_select_published" on public.board_posts;

create policy "board_posts_select_published"
  on public.board_posts for select
  to anon, authenticated
  using (published = true);

-- 내려둔 글은 관리자와 작성자 본인만 본다.
drop policy if exists "board_posts_select_own_or_admin" on public.board_posts;

create policy "board_posts_select_own_or_admin"
  on public.board_posts for select
  to authenticated
  using (author_id = auth.uid() or public.is_admin_or_above());

-- 쓰기 — 공지/FAQ는 관리자만, QA는 로그인한 사람이 본인 이름으로.
--
-- author_id를 여기서 강제하는 이유: 이게 없으면 남의 uuid를 넣어 글을 쓸 수 있다.
drop policy if exists "board_posts_insert_permitted" on public.board_posts;

create policy "board_posts_insert_permitted"
  on public.board_posts for insert
  to authenticated
  with check (
    case
      when kind = 'qa' then author_id = auth.uid()
      else public.is_admin_or_above()
    end
  );

-- 수정 — 관리자는 전부, QA 작성자는 자기 글만. 단 답변이 달린 뒤에는 작성자가
-- 질문을 바꿀 수 없다(답변과 질문이 어긋난다).
drop policy if exists "board_posts_update_permitted" on public.board_posts;

create policy "board_posts_update_permitted"
  on public.board_posts for update
  to authenticated
  using (
    public.is_admin_or_above()
    or (kind = 'qa' and author_id = auth.uid() and answered_at is null)
  )
  with check (
    public.is_admin_or_above()
    or (kind = 'qa' and author_id = auth.uid() and answered_at is null)
  );

drop policy if exists "board_posts_delete_permitted" on public.board_posts;

create policy "board_posts_delete_permitted"
  on public.board_posts for delete
  to authenticated
  using (
    public.is_admin_or_above()
    or (kind = 'qa' and author_id = auth.uid())
  );

-- 이미지 — 글이 보이면 이미지도 보인다. 넣고 빼는 것은 관리자만.
drop policy if exists "board_post_images_select_public" on public.board_post_images;

create policy "board_post_images_select_public"
  on public.board_post_images for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.board_posts p
      where p.id = board_post_images.post_id and p.published = true
    )
  );

drop policy if exists "board_post_images_write_admin" on public.board_post_images;

create policy "board_post_images_write_admin"
  on public.board_post_images for all
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- ============================================================================
-- 6. GRANT
-- ============================================================================
--
-- 마이그레이션으로 만든 테이블에는 Supabase가 자동으로 권한을 주지 않는다. 이걸
-- 빠뜨리면 RLS 정책을 통과해도 "permission denied for table"이 난다(이 프로젝트에서
-- 이미 세 번 겪었다).

grant select on public.board_posts to anon, authenticated;
grant insert, update, delete on public.board_posts to authenticated;

grant select on public.board_post_images to anon, authenticated;
grant insert, update, delete on public.board_post_images to authenticated;

-- ============================================================================
-- 7. QA 답변 — RPC
-- ============================================================================
--
-- 답변은 세 칼럼(answer_body / answered_by / answered_at)이 함께 맞아야 한다.
-- 화면에서 update 세 개를 따로 보내면 중간에 끊겼을 때 "답변자는 있는데 답변이 없는"
-- 행이 남는다. 한 번에 처리하고, 답변자는 클라이언트 값이 아니라 auth.uid()로 박는다.

create or replace function public.admin_answer_question(
  target_post uuid,
  answer text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'permission denied: admin only'
      using errcode = 'insufficient_privilege';
  end if;

  update public.board_posts
  set answer_body = answer,
      answered_by = auth.uid(),
      answered_at = now(),
      updated_at = now()
  where id = target_post and kind = 'qa';

  if not found then
    raise exception 'question not found: %', target_post
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.admin_answer_question(uuid, text) is
  'QA 답변 등록/수정(관리자 전용). 답변자는 auth.uid()로 박는다 — 클라이언트가 보낸 값을 믿지 않는다.';

grant execute on function public.admin_answer_question(uuid, text) to authenticated;
