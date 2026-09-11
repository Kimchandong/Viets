-- [2026-09-11 사용자 지시] 부동산 등록신청 + 관리자 승인 (1단계).
--
-- 흐름:
--   로그인 → MY > 부동산 등록신청 → 폼 제출 → agencies(pending) + 본인이 owner 멤버
--   → 관리자 승인 → approval_status='approved' + agency_permissions.property_listing 활성
--   → 신청자의 MY에 매물 등록/매물 정보 메뉴가 뜨고, 상단에 업체명이 보인다.
--
-- 왜 새 테이블을 만들지 않는가:
-- 20260901071931_property_agency_foundation.sql의 agencies/agency_members/
-- agency_permissions가 이미 이 모델 그대로다 — 업체명(name), 승인 상태
-- (approval_status: pending/approved/rejected/suspended), 중개번호
-- (business_registration_no), 승인자·승인시각(approved_by/approved_at), 소속 멤버와
-- 역할(owner/staff), 기능 권한(property_listing/chat/...). 폼에만 있고 테이블에 없던
-- 항목(지역·담당자명·전화번호·주소·첨부·반려사유)을 컬럼으로 채워 넣는다.
--
-- 결제/잔액(QR 입금, 사용잔액/현잔액)은 2단계로 미룬다(사용자 결정).
--
-- 이전 마이그레이션: 20260911132249_fix_created_by_backfill.sql

-- ============================================================================
-- 1. agencies 컬럼 보강
-- ============================================================================

-- [재실행 안전] 이 마이그레이션은 한 번 실패한 뒤 다시 돌 수 있어야 한다 —
-- agencies_approval_status_idx가 foundation 마이그레이션에 이미 있어서 처음 push가
-- 중간에 멈췄다. 아래 전부 "있으면 건너뛴다" 형태로 쓴다.
alter table public.agencies
  add column if not exists region text,
  add column if not exists contact_name text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists license_file_path text,
  add column if not exists rejection_reason text;

comment on column public.agencies.region is
  '업체 소재 지역. 매물 지역 필터(constants/mockData.ts MOCK_REGIONS)와 같은 값을 쓴다 — locations 테이블은 아직 비어 있어(seed 없음) FK 대신 텍스트로 둔다. 목록이 바뀌면 두 곳이 같이 움직여야 한다.';

comment on column public.agencies.contact_name is '담당자 이름(업체명과 다를 수 있다).';
comment on column public.agencies.phone is '담당자 연락처.';
comment on column public.agencies.address is '업체 주소.';

comment on column public.agencies.license_file_path is
  '부동산중개번호 증빙 파일의 storage 경로(비공개 버킷 agency-documents). 공개 URL이 아니라 경로만 저장한다 — 열람은 서명 URL로만 가능하고, 신청 본인과 관리자에게만 허용된다. 중개번호가 없는 신청은 NULL.';

comment on column public.agencies.rejection_reason is
  '반려 사유. 신청자에게 그대로 보여 준다 — 무엇을 고쳐 다시 내야 하는지 알려주지 않으면 같은 신청이 반복된다.';

-- 관리자 승인 화면이 pending을 먼저 훑으므로 상태 인덱스를 둔다.
create index if not exists agencies_approval_status_idx on public.agencies (approval_status);

-- ============================================================================
-- 2. 중개번호 증빙 파일 — 비공개 버킷
-- ============================================================================
--
-- 매물 사진 버킷(property-images)과 달리 공개하지 않는다. 사업자 서류는 URL만 알면
-- 누구나 열리는 곳에 두면 안 된다.

insert into storage.buckets (id, name, public)
values ('agency-documents', 'agency-documents', false)
on conflict (id) do nothing;

-- 경로 규칙: `<신청자 uuid>/<파일명>`. 첫 번째 폴더 이름이 본인 uuid여야 올릴 수 있다
-- (storage.foldername(name)[1]이 그 값이다) — 남의 폴더에 쓰거나 읽을 수 없다.

drop policy if exists "agency_documents_insert_own" on storage.objects;

create policy "agency_documents_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'agency-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "agency_documents_select_own" on storage.objects;

create policy "agency_documents_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'agency-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "agency_documents_select_admin" on storage.objects;

create policy "agency_documents_select_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'agency-documents'
    and public.is_admin_or_above()
  );

-- 신청자가 제출 전에 잘못 올린 파일을 지울 수 있어야 한다(제출 후에도 본인 파일이다).
drop policy if exists "agency_documents_delete_own" on storage.objects;

create policy "agency_documents_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'agency-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 3. 신청 접수 — RPC
-- ============================================================================
--
-- 왜 INSERT 정책이 아니라 함수인가:
--   · agencies와 agency_members를 **함께** 만들어야 한다. 정책 두 개로 나누면 앞은
--     성공하고 뒤가 실패해 주인 없는 신청이 남을 수 있다.
--   · "이 사용자가 이미 신청했는가"를 agency_members 정책 안에서 확인하려면 그 정책이
--     자기 테이블을 다시 조회해야 해서 RLS 재귀에 걸린다(STEP03에서 겪은 문제).
--   · approval_status를 클라이언트가 'approved'로 넣는 길을 아예 막는다 — 함수가
--     'pending'을 직접 쓴다.

create or replace function public.submit_agency_application(
  p_name text,
  p_region text,
  p_contact_name text,
  p_phone text,
  p_address text,
  p_registration_no text default null,
  p_license_file_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'name-required';
  end if;

  -- 심사 중이거나 이미 승인된 신청이 있으면 또 내지 못한다. 반려(rejected)와
  -- 정지(suspended)는 막지 않는다 — 고쳐서 다시 낼 수 있어야 한다.
  if exists (
    select 1
    from public.agency_members m
    join public.agencies a on a.id = m.agency_id
    where m.user_id = auth.uid()
      and m.status = 'active'
      and a.approval_status in ('pending', 'approved')
  ) then
    raise exception 'already-applied';
  end if;

  insert into public.agencies (
    name, region, contact_name, phone, address,
    business_registration_no, license_file_path, approval_status
  )
  values (
    btrim(p_name),
    nullif(btrim(coalesce(p_region, '')), ''),
    nullif(btrim(coalesce(p_contact_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_registration_no, '')), ''),
    nullif(btrim(coalesce(p_license_file_path, '')), ''),
    'pending'
  )
  returning id into v_agency_id;

  insert into public.agency_members (agency_id, user_id, role_in_agency, status)
  values (v_agency_id, auth.uid(), 'owner', 'active');

  return v_agency_id;
end;
$$;

revoke all on function public.submit_agency_application(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_agency_application(text, text, text, text, text, text, text) to authenticated;

comment on function public.submit_agency_application(text, text, text, text, text, text, text) is
  '부동산 등록신청 접수 — agencies(pending) 1건과 신청자 owner 멤버 1건을 함께 만든다. 심사 중/승인된 신청이 이미 있으면 already-applied 예외.';

-- ============================================================================
-- 4. 승인·반려 — RPC
-- ============================================================================
--
-- 승인은 상태만 바꾸는 일이 아니다: agency_permissions에 property_listing을 켜 줘야
-- 실제로 매물을 등록할 수 있다(can_manage_agency_property가 그 값을 본다). 두 가지를
-- 따로 하면 "승인됐는데 등록이 안 되는" 상태가 생기므로 한 함수에 묶는다.
--
-- 함께 켜는 권한:
--   property_listing — 매물 등록/수정
--   chat            — 고객 상담 응대(매물을 올리면 문의가 들어온다)
--   account_active  — 계정 활성
-- 결제(입금 확인)와 연동한 차단은 2단계에서 account_active를 끄는 방식으로 붙인다.

create or replace function public.admin_review_agency(
  target_agency uuid,
  approve boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'forbidden';
  end if;

  if approve then
    update public.agencies
    set approval_status = 'approved',
        approved_by = auth.uid(),
        approved_at = now(),
        rejection_reason = null
    where id = target_agency;

    insert into public.agency_permissions (agency_id, permission_type, enabled, updated_by, updated_at)
    select target_agency, p, true, auth.uid(), now()
    from unnest(array['property_listing', 'chat', 'account_active']::public.agency_permission_type[]) as p
    on conflict (agency_id, permission_type)
    do update set enabled = true, updated_by = auth.uid(), updated_at = now();
  else
    update public.agencies
    set approval_status = 'rejected',
        rejection_reason = nullif(btrim(coalesce(reason, '')), ''),
        approved_by = null,
        approved_at = null
    where id = target_agency;

    -- 반려하면 이전에 켜 둔 권한도 함께 내린다(재심사 중 등록이 계속되면 안 된다).
    update public.agency_permissions
    set enabled = false, updated_by = auth.uid(), updated_at = now()
    where agency_id = target_agency;
  end if;
end;
$$;

revoke all on function public.admin_review_agency(uuid, boolean, text) from public;
grant execute on function public.admin_review_agency(uuid, boolean, text) to authenticated;

comment on function public.admin_review_agency(uuid, boolean, text) is
  '관리자 전용 등록신청 심사. 승인 시 approval_status를 approved로 바꾸고 property_listing/chat/account_active 권한을 함께 켠다. 반려 시 사유를 남기고 해당 Agency의 권한을 모두 끈다.';

-- ============================================================================
-- 5. 승인된 Agency도 매물 사진을 올릴 수 있어야 한다
-- ============================================================================
--
-- 빠져 있던 곳: 20260911110718_storage_property_images_permitted.sql이 만든 Storage
-- 정책은 `has_user_permission('property_manage')`만 본다. 그 권한은 관리자가 계정별로
-- 켜 주는 값이라, 이번 흐름으로 승인된 중개업소 계정에는 없다 — 매물은 등록되는데
-- 사진 업로드만 권한 오류로 실패한다(테이블 쪽 property_images_insert_agency 정책은
-- 이미 있어서 DB 행은 들어간다. Storage만 막히는 어긋남이다).
--
-- 세 갈래(관리자 / property_manage / 승인된 Agency 소속)를 한 함수로 모아, Storage
-- 정책을 그 함수 하나로 건다.

create or replace function public.can_manage_any_property()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_or_above()
    or public.has_user_permission('property_manage')
    or exists (
      select 1
      from public.agency_members m
      where m.user_id = auth.uid()
        and m.status = 'active'
        and public.agency_has_active_permission(m.agency_id, 'property_listing')
    );
$$;

revoke all on function public.can_manage_any_property() from public;
grant execute on function public.can_manage_any_property() to authenticated;

comment on function public.can_manage_any_property() is
  '이 계정이 매물을 등록·관리할 수 있는지(어떤 매물인지는 보지 않는다) — 관리자이거나, property_manage 권한이 있거나, property_listing이 켜진 승인 Agency의 활성 멤버. 매물 사진 Storage 정책처럼 "대상 매물을 특정할 수 없는 자리"에서 쓴다.';

drop policy if exists "property_images_manager_insert" on storage.objects;

create policy "property_images_manager_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'property-images' and public.can_manage_any_property());

drop policy if exists "property_images_manager_update" on storage.objects;

create policy "property_images_manager_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'property-images' and public.can_manage_any_property())
  with check (bucket_id = 'property-images' and public.can_manage_any_property());

drop policy if exists "property_images_manager_delete" on storage.objects;

create policy "property_images_manager_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'property-images' and public.can_manage_any_property());

-- ============================================================================
-- 6. 내 Agency id — 매물 등록 시 agency_id를 채우기 위한 조회
-- ============================================================================
--
-- properties.agency_id가 비어 있으면 properties_insert_agency / update_agency /
-- property_images_*_agency 정책이 전부 걸리지 않는다(can_manage_agency_property는
-- agency_id가 NULL이면 false). 승인된 Agency 계정이 매물을 올릴 때 이 값을 채워야 한다.

create or replace function public.my_active_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.agency_id
  from public.agency_members m
  where m.user_id = auth.uid()
    and m.status = 'active'
    and public.agency_has_active_permission(m.agency_id, 'property_listing')
  order by m.created_at desc
  limit 1;
$$;

revoke all on function public.my_active_agency_id() from public;
grant execute on function public.my_active_agency_id() to authenticated;

comment on function public.my_active_agency_id() is
  '매물을 등록할 때 properties.agency_id에 넣을 값 — 내가 활성 멤버이고 property_listing이 켜진 승인 Agency. 없으면 NULL(관리자/개별 property_manage 계정은 Agency 없이 등록한다).';
