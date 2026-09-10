-- STEP 4-3: SUPABASE AUTH FOUNDATION
-- Scope: public.profiles (auth.users 1:1 확장) + public.user_roles (RBAC 기반)
--        + handle_new_user 트리거(auth.users AFTER INSERT) + 최소 필요 RLS
--
-- 근거 문서: claude/database.md §0(enum), §1(profiles/user_roles), §10(트리거 요약)
--            claude/security.md §1.2(RBAC 이중검증 패턴), §2(RLS 방향)
--
-- 범위 밖(이번 마이그레이션에 포함하지 않음): user_devices, user_preferences,
-- property/investment/article 등 다른 모든 도메인 테이블 — STEP 4-3은
-- Auth Foundation(profiles/user_roles)만 다룬다.
--
-- 이번 마이그레이션이 저장소의 첫 마이그레이션이므로(기존 migrations/ 폴더는
-- .gitkeep만 존재), 파일명 규칙은 기존 프로젝트 관례가 없어 Supabase CLI의
-- 표준 관례(`<UTC timestamp>_<description>.sql`, `npx supabase migration new`가
-- 생성하는 형식과 동일)를 채택했다. supabase/README.md가 다음 단계로
-- `npx supabase init` + CLI 기반 migrations 관리를 명시하고 있어 이 관례와
-- 일치한다.

-- ============================================================================
-- 1. Enum 타입 (database.md §0에서 이번 STEP에 필요한 2개만 선행 생성)
--    나머지 enum(property_status 등)은 해당 도메인 마이그레이션에서 생성한다
--    (out-of-scope 원칙 — 이번 STEP은 Auth Foundation만 다룬다).
-- ============================================================================

create type public.user_role as enum (
  'super_admin',
  'admin',
  'editor',
  'reviewer',
  'operator',
  'user'
);

create type public.language_code as enum (
  'vi',
  'ko',
  'en',
  'zh',
  'ja'
);

-- ============================================================================
-- 2. public.profiles (database.md §1 "profiles" 정의 그대로 포팅)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  phone text,
  default_language public.language_code not null default 'en',
  default_currency text not null default 'USD',
  kyc_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.profiles is
  '사용자 프로필 (auth.users 1:1 확장). INSERT는 handle_new_user 트리거로만 발생 — 클라이언트 INSERT policy 없음.';

-- ============================================================================
-- 3. public.user_roles (database.md §1 "user_roles" 정의 그대로 포팅)
--
-- 이번 마이그레이션 스코프 노트: STEP 4-3 지시문의 Auth Scope(D/E)는 profiles만
-- 명시했으나, database.md §10에 문서화된 handle_new_user 트리거는 auth.users
-- INSERT 시 profiles와 user_roles('user')를 함께 생성하도록 정의되어 있다.
-- 문서에 정의된 트리거를 문서와 다르게(user_roles 없이) 구현하는 것은 "문서와
-- 다른 임의 변경"에 해당하므로, user_roles 테이블 생성을 트리거 구현의
-- 필수 종속 요소로 포함했다. RLS 등 다른 모든 도메인 테이블은 범위에서 제외했다.
-- ============================================================================

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.user_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

comment on table public.user_roles is
  'RBAC role 부여 내역. 일반 user role은 handle_new_user 트리거가 자동 부여, 그 외 role은 super_admin만 부여 가능(security.md §1.1).';

-- ============================================================================
-- 4. updated_at 자동 갱신 트리거 (database.md 공통 규칙: "갱신이 발생하는
--    테이블은 updated_at + BEFORE UPDATE 트리거로 자동 갱신")
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- 5. handle_new_user 트리거 (database.md §10)
--    auth.users AFTER INSERT → profiles + user_roles('user') 자동 생성.
--    SECURITY DEFINER 필요(클라이언트 role은 user_roles에 INSERT 권한이 없으므로),
--    search_path를 명시적으로 고정해 함수 하이재킹을 방지한다.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id);

  insert into public.user_roles (user_id, role)
  values (new.id, 'user');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================================
-- 5-1. is_super_admin() — RLS recursion 방지용 SECURITY DEFINER helper
--      (STEP 4-3A, CTO 코드 검수로 발견된 recursive RLS 문제의 최소 수정)
--
-- 문제: user_roles의 INSERT/UPDATE/DELETE 정책이 원래
--   exists(select 1 from public.user_roles ur where ur.user_id = auth.uid()
--          and ur.role = 'super_admin')
-- 형태의 인라인 subquery로 "같은 테이블(user_roles)"을 조회했다. Postgres RLS는
-- 정책 평가 중 같은 relation에 대한 RLS 하위질의가 다시 필요해지는 self-reference
-- 구조를 감지하면 방어적으로 "infinite recursion detected in policy for
-- relation \"user_roles\"" 오류를 발생시킨다(Postgres/Supabase에 문서화된 동작 —
-- INSERT/UPDATE/DELETE 정책이 자기 테이블을 subquery로 조회하는 패턴에서 반복적으로
-- 보고되는 문제). 이 인라인 subquery는 호출자(authenticated) 권한으로 실행되므로
-- user_roles의 RLS(및 자기 자신을 포함한 정책 평가 컨텍스트)에 다시 종속된다.
--
-- 해결: SECURITY DEFINER 함수로 조회를 분리한다. 이 함수는 함수 소유자(마이그레이션을
-- 실행하는 postgres role — user_roles 테이블의 소유자와 동일)의 권한으로 실행되며,
-- Postgres에서 테이블 소유자는 기본적으로 그 테이블의 RLS 대상이 아니다(이 마이그레이션은
-- FORCE ROW LEVEL SECURITY를 설정하지 않았으므로 예외 없이 적용된다). 따라서 함수
-- 내부의 SELECT는 user_roles의 RLS 정책을 다시 평가하지 않고, self-reference
-- 사이클이 끊어진다. service_role key는 전혀 사용하지 않는다 — Postgres의
-- table-owner-bypasses-RLS라는 표준 메커니즘만 사용한다.
--
-- 설계 결정:
-- - 인자를 받지 않는 함수(niladic)로 설계했다(개념상 예시로 제시된
--   is_super_admin(auth.uid()) 형태의 parameterized 버전을 채택하지 않음) —
--   내부에서 직접 auth.uid()를 사용해 "호출한 세션 사용자 자신"만 검사하도록
--   고정함으로써, 임의의 user_id를 인자로 넘겨 다른 사용자의 role 존재 여부를
--   probing하는 경로 자체를 구조적으로 차단한다(STEP 5 요구사항: "임의
--   parameter 조작으로 권한 상승이 불가능한 구조").
-- - STABLE로 선언(같은 statement 내에서 결과가 바뀌지 않음, VOLATILE 아님).
-- - search_path를 `public`으로 명시 고정해 함수 하이재킹(호출자가 조작한
--   search_path로 다른 스키마의 동일 이름 오브젝트가 대신 resolve되는 것)을 방지한다.
-- - 이 함수는 boolean 하나만 반환하며 그 자체로는 어떤 쓰기 권한도 부여하지
--   않는다 — 실제 쓰기 허용 여부는 여전히 각 정책의 USING/WITH CHECK가 결정한다.
-- ============================================================================

create or replace function public.is_super_admin()
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
      and role = 'super_admin'
  );
$$;

-- 기본적으로 PUBLIC에 부여되는 EXECUTE 권한을 회수하고, 실제로 정책 평가 시
-- 이 함수를 호출해야 하는 authenticated role에만 최소 권한으로 부여한다.
-- anon에는 부여하지 않는다(어차피 user_roles 쓰기 정책은 authenticated 전용).
revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- ============================================================================
-- 6. RLS — deny-by-default, 필요한 접근만 명시 (security.md §2)
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- profiles: Owner-Only SELECT/UPDATE. INSERT/DELETE policy 없음(트리거 전용).
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- user_roles: Owner-Only SELECT(본인 role 조회).
create policy "user_roles_select_own"
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid());

-- user_roles: Admin-Write — security.md §1.1에 따라 role 부여/회수는
-- super_admin 전용이므로, is_super_admin()으로 한정한다(security.md §1.2의
-- 문서화된 이중검증 패턴을 따름). recursive RLS를 피하기 위해 인라인
-- exists(select ... from user_roles ...) subquery 대신 5-1의 SECURITY DEFINER
-- helper 함수를 사용한다(STEP 4-3A, RLS RECURSION FIX 참조).
create policy "user_roles_insert_super_admin"
  on public.user_roles
  for insert
  to authenticated
  with check ( public.is_super_admin() );

create policy "user_roles_update_super_admin"
  on public.user_roles
  for update
  to authenticated
  using ( public.is_super_admin() )
  with check ( public.is_super_admin() );

create policy "user_roles_delete_super_admin"
  on public.user_roles
  for delete
  to authenticated
  using ( public.is_super_admin() );
