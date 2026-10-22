-- [2026-10-22 사용자 지시] 직원관리 — 내 업체 소속 직원 추가/삭제.
--
-- agency_members 표는 2026-09-01부터 있었지만 **쓰는 코드가 하나도 없었다.** write
-- 정책이 admin 전용이라(원래 주석: "D46 확정 후"), 업체 owner가 직원을 직접 넣고 빼는
-- 길이 막혀 있었다. 이번에 그 셀프서비스 경로를 연다.
--
-- 경계를 좁게 잡는다:
--   · owner만 쓴다. staff는 조회만(기존 agency_members_select_own 정책 그대로).
--   · 넣고 뺄 수 있는 건 **staff 행뿐**이다. owner 행은 건드릴 수 없다 — 그렇지
--     않으면 owner가 다른 owner를 만들거나 자기를 지워 업체가 주인 없는 상태가 된다.
--   · update는 열지 않는다. 역할 변경은 요청에 없었고, 열면 staff를 owner로 올리는
--     경로가 생긴다.

-- ---------------------------------------------------------------------------
-- 1) 내가 owner인 업체 id
-- ---------------------------------------------------------------------------
create or replace function public.my_owned_agency_id()
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
    and m.role_in_agency = 'owner'
  order by m.created_at desc
  limit 1;
$$;

comment on function public.my_owned_agency_id() is
  '[2026-10-22] 호출자가 owner로 소속된 업체 id. 없으면 NULL. 직원관리 RLS/RPC의 기준.';

-- ---------------------------------------------------------------------------
-- 2) owner의 직원 추가/삭제 정책
-- ---------------------------------------------------------------------------
drop policy if exists "agency_members_insert_owner" on public.agency_members;
create policy "agency_members_insert_owner"
  on public.agency_members
  for insert
  to authenticated
  with check (
    public.is_agency_owner(agency_id)
    and role_in_agency = 'staff'
  );

drop policy if exists "agency_members_delete_owner" on public.agency_members;
create policy "agency_members_delete_owner"
  on public.agency_members
  for delete
  to authenticated
  using (
    public.is_agency_owner(agency_id)
    and role_in_agency = 'staff'
    and user_id <> auth.uid()
  );

-- ---------------------------------------------------------------------------
-- 3) 직원 목록 — 이메일은 auth.users에 있어 클라이언트가 직접 읽을 수 없다.
-- ---------------------------------------------------------------------------
create or replace function public.agency_staff_list()
returns table (
  member_id uuid,
  user_id uuid,
  email text,
  display_name text,
  role_in_agency text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  target := public.my_owned_agency_id();
  if target is null then
    raise exception 'permission denied: agency owner only'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    m.id,
    m.user_id,
    -- auth.users.email은 varchar(255)라 text로 캐스팅해야 선언과 맞는다
    -- (admin_search_users에서 같은 이유로 한 번 깨졌던 자리다).
    u.email::text,
    p.display_name,
    m.role_in_agency::text,
    m.status,
    m.created_at
  from public.agency_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.agency_id = target
  order by (m.role_in_agency = 'owner') desc, m.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) 추가할 계정 찾기 — owner 전용. 이미 소속된 사람은 빼고 돌려준다.
-- ---------------------------------------------------------------------------
create or replace function public.agency_search_users(search text)
returns table (
  user_id uuid,
  email text,
  display_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  target := public.my_owned_agency_id();
  if target is null then
    raise exception 'permission denied: agency owner only'
      using errcode = 'insufficient_privilege';
  end if;

  if search is null or length(btrim(search)) < 2 then
    raise exception 'search term must be at least 2 characters'
      using errcode = 'invalid_parameter_value';
  end if;

  return query
  select u.id, u.email::text, p.display_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where (
      u.email ilike '%' || btrim(search) || '%'
      or coalesce(p.display_name, '') ilike '%' || btrim(search) || '%'
    )
    -- 이미 이 업체 소속인 사람은 결과에서 뺀다 — 눌러 봐야 중복 키로 실패한다.
    and not exists (
      select 1 from public.agency_members m
      where m.agency_id = target and m.user_id = u.id
    )
  order by u.email
  limit 20;
end;
$$;

revoke all on function public.my_owned_agency_id() from public;
revoke all on function public.agency_staff_list() from public;
revoke all on function public.agency_search_users(text) from public;
grant execute on function public.my_owned_agency_id() to authenticated;
grant execute on function public.agency_staff_list() to authenticated;
grant execute on function public.agency_search_users(text) to authenticated;
