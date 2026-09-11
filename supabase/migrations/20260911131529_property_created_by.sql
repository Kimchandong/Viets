-- [2026-09-11 사용자 지시] 매물에 "등록한 계정"을 기록하고, 중개업소는 자기가 등록한
-- 매물만 보고/수정/관리하게 한다.
--
-- 무엇이 문제였나:
-- properties에는 등록자를 가리키는 컬럼이 없었다. agency_id가 있긴 하나 등록 폼
-- (services/properties.ts createProperty)이 값을 넣지 않아 전부 NULL이고, 소유를
-- 판정할 근거가 DB 어디에도 없는 상태였다. 그 결과 20260910073106_user_permissions.sql의
-- `properties_select_permitted`(= property_manage 권한만 보면 전부 SELECT 허용)가
-- 사실상 "매물 관리 권한자는 남의 매물까지 전부 본다"로 동작했다 — MY > 매물 정보에
-- teststore 계정이 관리자가 올린 매물까지 함께 보고 있었던 이유다.
--
-- 왜 agency_id가 아니라 created_by인가:
-- 사용자 결정 — "부동산중개업소는 **본인의** 등록매물만 보고/수정/관리". 같은 업소
-- 직원끼리 공유하는 모델이 아니다. agency_id 기반 정책(properties_select_own_agency,
-- can_manage_agency_property)은 그대로 남겨 둔다 — 업소 온보딩이 붙는 시점에 두 축이
-- 함께 동작하면 된다(정책은 OR로 합쳐지므로 이 마이그레이션이 그쪽을 막지 않는다).
--
-- 투자상품(investment_products)은 별도 테이블이며 이 화면은 properties만 조회한다.
-- 투자용으로 관리자가 올린 매물은 created_by가 관리자이므로, 이 변경만으로 중개업소
-- 목록에서 자연히 빠진다.
--
-- 이전 마이그레이션: 20260911115437_chat_manager_access.sql

-- ============================================================================
-- 1. created_by 컬럼
-- ============================================================================

alter table public.properties
  add column created_by uuid references auth.users (id) on delete set null default auth.uid();

comment on column public.properties.created_by is
  '이 매물을 등록한 계정. DEFAULT auth.uid()이므로 클라이언트가 값을 보내지 않아도 채워진다(보내더라도 INSERT 정책의 with check가 본인 id만 허용한다). 계정이 삭제되면 매물은 남고 이 값만 NULL이 된다 — 매물 자체는 상담/찜 이력이 걸려 있어 함께 지우지 않는다.';

-- 중개업소 목록 화면이 "내가 등록한 것"만 뽑으므로 단독 인덱스를 둔다.
create index properties_created_by_idx on public.properties (created_by);

-- ============================================================================
-- 2. 기존 행 백필 — 테스트 매물 3건만 teststore로
-- ============================================================================
--
-- 이미 등록된 매물에는 등록자 기록이 없다(그 정보가 애초에 저장된 적이 없으므로
-- 되살릴 방법도 없다). 그대로 두면 created_by가 NULL이라 teststore의 목록이 빈 채로
-- 나와 테스트를 이어갈 수 없다.
--
-- 그래서 **테스트 계정이 직접 등록한 것이 확실한 행만** 좁혀서 채운다: 제목에
-- '테스트 매물'이 들어간, created_by가 비어 있는 매물. 관리자가 올린 실데이터
-- (예: Vinhomes Harmony)는 조건에 걸리지 않으므로 NULL로 남고, 관리자 정책
-- (is_admin_or_above)으로만 보인다 — 의도한 결과다.
--
-- teststore 계정이 없는 환경(운영 등)에서는 update가 0건 처리되고 넘어간다.

update public.properties as p
set created_by = u.id
from auth.users as u
where u.email = 'teststore@viets.test'
  and p.created_by is null
  and p.title like '%테스트 매물%';

-- ============================================================================
-- 3. RLS — property_manage 권한 정책을 "본인 매물"로 좁힌다
-- ============================================================================
--
-- 정책은 ALTER로 조건을 바꿀 수 없어 drop 후 재생성한다. 이름과 대상은 그대로라
-- 다른 정책(admin/agency 계열)에는 영향이 없다 — 같은 명령의 정책들은 OR로 합쳐지므로
-- 관리자는 계속 전체를 본다.

drop policy if exists "properties_select_permitted" on public.properties;

create policy "properties_select_permitted"
  on public.properties for select
  to authenticated
  using (
    public.has_user_permission('property_manage')
    and created_by = auth.uid()
  );

drop policy if exists "properties_update_permitted" on public.properties;

create policy "properties_update_permitted"
  on public.properties for update
  to authenticated
  using (
    public.has_user_permission('property_manage')
    and created_by = auth.uid()
  )
  with check (
    public.has_user_permission('property_manage')
    and created_by = auth.uid()
  );

-- INSERT의 with check에 created_by = auth.uid()를 두는 이유: DEFAULT가 있어도
-- 클라이언트가 created_by를 직접 실어 보낼 수 있다. 남의 id로 등록해 두고 목록에서
-- 숨기는 식의 조작을 서버에서 막는다.
drop policy if exists "properties_insert_permitted" on public.properties;

create policy "properties_insert_permitted"
  on public.properties for insert
  to authenticated
  with check (
    public.has_user_permission('property_manage')
    and created_by = auth.uid()
  );

-- ============================================================================
-- 4. 사진(property_images)도 같은 기준으로 좁힌다
-- ============================================================================
--
-- 매물은 못 고치는데 사진은 지울 수 있으면 소유 제한이 반쪽이 된다 — 부모 매물의
-- created_by를 함께 확인한다.

drop policy if exists "property_images_insert_permitted" on public.property_images;

create policy "property_images_insert_permitted"
  on public.property_images for insert
  to authenticated
  with check (
    public.has_user_permission('property_manage')
    and exists (
      select 1 from public.properties p
      where p.id = property_images.property_id and p.created_by = auth.uid()
    )
  );

drop policy if exists "property_images_delete_permitted" on public.property_images;

create policy "property_images_delete_permitted"
  on public.property_images for delete
  to authenticated
  using (
    public.has_user_permission('property_manage')
    and exists (
      select 1 from public.properties p
      where p.id = property_images.property_id and p.created_by = auth.uid()
    )
  );

-- ============================================================================
-- 5. 상담(채팅) 접근도 같은 기준으로
-- ============================================================================
--
-- 20260911115437_chat_manager_access.sql의 can_manage_property_chat()은
-- has_user_permission('property_manage')만 보면 통과시켰다 — 남의 매물에 들어온 고객
-- 상담까지 읽히므로 매물 소유와 같은 기준으로 맞춘다. 관리자(is_admin_or_above)와
-- 업소 소속(can_manage_agency_property)은 그대로 유지한다.

create or replace function public.can_manage_property_chat(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_or_above()
    or exists (
      select 1 from public.properties p
      where p.id = target_property_id
        and (
          p.created_by = auth.uid()
          or public.can_manage_agency_property(p.agency_id)
        )
    );
$$;

comment on function public.can_manage_property_chat(uuid) is
  '이 계정이 해당 매물의 고객 상담을 읽고 답할 수 있는지 — 관리자이거나, 매물을 등록한 본인이거나, 매물을 보유한 Agency를 관리할 수 있는 경우. 2026-09-11 properties.created_by 도입으로 "property_manage 권한자 전원"에서 "등록 본인"으로 좁혔다.';
