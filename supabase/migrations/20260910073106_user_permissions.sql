-- STEP 05c — 사용자별 기능 권한(user_permissions).
--
-- 사용자 요구사항(2026-09-10): "투자등록은 관리자와 권한부여받은 계정만 등록/수정/삭제
-- 가능. 권한부여 대상은 직원/운영자/특정 투자자 등 관리자가 지정해 주는 계정."
--
-- 기존 구조로는 표현할 수 없었다:
--   - `user_roles`는 내부 운영 인력의 RBAC(super_admin~user)이라, "특정 투자자에게만
--     투자상품 등록을 허용" 같은 개별 지정에 쓰면 의미가 어긋난다(DATABASE.md §1 주의 참고).
--   - `agency_permissions`는 Agency(업체) 단위 권한이라 개인 계정에 직접 부여할 수 없다.
-- 그래서 agency_permissions와 **동일한 EAV형 permission_type 패턴**(D39의 설계 정신)을
-- 사용자 단위로 옮긴 테이블을 새로 만든다 — 권한 종류가 늘어도 컬럼 추가 없이 enum 값과
-- 행만 추가하면 된다.

create type public.user_permission_type as enum (
  'investment_manage',  -- 투자상품 등록/수정/삭제
  'property_manage'     -- 매물 등록/수정/삭제 (향후 Agency 외 개인 담당자용)
);

create table public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_type public.user_permission_type not null,
  -- 회수 시 행을 지우지 않고 false로 두면 "언제 누가 줬다가 회수했는지"가 남는다
  -- (agency_permissions와 동일한 운영 방식).
  enabled boolean not null default true,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (user_id, permission_type)
);

create index user_permissions_user_id_idx on public.user_permissions (user_id);

comment on table public.user_permissions is
  '관리자가 개별 계정에 부여하는 기능 권한. user_roles(내부 운영 RBAC)/agency_permissions(업체 단위 권한)와는 다른 축이다 — 직원·운영자·특정 투자자 등 어떤 계정에도 기능 단위로 부여할 수 있다. 부여/회수는 admin만 가능하다.';

alter table public.user_permissions enable row level security;

-- 본인 권한은 조회 가능(화면에서 등록 메뉴 노출 판단용). 부여/회수는 admin만.
create policy "user_permissions_select_own"
  on public.user_permissions for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_permissions_select_admin"
  on public.user_permissions for select
  to authenticated
  using (public.is_admin_or_above());

create policy "user_permissions_insert_admin"
  on public.user_permissions for insert
  to authenticated
  with check (public.is_admin_or_above());

create policy "user_permissions_update_admin"
  on public.user_permissions for update
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

create policy "user_permissions_delete_admin"
  on public.user_permissions for delete
  to authenticated
  using (public.is_admin_or_above());

create trigger user_permissions_updated_at
  before update on public.user_permissions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 권한 판정 헬퍼
-- ---------------------------------------------------------------------------

create or replace function public.has_user_permission(target public.user_permission_type)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_permissions up
    where up.user_id = auth.uid()
      and up.permission_type = target
      and up.enabled
  );
$$;

comment on function public.has_user_permission(public.user_permission_type) is
  '현재 로그인 사용자가 해당 기능 권한을 활성 상태로 가지고 있는지. SECURITY DEFINER인 이유 — RLS 정책 내부에서 user_permissions를 다시 조회할 때 정책 재귀를 피하기 위함이다(agency_has_active_permission과 동일한 구조).';

grant execute on function public.has_user_permission(public.user_permission_type) to authenticated;

-- ---------------------------------------------------------------------------
-- investment_products 정책 확장 — admin OR investment_manage 권한 보유자
-- ---------------------------------------------------------------------------

-- 기존 정책은 admin 전용이었다. 정책은 OR로 결합되므로 **기존 정책을 지우지 않고**
-- 권한 보유자용 정책을 나란히 추가한다(기존 동작 보존 원칙).

create policy "investment_products_insert_permitted"
  on public.investment_products for insert
  to authenticated
  with check (public.has_user_permission('investment_manage'));

create policy "investment_products_update_permitted"
  on public.investment_products for update
  to authenticated
  using (public.has_user_permission('investment_manage'))
  with check (public.has_user_permission('investment_manage'));

create policy "investment_products_delete_permitted"
  on public.investment_products for delete
  to authenticated
  using (public.has_user_permission('investment_manage'));

-- 비공개 상태(draft/pending_review 등) 상품도 관리하려면 조회가 되어야 한다.
create policy "investment_products_select_permitted"
  on public.investment_products for select
  to authenticated
  using (public.has_user_permission('investment_manage'));

-- ---------------------------------------------------------------------------
-- properties 정책 확장 — property_manage 권한 보유자도 매물 관리 가능
-- ---------------------------------------------------------------------------

create policy "properties_insert_permitted"
  on public.properties for insert
  to authenticated
  with check (public.has_user_permission('property_manage'));

create policy "properties_update_permitted"
  on public.properties for update
  to authenticated
  using (public.has_user_permission('property_manage'))
  with check (public.has_user_permission('property_manage'));

create policy "properties_select_permitted"
  on public.properties for select
  to authenticated
  using (public.has_user_permission('property_manage'));

-- 하드 삭제는 admin에게만 유지한다(2026-09-10 사용자 결정: "기본은 소프트, admin만 하드").
-- property_manage 보유자는 status='archived'(소프트 삭제)까지만 가능하다.

create policy "property_images_insert_permitted"
  on public.property_images for insert
  to authenticated
  with check (public.has_user_permission('property_manage'));

create policy "property_images_delete_permitted"
  on public.property_images for delete
  to authenticated
  using (public.has_user_permission('property_manage'));

-- ---------------------------------------------------------------------------
-- GRANT (2026-09-10 규칙)
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.user_permissions to authenticated;
