-- STEP 05d — 관리자용 계정 검색 + 권한 현황 조회 함수.
--
-- 권한 관리 화면(app/admin-permissions.tsx)에서 "관리자가 계정을 찾아 권한을 ON/OFF"
-- 하려면 다른 사용자를 조회할 수 있어야 하는데, 현재 구조로는 불가능하다:
--   - `auth.users`는 Supabase가 클라이언트에 노출하지 않는다(PostgREST 대상 밖).
--   - `profiles`의 RLS는 Owner-Only라 관리자도 남의 프로필을 볼 수 없다.
--   - 게다가 이메일은 profiles가 아니라 auth.users에만 있다.
--
-- 그래서 **관리자 전용 검색 함수**를 SECURITY DEFINER로 제공한다. 사용자 목록을
-- 통째로 노출하지 않기 위해 두 가지 방어를 둔다:
--   1) 함수 첫 줄에서 is_admin_or_above()를 검사해 관리자가 아니면 즉시 예외.
--   2) 검색어를 2자 이상 요구한다 — 빈 문자열로 전체를 덤프할 수 없다.

create or replace function public.admin_search_users(search text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  is_admin boolean,
  investment_manage boolean,
  property_manage boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'permission denied: admin only'
      using errcode = 'insufficient_privilege';
  end if;

  if search is null or length(btrim(search)) < 2 then
    raise exception 'search term must be at least 2 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  select
    u.id,
    u.email,
    p.display_name,
    exists (
      select 1 from public.user_roles r
      where r.user_id = u.id and r.role in ('admin', 'super_admin')
    ),
    exists (
      select 1 from public.user_permissions up
      where up.user_id = u.id and up.permission_type = 'investment_manage' and up.enabled
    ),
    exists (
      select 1 from public.user_permissions up
      where up.user_id = u.id and up.permission_type = 'property_manage' and up.enabled
    )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email ilike '%' || btrim(search) || '%'
     or coalesce(p.display_name, '') ilike '%' || btrim(search) || '%'
  order by u.email
  limit 20;
end;
$$;

comment on function public.admin_search_users(text) is
  '관리자 전용 계정 검색(이메일/표시이름 부분일치, 최대 20건). SECURITY DEFINER인 이유 — auth.users와 남의 profiles는 클라이언트 RLS로는 조회할 수 없기 때문이다. 함수 내부에서 is_admin_or_above()를 직접 검사하며, 검색어 2자 미만이면 거부해 전체 덤프를 막는다.';

grant execute on function public.admin_search_users(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 권한 부여/회수 헬퍼 — upsert로 단순화
-- ---------------------------------------------------------------------------
-- 화면에서 토글 한 번에 "없으면 만들고, 있으면 enabled만 바꾸는" 동작이 필요하다.
-- 클라이언트에서 insert/update를 분기하면 경합(동시 토글) 시 UNIQUE 위반이 나므로
-- 서버에서 upsert로 처리한다. 권한 검사는 user_permissions RLS(admin only)가 아니라
-- 이 함수 내부에서 명시적으로 한 번 더 수행한다(SECURITY DEFINER이므로 필수).

create or replace function public.admin_set_user_permission(
  target_user uuid,
  target_permission public.user_permission_type,
  next_enabled boolean
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

  insert into public.user_permissions (user_id, permission_type, enabled, granted_by)
  values (target_user, target_permission, next_enabled, auth.uid())
  on conflict (user_id, permission_type)
  do update set enabled = excluded.enabled,
                granted_by = excluded.granted_by,
                updated_at = now();
end;
$$;

comment on function public.admin_set_user_permission(uuid, public.user_permission_type, boolean) is
  '관리자가 특정 계정의 기능 권한을 켜거나 끈다(없으면 생성). 회수 시 행을 지우지 않고 enabled=false로 두어 부여/회수 이력이 남는다.';

grant execute on function public.admin_set_user_permission(uuid, public.user_permission_type, boolean) to authenticated;
