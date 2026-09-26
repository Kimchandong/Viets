-- ============================================================================
-- [2026-09-16 웹 검증에서 발견] admin_search_users가 실행되면 반드시 실패한다
--
-- 증상: 계정 권한 관리(M7)에서 무엇을 검색해도 "검색 결과가 없습니다". 콘솔에는
--
--   [services/roles] adminSearchUsers failed:
--   structure of query does not match function result type
--
-- 원인: 함수는 `email text`를 돌려준다고 선언했는데, 본문은 `u.email`을 그대로
-- 내보낸다. Supabase의 **auth.users.email은 character varying(255)**이다.
-- PostgreSQL은 RETURNS TABLE의 선언 타입과 실제 컬럼 타입이 다르면 실행 시점에
-- 이 오류로 거부한다. 조건이나 데이터와 무관하게 **호출하면 항상 실패**한다.
--
-- 왜 지금까지 몰랐나: 이 함수를 쓰는 화면은 M7 하나뿐인데, 2026-09-11에 "등록신청
-- 관리와 겹친다"며 진입 경로를 없앴다. 그 뒤로 **아무도 이 함수를 호출한 적이 없다.**
-- 2026-09-16에 확정-결정사항 3으로 M7을 되살리고 웹 미리보기로 눌러 보자마자 나왔다.
--
-- 고치는 방법: 선언을 바꾸지 않고 본문에서 text로 캐스팅한다. 선언을 varchar로
-- 바꾸면 클라이언트 타입(services/roles.ts의 string)과의 관계는 그대로지만,
-- auth 스키마의 컬럼 타입에 우리 함수 시그니처를 묶게 된다 — Supabase가 그 길이를
-- 바꾸면 또 깨진다. 캐스팅이 그 결합을 끊는다.
--
-- display_name은 public.profiles.display_name이고 이미 text라 손대지 않는다.
-- ============================================================================

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
    -- [2026-09-16] 여기가 고친 곳. auth.users.email은 varchar(255)라 text 선언과
    -- 맞지 않아 호출이 항상 실패했다.
    u.email::text,
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
  '관리자 전용 계정 검색(이메일/표시이름 부분일치, 최대 20건). SECURITY DEFINER인 이유 — auth.users와 남의 profiles는 클라이언트 RLS로는 조회할 수 없기 때문이다. 함수 내부에서 is_admin_or_above()를 직접 검사하며, 검색어 2자 미만이면 거부해 전체 덤프를 막는다. email은 auth.users의 varchar를 text로 캐스팅해 내보낸다(2026-09-16 — 캐스팅이 없어 호출이 항상 실패했다).';

-- 적용 후 확인(관리자 계정으로 SQL Editor에서는 is_admin_or_above()가 false라
-- 예외가 난다 — 앱에서 검색해 보는 것이 맞다). 타입만 보려면:
--
--   select pg_get_function_result(oid)
--   from pg_proc where proname = 'admin_search_users';
