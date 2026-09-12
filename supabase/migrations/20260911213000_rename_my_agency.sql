-- ============================================================================
-- [2026-09-11 사용자 지시] MY 화면 — 업체명 수정
--
-- public.agencies는 관리자만 UPDATE할 수 있다(agencies_update_admin). 그 정책을
-- 넓히지 않는 이유: RLS는 "행" 단위라 UPDATE를 열어 주면 같은 행의
-- approval_status/registration_no까지 바꿀 수 있게 된다 — 업체가 스스로 승인
-- 상태를 'approved'로 적을 수 있다는 뜻이다.
--
-- 그래서 이름 한 칼럼만 바꾸는 security definer 함수를 만든다. 호출자는 자기
-- 업체의 owner여야 하고, 함수는 name 외에는 건드리지 않는다.
-- ============================================================================

create or replace function public.rename_my_agency(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'not-authenticated' using errcode = '28000';
  end if;

  if length(v_name) = 0 then
    raise exception 'empty-name' using errcode = '22023';
  end if;

  -- 이름 길이 상한 — 목록/카드가 한 줄로 읽히는 범위를 넘지 않게 한다.
  if length(v_name) > 60 then
    raise exception 'name-too-long' using errcode = '22023';
  end if;

  -- 내가 owner로 소속된 활성 업체. staff는 바꿀 수 없다(업체 이름은 대표가 정한다).
  select m.agency_id
    into v_agency_id
    from public.agency_members m
   where m.user_id = auth.uid()
     and m.status = 'active'
     and m.role_in_agency = 'owner'
   order by m.created_at desc
   limit 1;

  if v_agency_id is null then
    raise exception 'no-agency' using errcode = '42501';
  end if;

  update public.agencies
     set name = v_name
   where id = v_agency_id;
end;
$$;

comment on function public.rename_my_agency(text) is
  '본인이 owner인 업체의 이름만 변경한다. 승인 상태 등 다른 칼럼은 건드리지 않는다.';

revoke all on function public.rename_my_agency(text) from public;
grant execute on function public.rename_my_agency(text) to authenticated;
