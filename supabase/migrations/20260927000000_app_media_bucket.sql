-- ============================================================================
-- [2026-09-26 사용자 지시] 홈 배경영상을 Supabase Storage에 올린다
--
-- 왜 앱 번들이 아니라 Storage인가: 지금 배경영상은 assets/videos/home/에 들어 있는
-- 번들 파일이라, 영상을 바꾸려면 **앱을 새로 빌드해서 스토어에 다시 올려야 한다.**
-- Storage에 두면 파일만 교체하면 다음 실행부터 새 영상이 나온다.
--
-- 공개(public) 버킷인 이유: 배경영상은 로그인하지 않은 사용자도 보는 화면의 일부다.
-- 비공개로 두면 홈 화면을 그릴 때마다 서명 URL을 새로 발급해야 하는데, 그러면
-- 로그인 전에는 영상이 안 나온다(avatars/board-images와 같은 판단).
--
-- 경로 규칙: 이 버킷은 "앱이 쓰는 공용 미디어"다. 사용자 업로드물이 아니므로
-- 관리자만 쓸 수 있다. 홈 배경영상은 home/hero.mp4 한 자리를 고정으로 쓴다 —
-- 파일명을 고정해야 앱 코드를 고치지 않고 영상만 갈아 끼울 수 있다.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('app-media', 'app-media', true)
on conflict (id) do nothing;

-- 읽기 — **정책을 만들지 않는다.**
--
-- [2026-09-26 수정] 처음에는 avatars 버킷의 패턴을 그대로 베껴 SELECT 정책을 넣었다.
-- 틀렸다. 공개(public) 버킷은 /storage/v1/object/public/... 경로를 **정책 없이도**
-- 그대로 내려 준다. SELECT 정책이 추가로 주는 것은 "버킷 안 파일 목록 조회" 권한뿐이라,
-- 넣어 두면 누구나 이 버킷의 파일 목록을 훑을 수 있다(Supabase도 경고를 띄웠다).
--
-- 운영 DB에서는 이 정책을 이미 수동으로 삭제했고, 삭제 후에도 배경영상 URL이 200으로
-- 정상 응답하는 것을 확인했다. 이 파일도 그 상태에 맞춘다 — 안 그러면 db push가
-- 지운 정책을 되살린다.
drop policy if exists "app_media_read_public" on storage.objects;

-- 쓰기/교체/삭제 — 관리자만. 사용자가 올리는 곳이 아니라 앱의 구성요소를 두는 곳이라
-- 일반 사용자에게 열어 두면 홈 화면 배경을 아무나 바꿀 수 있게 된다.
drop policy if exists "app_media_insert_admin" on storage.objects;

create policy "app_media_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'app-media' and public.is_admin_or_above());

drop policy if exists "app_media_update_admin" on storage.objects;

create policy "app_media_update_admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'app-media' and public.is_admin_or_above());

drop policy if exists "app_media_delete_admin" on storage.objects;

create policy "app_media_delete_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'app-media' and public.is_admin_or_above());

-- ----------------------------------------------------------------------------
-- 확인
-- ----------------------------------------------------------------------------
-- 버킷이 생겼는지:
--   select id, public from storage.buckets where id = 'app-media';
--
-- 정책 4개가 붙었는지:
--   select polname from pg_policy
--   where polrelid = 'storage.objects'::regclass and polname like 'app_media%';
--
-- 파일을 올린 뒤 공개 URL이 열리는지(브라우저 주소창에 붙여넣기):
--   https://nbfmodrxnduaxcpxgqpj.supabase.co/storage/v1/object/public/app-media/home/hero.mp4
