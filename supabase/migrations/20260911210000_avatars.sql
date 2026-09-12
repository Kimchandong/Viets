-- ============================================================================
-- [2026-09-11 사용자 지시] MY 화면 프로필 사진 업로드
--
-- 저장 위치는 이미 있는 public.profiles.avatar_url(20260828083711)을 그대로 쓴다.
-- 컬럼도, 정책도 추가하지 않는다 — profiles는 이미 본인 행만 select/update할 수
-- 있게 되어 있다(profiles_select_own / profiles_update_own).
--
-- 여기서 만드는 것은 이미지 파일이 들어갈 버킷 하나와 그 접근 정책뿐이다.
-- ============================================================================

-- 공개 버킷인 이유: 아바타는 채팅 상대/매물 등록자 표시 등 "남이 보는" 이미지라
-- 서명 URL을 쓰면 목록을 그릴 때마다 URL을 새로 발급해야 한다(board-images와 동일한 판단).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 읽기 — 비로그인 사용자에게도 보인다.
drop policy if exists "avatars_read_public" on storage.objects;

create policy "avatars_read_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- 쓰기 — 자기 폴더(<uid>/...)에만. 경로 첫 칸을 uid로 강제해야 남의 아바타를
-- 덮어쓰지 못한다. storage.foldername()은 경로를 '/'로 쪼갠 배열을 돌려준다.
drop policy if exists "avatars_insert_own" on storage.objects;

create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
