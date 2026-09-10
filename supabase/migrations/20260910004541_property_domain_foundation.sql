-- STEP 02: PROPERTY DOMAIN DATABASE FOUNDATION
-- Scope: public.locations + public.developers + public.owners + public.property_categories
--        + public.properties + public.property_images + public.property_documents
--        + enum 2종(property_status/property_category, database.md §0에 이미 설계돼
--          있었으나 이 저장소의 어떤 migration에도 아직 생성되지 않았음)
--        + PostGIS(geography)/pgvector(embedding) 확장 활성화
--        + properties.agency_id — STEP 1(20260901071931)에서 DESIGN GAP으로 보류됐던
--          컬럼을 이번 STEP에서 해소(그 마이그레이션 최하단 주석 및
--          DEVELOPMENT_MASTER_CHECKLIST.md "STEP 1 실행 결과" 참조)
--
-- 근거 문서: claude/database.md §2(Property Domain 설계 원문)
--            claude/decisions.md D6(property_locations EXCLUDE), D49(매물명/주소
--            자동번역 금지 불변 규칙 — 이번 STEP은 언어별 사본 컬럼을 만들지 않음
--            으로써 이 규칙을 스키마 레벨에서 반영)
--            claude/DEVELOPMENT_STORYBOARD.md STEP 02
--
-- 이전 마이그레이션: 20260828083711_profiles_and_user_roles.sql(STEP 4-3 — user_role/
-- language_code enum, profiles/user_roles, set_updated_at()/is_super_admin() 기존
-- 정의됨) · 20260901071931_property_agency_foundation.sql(STEP 1 — agency_* enum,
-- agencies/agency_members/agency_permissions/audit_logs, is_admin_or_above()/
-- is_agency_owner()/audit_log_admin_changes() 기존 정의됨). 이번 마이그레이션은 이
-- 객체들을 재정의하지 않고 재사용만 한다.
--
-- 범위 밖(이번 마이그레이션에 포함하지 않음): property_locations(D6 EXCLUDE 확정
-- 사항 — properties에 내장된 province_id/district_id/ward_id/latitude/longitude/geom
-- 구조로 충분), investment/notification/chat 등 다른 모든 도메인, "매물 등록 요청"
-- 플로우(owner 본인 제출 → reviewer 승인 — database.md §2 "향후" 항목, 세부 미설계),
-- Agency 온보딩 셀프서비스(D46 PENDING).

-- ============================================================================
-- 0. 확장(Extension) 활성화
--    Supabase 프로젝트는 기본적으로 두 확장을 제공한다 — 이 저장소의 마이그레이션
--    에서 명시적으로 요청한 적이 없어 이번에 처음 선언한다.
-- ============================================================================

create extension if not exists postgis with schema extensions;
create extension if not exists vector with schema extensions;

-- ============================================================================
-- 1. Enum 타입 (database.md §0 — property_status/property_category는 STEP 4-3/
--    STEP 1 어느 쪽에도 범위에 없어 이번에 처음 생성한다)
-- ============================================================================

create type public.property_status as enum (
  'draft',
  'pending_review',
  'active',
  'sold',
  'off_market',
  'archived'
);

create type public.property_category as enum (
  'apartment',
  'villa',
  'townhouse',
  'land',
  'office',
  'retail',
  'hotel',
  'industrial'
);

-- ============================================================================
-- 2. public.locations (database.md §2 "locations" 정의 포팅)
--    행정구역 마스터, self-referencing(province → district → ward).
-- ============================================================================

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.locations (id) on delete restrict,
  level text not null check (level in ('province', 'district', 'ward')),
  name text not null,
  name_en text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.locations is
  '행정구역 마스터(province/district/ward). self-referencing FK로 계층 표현 — 별도 property_locations 1:N 테이블은 D6(ACCEPTED)에 따라 이번 마이그레이션 대상에서 제외한다.';

create index locations_parent_id_idx on public.locations (parent_id);

create trigger locations_updated_at
  before update on public.locations
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- 3. public.developers / public.owners (database.md §2 정의 포팅)
--
-- [스키마 보강 메모] database.md §2 원문의 필드 목록에는 없지만, 바로 다음 줄
-- "RLS: Public-Read(활성 데이터만)"이 명시적으로 "활성 데이터만"을 조건으로 건다.
-- 이 조건을 실제로 판정할 컬럼이 원문 필드 목록에 없으면 그 RLS 문장 자체를
-- 구현할 수 없으므로, 이 gap을 메우기 위해 최소한의 `is_active boolean not null
-- default true` 컬럼을 추가했다(추측성 신규 기능이 아니라 이미 확정된 RLS 문장을
-- 만족시키기 위한 필수 보강 — property_categories/locations는 "활성 데이터만"
-- 조건이 원문에 없어 추가하지 않았다).
-- ============================================================================

create table public.developers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  logo_url text,
  contact jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.developers is
  '개발사 마스터. is_active는 database.md §2 "RLS: Public-Read(활성 데이터만)" 조건을 구현하기 위한 보강 컬럼(원문 필드 목록에는 없었음 — 이 파일 상단 메모 참조).';

create trigger developers_updated_at
  before update on public.developers
  for each row
  execute function public.set_updated_at();

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  logo_url text,
  contact jsonb,
  owner_type text not null check (owner_type in ('individual', 'company')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.owners is
  '매물 소유주 마스터(개인/법인). is_active는 developers와 동일한 이유로 추가(이 파일 상단 메모 참조).';

create trigger owners_updated_at
  before update on public.owners
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- 4. public.property_categories (database.md §2 정의 포팅)
--    property_category enum과 별도로 UI 표시용 다국어 라벨 메타가 필요할 때 사용.
-- ============================================================================

create table public.property_categories (
  id uuid primary key default gen_random_uuid(),
  code public.property_category not null unique,
  label_i18n jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.property_categories is
  'property_category enum 값별 다국어 UI 라벨 메타. code가 enum과 1:1이라 실제 카테고리 판정은 여전히 properties.category(enum)가 정본이다.';

create trigger property_categories_updated_at
  before update on public.property_categories
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- 5. public.properties (database.md §2 "properties" 정의 포팅 — 핵심 매물 테이블)
--
-- agency_id: STEP 1(20260901071931_property_agency_foundation.sql) 마이그레이션
-- 최하단 주석에 기록된 DESIGN GAP을 이번 STEP에서 해소한다 — 그때는 properties
-- 테이블 자체가 없어 ALTER 대상이 없었으나, 이제 CREATE TABLE 시점에 바로 포함한다.
--
-- D49(매물명/주소 자동번역 금지): title/address 모두 언어별 사본 컬럼을 두지 않고
-- 단일 원본 컬럼만 둔다 — i18n.md §3.4 규칙을 스키마 레벨에서 그대로 반영.
-- ============================================================================

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category public.property_category not null,
  price numeric(18, 2) not null,
  currency text not null default 'VND',
  area numeric(10, 2),
  land_area numeric(10, 2),
  building_area numeric(10, 2),
  year_built int,
  floors int,
  rental_income numeric(18, 2),
  rental_yield numeric(6, 3),
  occupancy_rate numeric(5, 2),
  address text,
  province_id uuid references public.locations (id) on delete set null,
  district_id uuid references public.locations (id) on delete set null,
  ward_id uuid references public.locations (id) on delete set null,
  latitude double precision,
  longitude double precision,
  geom extensions.geography(Point, 4326),
  owner_id uuid references public.owners (id) on delete set null,
  developer_id uuid references public.developers (id) on delete set null,
  agency_id uuid references public.agencies (id) on delete set null,
  status public.property_status not null default 'draft',
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.properties is
  '핵심 매물 테이블. title/address는 D49(불변 규칙)에 따라 언어별 번역 사본을 두지 않는다 — 앱 언어와 무관하게 항상 원본 그대로 노출(i18n.md §3.4). agency_id는 STEP 1의 DESIGN GAP을 이번 STEP에서 해소한 컬럼(nullable — 개인/직영 매물은 NULL).';

create index properties_status_category_idx on public.properties (status, category);
create index properties_price_idx on public.properties (price);
create index properties_rental_yield_idx on public.properties (rental_yield);
create index properties_agency_id_idx on public.properties (agency_id);
create index properties_geom_idx on public.properties using gist (geom);

create trigger properties_updated_at
  before update on public.properties
  for each row
  execute function public.set_updated_at();

-- properties_geom_sync: latitude/longitude 변경 시 geom(PostGIS geography)을
-- 자동 동기화한다(database.md §2 "트리거: properties_geom_sync" 그대로 구현).
-- 둘 중 하나라도 NULL이면 geom도 NULL로 맞춘다(반쪽 좌표로 잘못된 지점이 생기는
-- 것을 방지).
create or replace function public.properties_sync_geom()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.latitude is not null and new.longitude is not null then
    new.geom := extensions.ST_SetSRID(extensions.ST_MakePoint(new.longitude, new.latitude), 4326)::extensions.geography;
  else
    new.geom := null;
  end if;
  return new;
end;
$$;

create trigger properties_geom_sync
  before insert or update of latitude, longitude on public.properties
  for each row
  execute function public.properties_sync_geom();

-- ============================================================================
-- 6. public.property_images / public.property_documents
--    (database.md §2 정의 포팅)
-- ============================================================================

create table public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.property_images is
  '매물 이미지. RLS는 부모 properties 행과 동일한 가시성(Public-Read는 status=active인 매물의 이미지만).';

create index property_images_property_id_idx on public.property_images (property_id);

create table public.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  url text not null,
  sort_order int not null default 0,
  doc_type text,
  title text,
  created_at timestamptz not null default now()
);

comment on table public.property_documents is
  '매물 문서(등기부등본 등 — Private Storage + Signed URL 전제). database.md §2 "로그인 필요 시 Auth-Read로 더 제한 가능"에 따라 이번 STEP에서는 이미지보다 한 단계 더 좁혀 anon 비공개(Auth-Read)로 시작한다.';

create index property_documents_property_id_idx on public.property_documents (property_id);

-- ============================================================================
-- 7. 권한 검증 SECURITY DEFINER 헬퍼 함수
--
-- Agency가 직접 매물을 등록/관리하는 경로는 "agency_permissions.permission_type=
-- 'property_listing'이 enabled=true"이면서 "그 agency 자체도 승인됨(approved)"
-- 이어야 한다(STEP 1 마이그레이션 주석의 설계 의도 — RLS/Edge Function 양쪽
-- 이중 방어 중 RLS 쪽). 이 조건과 "현재 사용자가 그 agency의 활성 멤버인지"를
-- properties/property_images/property_documents 세 테이블의 정책에서 반복
-- 사용하므로 STEP03(is_admin_or_above)/STEP1(is_agency_owner)과 동일한 이유로
-- 함수화한다.
-- ============================================================================

create or replace function public.agency_has_active_permission(
  target_agency_id uuid,
  target_permission public.agency_permission_type
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agency_permissions p
    join public.agencies a on a.id = p.agency_id
    where p.agency_id = target_agency_id
      and p.permission_type = target_permission
      and p.enabled = true
      and a.approval_status = 'approved'
  );
$$;

revoke all on function public.agency_has_active_permission(uuid, public.agency_permission_type) from public;
grant execute on function public.agency_has_active_permission(uuid, public.agency_permission_type) to authenticated;

create or replace function public.is_active_agency_member(target_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agency_members m
    where m.agency_id = target_agency_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

revoke all on function public.is_active_agency_member(uuid) from public;
grant execute on function public.is_active_agency_member(uuid) to authenticated;

-- 매물 등록/수정 경로에서 "이 agency로 매물을 쓸 수 있는가"를 한 번에 판정하는
-- 조합 헬퍼 — properties/property_images/property_documents 세 테이블의 INSERT/
-- UPDATE 정책이 전부 동일 조건(활성 멤버 + property_listing 권한)을 반복하므로
-- 여기서 하나로 묶는다.
create or replace function public.can_manage_agency_property(target_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_agency_id is not null
    and public.is_active_agency_member(target_agency_id)
    and public.agency_has_active_permission(target_agency_id, 'property_listing');
$$;

revoke all on function public.can_manage_agency_property(uuid) from public;
grant execute on function public.can_manage_agency_property(uuid) to authenticated;

-- reviewer 판정 — database.md §2 "그 외 status는 소유 admin/reviewer만" 문장의
-- "reviewer"를 판정하기 위한 헬퍼. is_admin_or_above()(admin/super_admin)와는
-- 별도 role이라 새로 정의한다(security.md §1.1 role 정의 기준).
create or replace function public.is_reviewer_or_above()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role in ('reviewer', 'admin', 'super_admin')
  );
$$;

revoke all on function public.is_reviewer_or_above() from public;
grant execute on function public.is_reviewer_or_above() to authenticated;

-- ============================================================================
-- 8. RLS — deny-by-default (security.md §2)
-- ============================================================================

alter table public.locations enable row level security;
alter table public.developers enable row level security;
alter table public.owners enable row level security;
alter table public.property_categories enable row level security;
alter table public.properties enable row level security;
alter table public.property_images enable row level security;
alter table public.property_documents enable row level security;

-- --- locations: Public-Read, Admin-Write (database.md §2 그대로) -------------

create policy "locations_select_public"
  on public.locations
  for select
  to anon, authenticated
  using ( true );

create policy "locations_insert_admin"
  on public.locations
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "locations_update_admin"
  on public.locations
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "locations_delete_admin"
  on public.locations
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

-- --- developers / owners: Public-Read(활성만), Admin-Write -------------------

create policy "developers_select_active_public"
  on public.developers
  for select
  to anon, authenticated
  using ( is_active = true );

create policy "developers_select_admin"
  on public.developers
  for select
  to authenticated
  using ( public.is_admin_or_above() );

create policy "developers_insert_admin"
  on public.developers
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "developers_update_admin"
  on public.developers
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "developers_delete_admin"
  on public.developers
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

create policy "owners_select_active_public"
  on public.owners
  for select
  to anon, authenticated
  using ( is_active = true );

create policy "owners_select_admin"
  on public.owners
  for select
  to authenticated
  using ( public.is_admin_or_above() );

create policy "owners_insert_admin"
  on public.owners
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "owners_update_admin"
  on public.owners
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "owners_delete_admin"
  on public.owners
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

-- --- property_categories: Public-Read, Admin-Write ---------------------------

create policy "property_categories_select_public"
  on public.property_categories
  for select
  to anon, authenticated
  using ( true );

create policy "property_categories_insert_admin"
  on public.property_categories
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "property_categories_update_admin"
  on public.property_categories
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "property_categories_delete_admin"
  on public.property_categories
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

-- --- properties ---------------------------------------------------------------
-- database.md §2: "Public-Read(status='active'인 행만), 그 외 status는 소유
-- admin/reviewer만. INSERT/UPDATE는 Admin-Write + agency_permissions.
-- permission_type='property_listing' enabled=true인 Agency".
-- "소유"는 자기 agency 소속 매물을 그 agency 멤버가 볼 수 있어야 한다는 뜻으로
-- 해석했다(관리 화면 없이는 자기가 등록한 draft 매물조차 볼 수 없는 것은
-- 실사용 불가능한 설계이므로) — 개인/직영(agency_id NULL) 매물의 draft는
-- admin/reviewer만 본다.

create policy "properties_select_active_public"
  on public.properties
  for select
  to anon, authenticated
  using ( status = 'active' );

create policy "properties_select_reviewer_or_above"
  on public.properties
  for select
  to authenticated
  using ( public.is_reviewer_or_above() );

create policy "properties_select_own_agency"
  on public.properties
  for select
  to authenticated
  using ( agency_id is not null and public.is_active_agency_member(agency_id) );

create policy "properties_insert_admin"
  on public.properties
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "properties_insert_agency"
  on public.properties
  for insert
  to authenticated
  with check ( public.can_manage_agency_property(agency_id) );

create policy "properties_update_admin"
  on public.properties
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "properties_update_agency"
  on public.properties
  for update
  to authenticated
  using ( public.can_manage_agency_property(agency_id) )
  with check ( public.can_manage_agency_property(agency_id) );

-- DELETE policy 없음(deny) — status='archived'/'off_market'로 표현, 물리 삭제 안 함
-- (agencies와 동일한 관례 — STEP 1 마이그레이션 참조).

-- --- property_images ------------------------------------------------------
-- 부모 properties의 가시성 규칙을 그대로 따른다(database.md §2 "property가
-- Public-Read 대상이면 이미지도 Public-Read").

create policy "property_images_select_active_public"
  on public.property_images
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_images.property_id
        and p.status = 'active'
    )
  );

create policy "property_images_select_reviewer_or_above"
  on public.property_images
  for select
  to authenticated
  using ( public.is_reviewer_or_above() );

create policy "property_images_select_own_agency"
  on public.property_images
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_images.property_id
        and p.agency_id is not null
        and public.is_active_agency_member(p.agency_id)
    )
  );

create policy "property_images_insert_admin"
  on public.property_images
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "property_images_insert_agency"
  on public.property_images
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_images.property_id
        and public.can_manage_agency_property(p.agency_id)
    )
  );

create policy "property_images_update_admin"
  on public.property_images
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "property_images_delete_admin"
  on public.property_images
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

create policy "property_images_delete_agency"
  on public.property_images
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_images.property_id
        and public.can_manage_agency_property(p.agency_id)
    )
  );

-- --- property_documents ----------------------------------------------------
-- database.md §2 "문서는 로그인 필요 시 Auth-Read로 더 제한 가능" — anon에게는
-- 노출하지 않고 로그인 사용자 전체까지만 연다(등기부등본 등 민감도를 고려한
-- 보수적 시작값 — 세분화는 security.md에서 후속 결정, 이 파일 상단 comment 참조).

create policy "property_documents_select_active_auth"
  on public.property_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_documents.property_id
        and p.status = 'active'
    )
  );

create policy "property_documents_select_reviewer_or_above"
  on public.property_documents
  for select
  to authenticated
  using ( public.is_reviewer_or_above() );

create policy "property_documents_select_own_agency"
  on public.property_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_documents.property_id
        and p.agency_id is not null
        and public.is_active_agency_member(p.agency_id)
    )
  );

create policy "property_documents_insert_admin"
  on public.property_documents
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "property_documents_insert_agency"
  on public.property_documents
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_documents.property_id
        and public.can_manage_agency_property(p.agency_id)
    )
  );

create policy "property_documents_update_admin"
  on public.property_documents
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "property_documents_delete_admin"
  on public.property_documents
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

create policy "property_documents_delete_agency"
  on public.property_documents
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_documents.property_id
        and public.can_manage_agency_property(p.agency_id)
    )
  );
