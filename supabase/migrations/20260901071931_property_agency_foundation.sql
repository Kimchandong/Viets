-- STEP 1: PROPERTY / AGENCY DATABASE FOUNDATION
-- Scope: public.agencies + public.agency_members + public.agency_permissions
--        + public.audit_logs (Agency 권한 변경의 감사 대상, 최초 도입)
--        + 관련 enum 3종 + RLS + updated_at/audit 트리거
--
-- 근거 문서: claude/database.md §0(enum), §1(investors 주석의 user_roles와의 구분 언급),
--            §9(audit_logs), §12(Agency Domain — agencies/agency_members/agency_permissions)
--            claude/decisions.md D39(Agency 승인/권한 분리), D40(User/Agency Member/Investor
--            독립 관계 모델)
--            claude/security.md §1.2(RBAC 이중검증 패턴), §2(RLS 방향), §3(Audit Logging)
--
-- 이전 마이그레이션: 20260828083711_profiles_and_user_roles.sql (STEP 4-3, Auth Foundation
-- — public.profiles/public.user_roles/public.user_role enum/public.language_code enum/
-- public.set_updated_at()/public.handle_new_user()/public.is_super_admin() 기존 정의됨.
-- 이번 마이그레이션은 이 객체들을 재정의하지 않고 재사용만 한다).
--
-- 범위 밖(이번 마이그레이션에 포함하지 않음): properties 테이블 자체, investment/
-- notification/chat 등 다른 모든 도메인 — STEP 1은 "Property/Agency DB" 중 Agency
-- 도메인 신설 + Agency 연동을 위한 준비만 다룬다. properties.agency_id 관련 중요
-- 참고사항은 이 파일 최하단 주석 및 STEP 1 최종 보고서의 [DESIGN GAP] 섹션 참조 —
-- properties 테이블 자체가 아직 어떤 migration으로도 생성된 적이 없어(이 저장소의
-- migrations/ 폴더에는 STEP 4-3 하나만 존재) 이번 STEP에서 ALTER TABLE로 컬럼을
-- 추가할 대상이 존재하지 않는다. 존재하지 않는 테이블을 이번에 함께 설계/생성하는
-- 것은 STEP 1의 명시적 범위("Property/Agency DB" 중 Agency 신규 도입과 Agency 연동
-- 준비)를 넘어서는 임의 확장이 될 수 있어, 여기서는 만들지 않고 gap으로 보고한다.

-- ============================================================================
-- 1. Enum 타입 (database.md §0에서 이번 STEP에 필요한 3개만 선행 생성)
--    나머지 신규 enum(investment_notification_type 등)은 해당 도메인 마이그레이션
--    에서 생성한다(out-of-scope 원칙 — STEP03 auth 마이그레이션과 동일한 관례).
-- ============================================================================

create type public.agency_approval_status as enum (
  'pending',
  'approved',
  'rejected',
  'suspended'
);

create type public.agency_permission_type as enum (
  'property_listing',
  'post_writing',
  'chat',
  'account_active'
);

create type public.agency_member_role as enum (
  'owner',
  'staff'
);

-- ============================================================================
-- 2. public.agencies (database.md §12 "agencies" 정의 포팅)
-- ============================================================================

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  approval_status public.agency_approval_status not null default 'pending',
  business_registration_no text,
  contact jsonb,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.agencies is
  'Agency(중개업소) 전역 승인 상태. 기능별 세부 권한은 agency_permissions에서 별도 관리 — 하나의 필드로 통합하지 않는다(DECISIONS.md D39).';

create index agencies_approval_status_idx on public.agencies (approval_status);

create trigger agencies_updated_at
  before update on public.agencies
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- 3. public.agency_members (database.md §12 "agency_members" 정의 포팅)
--
-- 주의: user_roles(내부 운영 RBAC)와 완전히 다른 축이다 — 혼동 금지
-- (DECISIONS.md D40, DATABASE.md §1 "주의" 참조).
-- ============================================================================

create table public.agency_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role_in_agency public.agency_member_role not null default 'staff',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (agency_id, user_id)
);

comment on table public.agency_members is
  'Agency 소속 사용자(직원/대표) 관계. 소속 해제는 status로 관리(이력 보존, row 삭제하지 않음).';

create index agency_members_user_id_idx on public.agency_members (user_id);
-- agency_id는 위 unique(agency_id, user_id) 제약의 선두 컬럼이라 별도 인덱스 불필요.

-- ============================================================================
-- 4. public.agency_permissions (database.md §12 "agency_permissions" 정의 포팅
--    — EAV 구조, DECISIONS.md D39 ACCEPTED)
-- ============================================================================

create table public.agency_permissions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  permission_type public.agency_permission_type not null,
  enabled boolean not null default false,
  scope text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, permission_type)
);

comment on table public.agency_permissions is
  'Agency 기능별 개별 토글(EAV). agencies.approval_status가 approved여도 여기서 enabled=false이면 그 기능은 사용 불가 — 승인과 권한은 AND 조건(DECISIONS.md D39). 모든 변경은 audit_logs 대상.';

-- agency_id는 위 unique(agency_id, permission_type)의 선두 컬럼이라 별도 인덱스 불필요.

create trigger agency_permissions_updated_at
  before update on public.agency_permissions
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- 5. public.audit_logs (database.md §9 정의 포팅 — 이 저장소 최초 도입)
--
-- 이 프로젝트에 기존 audit 시스템이 전혀 없었다(STEP 4-3 마이그레이션에도 없음).
-- "이미 있으면 재사용, 없으면 경쟁 아키텍처를 새로 만들지 말고 gap을 문서화하라"는
-- 지시에 따라 검토했으나, audit_logs는 이미 DATABASE.md §9에 설계가 확정되어 있고
-- 이번 STEP의 명시 요구사항("Agency permission changes must be auditable")의 직접
-- 전제조건이므로, 새 경쟁 아키텍처를 발명하는 것이 아니라 이미 승인된 설계를 그대로
-- 구현하는 것으로 판단해 여기서 함께 생성한다. properties/investment_products 등
-- 다른 관리 테이블용 audit 연동은 해당 테이블이 아직 존재하지 않으므로 이번 STEP
-- 에서는 다루지 않는다(범위 밖).
-- ============================================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  before jsonb,
  after jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  '관리자 행위 감사 로그(원칙 20). immutable — UPDATE/DELETE 정책을 만들지 않는다. ip_address는 DB 트리거 레벨에서는 알 수 없어 NULL로 남고, 필요 시 Edge Function이 별도 경로로 보강 기록한다(security.md §3).';

create index audit_logs_target_idx on public.audit_logs (target_table, target_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at);

-- ============================================================================
-- 6. 권한 검증 SECURITY DEFINER 헬퍼 함수
--
-- is_admin_or_above(): agencies/agency_permissions/agency_members에 대한 Admin-Write
-- 판정에 반복 사용되므로 STEP03(is_super_admin())과 동일한 이유(재사용성, search_path
-- 하이재킹 방지)로 함수화한다. 이 테이블들은 user_roles 자신이 아니므로 STEP03에서
-- 발견된 self-reference 재귀 문제는 발생하지 않지만(다른 테이블을 조회), 동일한
-- 방어적 관례(SECURITY DEFINER + 고정 search_path + 최소 권한 GRANT)를 일관되게
-- 적용한다. role 범위는 security.md §1.1의 "admin: ... Push 캠페인, Market/Exchange
-- 관리" 수준과 동등한 민감도로 판단해 admin + super_admin으로 정했다(editor/reviewer/
-- operator는 제외 — Agency 승인/권한은 콘텐츠 편집이 아닌 사업적으로 민감한 관리 행위).
-- ============================================================================

create or replace function public.is_admin_or_above()
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
      and role in ('admin', 'super_admin')
  );
$$;

revoke all on function public.is_admin_or_above() from public;
grant execute on function public.is_admin_or_above() to authenticated;

-- is_agency_owner(): agency_members 자신에 대한 SELECT 정책이 "같은 agency의 owner는
-- 전체 멤버를 볼 수 있다"를 지원하려면 agency_members를 다시 조회해야 한다 — 이는
-- STEP03에서 문서화된 것과 동일한 self-reference 패턴(정책이 자기 테이블을 참조)이므로
-- 같은 해법(SECURITY DEFINER 헬퍼로 조회를 분리)을 그대로 적용한다.
create or replace function public.is_agency_owner(target_agency_id uuid)
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
      and m.role_in_agency = 'owner'
      and m.status = 'active'
  );
$$;

revoke all on function public.is_agency_owner(uuid) from public;
grant execute on function public.is_agency_owner(uuid) to authenticated;

-- ============================================================================
-- 7. audit_log_admin_changes() — 공용 감사 트리거 함수
--
-- SECURITY DEFINER 필요: 이 함수를 실행하는 실제 세션은 admin/super_admin
-- role의 authenticated 사용자이며, audit_logs에는 클라이언트 role용 INSERT
-- policy를 만들지 않는다(Server-Only, §9 아래 RLS 참조) — 트리거가 함수 소유자
-- 권한으로 RLS를 우회해 기록해야 "애플리케이션 코드 누락에도 안전"이라는
-- database.md §9 설계 의도가 성립한다(is_super_admin()과 동일한 근거).
-- ============================================================================

create or replace function public.audit_log_admin_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, target_table, target_id, before, after)
  values (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    case when TG_OP = 'DELETE' then old.id else new.id end,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger agencies_audit_log
  after update or delete on public.agencies
  for each row
  execute function public.audit_log_admin_changes();

-- database.md §10 트리거 요약의 "agency_permissions_audit_log" 항목: AFTER INSERT/UPDATE
-- (최초 활성화 시점부터 감사 대상이어야 하므로 INSERT도 포함, DELETE는 이 테이블에서
-- 발생시키지 않는 운영 방침이라 제외 — 권한을 지우는 대신 enabled=false로 끈다).
create trigger agency_permissions_audit_log
  after insert or update on public.agency_permissions
  for each row
  execute function public.audit_log_admin_changes();

-- ============================================================================
-- 8. RLS — deny-by-default (security.md §2)
-- ============================================================================

alter table public.agencies enable row level security;
alter table public.agency_members enable row level security;
alter table public.agency_permissions enable row level security;
alter table public.audit_logs enable row level security;

-- --- agencies -----------------------------------------------------------

-- Public-Read: 승인된 Agency만 누구나 조회 가능(매물 상세 등에서 "등록 Agency"
-- 표시 목적). 컬럼 단위 제한(뷰 분리)은 database.md §12에 "향후" 항목으로 남겨둔
-- 그대로 이번 STEP에서는 구현하지 않는다 — row 단위로 승인된 것만 노출.
create policy "agencies_select_approved_public"
  on public.agencies
  for select
  to anon, authenticated
  using (approval_status = 'approved');

-- 본인이 소속된 Agency는 승인 전(pending/rejected/suspended)이어도 조회 가능
-- (자기 소속 상태 확인 목적). agency_members RLS의 owner-only-select 정책으로
-- "본인 행"은 항상 보이므로, 이 서브쿼리는 재귀 없이 안전하게 평가된다.
create policy "agencies_select_own_member"
  on public.agencies
  for select
  to authenticated
  using (
    exists (
      select 1 from public.agency_members m
      where m.agency_id = agencies.id
        and m.user_id = auth.uid()
    )
  );

create policy "agencies_select_admin"
  on public.agencies
  for select
  to authenticated
  using ( public.is_admin_or_above() );

-- Admin-Write만 승인/반려/정지 처리 가능. 클라이언트(Agency 스스로)는 INSERT 불가
-- — Agency 가입/온보딩 플로우(누가 최초로 agencies row를 만드는가)는 DECISIONS.md
-- D46 PENDING(사업 결정 대기)이므로, 이번 STEP에서는 Admin-Write만 만들고 셀프
-- 가입 경로는 열지 않는다.
create policy "agencies_insert_admin"
  on public.agencies
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "agencies_update_admin"
  on public.agencies
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

-- DELETE policy 없음(deny) — 정지는 approval_status='suspended'로 표현, 물리 삭제 안 함.

-- --- agency_members -------------------------------------------------------

-- 본인 소속 행은 항상 조회 가능.
create policy "agency_members_select_own"
  on public.agency_members
  for select
  to authenticated
  using ( user_id = auth.uid() );

-- 같은 Agency의 owner는 소속 전체 멤버를 조회 가능 — self-reference 재귀를 피하기
-- 위해 SECURITY DEFINER 헬퍼(is_agency_owner)로 조회를 분리한다(STEP03 RLS RECURSION
-- FIX와 동일 패턴).
create policy "agency_members_select_owner"
  on public.agency_members
  for select
  to authenticated
  using ( public.is_agency_owner(agency_id) );

create policy "agency_members_select_admin"
  on public.agency_members
  for select
  to authenticated
  using ( public.is_admin_or_above() );

-- Write는 이번 STEP에서 Admin-Write만 허용한다. "Agency owner가 자기 소속 staff를
-- 직접 초대/제거"하는 셀프서비스 경로는 database.md §12에 "세부 흐름은 D46 확정 후
-- API.md에 반영"이라고 명시되어 있고 D46(Agency 온보딩 플로우)이 아직 PENDING이므로,
-- 이번 STEP에서는 구현하지 않는다(추측 금지 원칙) — 필요한 멤버 등록은 Admin이
-- 대행 처리.
create policy "agency_members_insert_admin"
  on public.agency_members
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "agency_members_update_admin"
  on public.agency_members
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "agency_members_delete_admin"
  on public.agency_members
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

-- --- agency_permissions -----------------------------------------------------

-- Public-Read: enabled 값 등 전체 컬럼을 그대로 공개한다. database.md §12는 향후
-- updated_by 등 내부 컬럼을 뷰로 분리해 컬럼 단위로 제한하는 안을 "세부 설계"로
-- 남겨두었다 — Postgres RLS는 row 단위이므로 이번 STEP에서는 뷰를 새로 만들지 않고
-- 문서에 이미 명시된 대로 row 단위 Public-Read로 구현한다(컬럼 단위 제한은 later
-- 항목으로 report에 남긴다).
create policy "agency_permissions_select_public"
  on public.agency_permissions
  for select
  to anon, authenticated
  using ( true );

-- 일반 사용자는 직접 토글 불가 — Admin-Write만 가능(클라이언트 권한 상승 원천 차단).
create policy "agency_permissions_insert_admin"
  on public.agency_permissions
  for insert
  to authenticated
  with check ( public.is_admin_or_above() );

create policy "agency_permissions_update_admin"
  on public.agency_permissions
  for update
  to authenticated
  using ( public.is_admin_or_above() )
  with check ( public.is_admin_or_above() );

create policy "agency_permissions_delete_admin"
  on public.agency_permissions
  for delete
  to authenticated
  using ( public.is_admin_or_above() );

-- --- audit_logs -------------------------------------------------------------

-- Admin-Read only. security.md §3: "열람 권한: super_admin(기본), admin은
-- 읽기전용 하위 집합 — 세부는 Phase 9에서 UI 설계 시 재확인" — 이번 STEP에서는
-- 그 "세부 하위 집합" 설계가 아직 없으므로 문서에 명시된 "기본"값인 super_admin
-- 전용으로 좁게 시작한다(추측으로 admin까지 넓히지 않음 — 필요 시 Phase 9에서
-- 정책을 넓히는 후속 migration으로 확장).
create policy "audit_logs_select_super_admin"
  on public.audit_logs
  for select
  to authenticated
  using ( public.is_super_admin() );

-- INSERT/UPDATE/DELETE policy 없음(Server-Only) — 클라이언트는 절대 직접 쓰지 않고,
-- audit_log_admin_changes() 트리거 함수(SECURITY DEFINER)만 기록한다. immutable
-- 원칙(security.md §3 "audit_logs는 수정/삭제 불가")에 따라 UPDATE/DELETE policy는
-- 의도적으로 만들지 않는다(deny-by-default로 충분 — investment_transactions처럼
-- 별도 RAISE EXCEPTION 가드까지는 이번 STEP 범위 밖).
