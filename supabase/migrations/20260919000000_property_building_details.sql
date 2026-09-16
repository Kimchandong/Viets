-- ============================================================================
-- [2026-09-16 확정-결정사항 8·10] 매물 상세 수치 7개를 화면에 올린다
--
-- 배경: 2026-09-10 property_domain_foundation이 properties에 건물면적·대지면적·
-- 층수·준공년도·공실률·임대수익·시행사(developer_id) 7개 열을 만들었는데, 등록
-- 화면에 입력란이 없고 상세 화면에 표시 자리도 없어 6개월 가까이 전부 NULL이었다
-- (불일치-목록 3② — 앱·엣지·SQL 어디에도 참조가 없던 열들).
--
-- 열은 이미 있으므로 이 마이그레이션이 하는 일은 **시행사를 쓸 수 있게 만드는 것**
-- 하나다. developers 표는 0행이고, 2026-09-16 close_public_read_leaks가 공개 읽기를
-- 닫아 둔 상태라 지금은 관리자만 읽고 쓸 수 있다.
--
-- 시행사 입력 방식(2026-09-16 사용자 결정): **자유 입력 → 이름으로 자동 등록**.
-- 관리자 전용 시행사 관리 화면을 따로 만들지 않는다 — 화면이 하나 늘고, 관리자가
-- 먼저 넣어 두지 않으면 중개업자가 매물을 등록할 수 없게 된다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 이름 중복 방지
-- ----------------------------------------------------------------------------
--
-- 자유 입력이라 "Vingroup" / "vingroup" / " Vingroup " 이 각각 다른 행이 된다.
-- lower(trim(...)) 기준 유니크로 묶어, 아래 upsert_developer가 경쟁 상태에서도
-- 중복을 만들지 않게 한다(동시에 두 번 들어오면 한쪽이 유니크 위반으로 튕기고,
-- 함수가 그걸 잡아 기존 행을 돌려준다).

create unique index if not exists developers_name_unique_ci
  on public.developers (lower(btrim(name)));

-- ----------------------------------------------------------------------------
-- 2. 시행사 이름을 읽을 수 있게 한다 — 단, name만
-- ----------------------------------------------------------------------------
--
-- 매물 상세(P1)는 비로그인 사용자도 본다. 시행사 이름은 그 매물의 공개 정보이므로
-- anon도 읽어야 한다. 그런데 2026-09-16에 공개 읽기를 닫은 이유는 그대로 유효하다 —
-- contact(jsonb)에는 담당자 연락처가 들어갈 자리이고, RLS는 **행 단위**라 정책만으로는
-- 열을 가릴 수 없다.
--
-- 그래서 **열 단위 grant**로 가린다. 표 전체 select를 회수하고 id·name·logo_url만
-- 다시 준다. contact는 관리자 정책으로만 읽힌다(관리자는 아래 grant와 무관하게
-- developers_select_admin + service_role 경로로 본다).

revoke select on public.developers from anon, authenticated;
grant  select (id, name, logo_url, is_active) on public.developers to anon, authenticated;

-- 열 grant가 있어도 RLS를 통과할 정책이 없으면 0행이 돌아온다. 공개 대상은
-- is_active인 행뿐이다(2026-09-10 원래 정책과 같은 조건, 이름만 다시 붙인다).
drop policy if exists developers_select_active_public on public.developers;

create policy developers_select_active_public
  on public.developers
  for select
  to anon, authenticated
  using ( is_active );

-- ----------------------------------------------------------------------------
-- 3. 이름으로 찾거나 만든다
-- ----------------------------------------------------------------------------
--
-- security definer인 이유: insert 정책이 관리자 전용인데, 매물을 등록할 수 있는
-- 중개업자도 시행사를 만들 수 있어야 한다. 정책을 느슨하게 푸는 대신 **이 함수
-- 하나만 문으로 두고**, 함수 안에서 "매물을 등록할 수 있는 사람인가"를 직접 본다.
-- properties INSERT를 통과할 수 있는 세 경로(관리자 / property_manage 권한 /
-- 승인된 중개업소 구성원)와 같은 기준이다.
--
-- 빈 이름은 NULL을 돌려준다 — 시행사는 선택 항목이고, 화면에서 비워 두면
-- developer_id가 NULL로 저장된다.

create or replace function public.upsert_developer(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_name = '' then
    return null;
  end if;

  if not (
    public.is_admin_or_above()
    or public.has_user_permission('property_manage')
    or public.can_manage_agency_property(public.my_active_agency_id())
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id into v_id
  from public.developers
  where lower(btrim(name)) = lower(v_name);

  if v_id is not null then
    -- 이미 있으면 되살리기만 한다. 비활성으로 내려둔 시행사를 누군가 다시 쓰면
    -- 그 이름으로 새 행을 만드는 것보다 원래 행을 켜는 편이 맞다.
    update public.developers
    set is_active = true, updated_at = now()
    where id = v_id and not is_active;
    return v_id;
  end if;

  begin
    insert into public.developers (name, is_active)
    values (v_name, true)
    returning id into v_id;
  exception when unique_violation then
    -- 같은 순간에 다른 요청이 먼저 넣었다. 그쪽 행을 쓴다.
    select id into v_id
    from public.developers
    where lower(btrim(name)) = lower(v_name);
  end;

  return v_id;
end;
$$;

revoke all on function public.upsert_developer(text) from public;
grant execute on function public.upsert_developer(text) to authenticated;

comment on function public.upsert_developer(text) is
  '시행사 이름으로 찾거나 만들어 id를 돌려준다. 빈 이름이면 NULL. 매물을 등록할 수 있는 계정만 실행할 수 있다.';

-- ----------------------------------------------------------------------------
-- 4. 자동완성
-- ----------------------------------------------------------------------------
--
-- 자유 입력의 대가는 표기 흔들림이다("Vingroup" vs "Vin Group"). 이미 등록된
-- 이름을 먼저 보여 주면 대부분 그중에서 고르게 된다. 2절의 select 정책으로도
-- 읽히지만, 앞자리 일치 우선 정렬을 클라이언트에서 하면 페이지를 다 받아야 하므로
-- 서버에서 정렬해 10개만 돌려준다.

create or replace function public.search_developers(p_query text)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.name
  from public.developers d
  where d.is_active
    and (
      coalesce(btrim(p_query), '') = ''
      or d.name ilike '%' || btrim(p_query) || '%'
    )
  order by
    -- 앞자리부터 맞는 것을 먼저 — "Vin"을 치면 "Vinhomes"가 "Nam Long Vin"보다 위다.
    (d.name ilike btrim(coalesce(p_query, '')) || '%') desc,
    d.name asc
  limit 10;
$$;

revoke all on function public.search_developers(text) from public;
grant execute on function public.search_developers(text) to anon, authenticated;

comment on function public.search_developers(text) is
  '시행사 이름 자동완성 — 활성 시행사 중 최대 10개. 앞자리 일치를 먼저 돌려준다.';

-- ----------------------------------------------------------------------------
-- 5. 이 마이그레이션이 하지 않는 것
-- ----------------------------------------------------------------------------
--
-- · properties에 열을 추가하지 않는다. 7개 모두 2026-09-10에 이미 만들어져 있다.
-- · owners / locations / property_categories / property_documents는 건드리지 않는다
--   (확정-결정사항 10 — 보류). 지역은 MOCK_REGIONS 상수, 분류는 mockData.ts가
--   계속 담당한다.
-- · 시행사 로고(logo_url)·설명(description)은 입력 화면을 만들지 않는다. 열 grant에
--   logo_url을 넣어 둔 것은 나중에 로고를 붙일 때 마이그레이션을 다시 쓰지 않기
--   위해서다.
