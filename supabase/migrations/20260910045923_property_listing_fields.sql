-- STEP 02b: PROPERTY 화면-DB GAP 보강 — listing_type/bedrooms/bathrooms/featured/amenities
--
-- 배경: STEP 04(매물 목록/상세 Mock→실DB 전환) 착수 전, 실제 화면 코드
-- (app/(tabs)/property.tsx, app/property-detail/[id].tsx)와 STEP 02에서 만든
-- properties 스키마를 대조하는 과정에서 발견한 GAP을 메운다. 이 필드들은
-- database.md §2 "properties" 원문 필드 목록에 없었다 — 원문을 놓친 것이 아니라
-- 원문 자체가 화면이 실제로 쓰는 필드를 전부 담고 있지 않았음을 이번에 처음
-- 확인했다(STEP 1의 agency_id GAP과 같은 종류의 발견).
--
-- 가장 중요한 발견 — listing_type(매매/임대) 누락:
-- 화면은 매물을 "매매(for_sale)/임대(for_rent)"로 구분해 필터링하고, 가격의
-- 의미 자체가 이 구분에 따라 완전히 달라진다(매매=총액, 임대=월세). 기존
-- properties.status(draft/pending_review/active/sold/off_market/archived)는
-- "등록 진행 상태"를 나타내는 완전히 다른 축이라 이 용도로 대신 쓸 수 없다.
-- 이 둘은 서로 독립적인 두 축이므로(예: 임대 매물도 draft/active 상태를 가짐)
-- status enum에 값을 추가하는 방식이 아니라 별도 컬럼+enum으로 분리한다.
--
-- 그 외 3개 필드(bedrooms/bathrooms/featured/amenities)도 같은 대조 과정에서
-- 발견 — 전부 화면이 이미 실제로 렌더링하는 정보이며 임의로 새로 만드는
-- 기능이 아니다(기존 UI 존중 원칙).
--
-- 이번 STEP 시점에 properties 테이블은 실사용 데이터가 전혀 없는 상태(RLS
-- INSERT는 admin 또는 승인된 agency 멤버만 가능하고, 아직 아무도 매물을
-- 등록한 적이 없음)이므로 listing_type을 기존 행 백필 없이 바로 NOT NULL로
-- 추가할 수 있다.
--
-- 근거 문서: claude/database.md §2(원문에 없던 GAP, 이번 마이그레이션으로 보강),
--            이 세션에서 직접 대조한 app/(tabs)/property.tsx / app/property-detail/[id].tsx
--
-- 이전 마이그레이션: 20260910004541_property_domain_foundation.sql(STEP 02 —
-- properties/property_images/property_documents 등 최초 생성)

-- ============================================================================
-- 1. property_listing_type enum — 매매/임대 구분(신규)
-- ============================================================================

create type public.property_listing_type as enum (
  'for_sale',
  'for_rent'
);

-- ============================================================================
-- 2. properties 컬럼 추가
-- ============================================================================

alter table public.properties
  add column listing_type public.property_listing_type not null,
  add column bedrooms int,
  add column bathrooms int,
  add column featured boolean not null default false,
  add column amenities text[] not null default '{}';

comment on column public.properties.listing_type is
  '매매(for_sale)/임대(for_rent) 구분 — properties.status(등록 진행 상태)와는 독립된 축. price 컬럼의 의미가 이 값에 따라 달라진다: for_sale이면 총 매매가, for_rent이면 currency 기준 월세(1개월 임대료).';

comment on column public.properties.price is
  '통화 단위는 currency 컬럼을 따른다. listing_type=for_sale이면 총 매매 대금, listing_type=for_rent이면 월 임대료(1개월 기준) — 두 경우를 단일 컬럼에 담되 listing_type으로 의미를 구분한다(별도 rent_price 컬럼을 두지 않음, DATABASE.md §2 원문의 단일 price 컬럼 구조를 그대로 유지).';

comment on column public.properties.bedrooms is
  '침실 개수 — 토지/상업시설 등 주거용이 아닌 category에서는 NULL.';

comment on column public.properties.bathrooms is
  '욕실 개수 — bedrooms와 동일한 이유로 nullable.';

comment on column public.properties.featured is
  '추천 매물 캐러셀 노출 여부 — Admin/Agency가 수동으로 큐레이션하는 값(알고리즘 자동 산출 아님). INSERT/UPDATE 권한은 기존 properties RLS 정책(admin 또는 소속 agency, can_manage_agency_property)을 그대로 따른다 — 이 컬럼만을 위한 별도 정책을 추가하지 않는다.';

comment on column public.properties.amenities is
  '옵션/편의시설 자유 태그 배열(수영장, 주차장, 24시간 보안 등) — property_category별 표준화된 사전은 아직 설계되지 않아(향후 필요 시 별도 마이그레이션) 우선 text[]로 시작한다.';

-- listing_type으로 필터링하는 매물 목록 화면(app/(tabs)/property.tsx)의 상태
-- 필터(매매/임대)를 지원하기 위한 인덱스 — 기존 (status, category) 인덱스와
-- 별도로, listing_type 단독 필터도 자주 쓰이므로 추가한다.
create index properties_listing_type_idx on public.properties (listing_type);

-- featured=true인 매물만 뽑는 추천 캐러셀 쿼리를 위한 부분 인덱스(featured=false가
-- 대다수일 것으로 예상되는 값이라 partial index로 크기를 줄인다).
create index properties_featured_idx on public.properties (featured) where featured = true;
