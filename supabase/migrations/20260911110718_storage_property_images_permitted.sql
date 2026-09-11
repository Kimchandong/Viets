-- STEP 04-사진권한 — property-images 버킷 업로드 권한을 테이블 정책과 일치시킨다.
--
-- 증상(2026-09-11 QA): `property_manage` 권한을 가진 계정(admin 아님)이 매물을
-- 등록하면 **매물 행은 만들어지는데 사진 업로드만 실패**했다.
--
-- 원인: 권한이 두 군데에 따로 있고 기준이 달랐다.
--   - 테이블(public.property_images): 20260910073106에서 `property_manage` 보유자에게
--     INSERT/DELETE를 허용했다.
--   - Storage(storage.objects): Dashboard에서 만든 `property_images_admin_insert`가
--     `is_admin_or_above()`만 허용한다.
-- 즉 사진 파일을 Storage에 올리는 단계에서 먼저 거부되고, 화면은 "사진 업로드 실패"로
-- 끝난다(app/property-register.tsx는 업로드가 실패하면 매물을 만들지 않고 멈춘다).
--
-- 이 파일은 기존 admin 정책을 **지우지 않고** 조건이 다른 정책을 추가한다. Postgres의
-- RLS 정책은 같은 동작(command)에 여러 개가 있으면 OR로 결합되므로, admin은 기존
-- 정책으로, 권한 보유자는 새 정책으로 각각 통과한다. 기존 동작은 그대로 유지된다.
--
-- Agency 소속 계정(agency_permissions.property_listing)은 이번 범위에 넣지 않았다:
-- 업로드 시점의 파일 경로(`uploads/<timestamp>-<random>.<ext>`)에는 아직 어떤 매물의
-- 사진인지 정보가 없어 업체 단위로 좁힐 근거가 없다. Agency 온보딩(D46)이 정해지는
-- STEP 03에서 경로 규칙과 함께 다시 설계한다.
--
-- 참고: storage.objects의 정책도 지금까지 Dashboard에서만 만들어져 migration 밖에
-- 있었다. 이 파일이 그 첫 편입분이다 — 기존 4개 정책(admin insert/update/delete,
-- public read)은 이미 원격에 존재하므로 여기서 다시 만들지 않는다.

do $$
begin
  -- 업로드
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'property_images_permitted_insert'
  ) then
    create policy "property_images_permitted_insert"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'property-images'
        and public.has_user_permission('property_manage')
      );
  end if;

  -- 덮어쓰기(같은 경로 재업로드 등)
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'property_images_permitted_update'
  ) then
    create policy "property_images_permitted_update"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'property-images'
        and public.has_user_permission('property_manage')
      )
      with check (
        bucket_id = 'property-images'
        and public.has_user_permission('property_manage')
      );
  end if;

  -- 사진 개별 삭제(2026-09-11 기능) 시 Storage 파일 정리에 필요하다.
  -- 이게 없으면 DB 행만 지워지고 파일이 남는다(services/properties.ts는 Storage
  -- 삭제 실패를 경고만 남기고 넘어가므로 사용자에게는 성공으로 보인다).
  if not exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'property_images_permitted_delete'
  ) then
    create policy "property_images_permitted_delete"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'property-images'
        and public.has_user_permission('property_manage')
      );
  end if;
end $$;
