-- STEP 05b — 투자상품 화면-DB GAP 보강.
--
-- app/(tabs)/invest.tsx의 카테고리 필터(constants/mockImages.ts의 InvestImageCategory
-- 7종: land/building/commercial/residential/industrial/warehouse/other)에 대응하는
-- 컬럼이 investment_products에 없었다. product_type(reit_share/co_investment/fund/
-- bond_like)은 "상품 구조"를 나타내는 완전히 다른 축이라 대체할 수 없다.
--
-- STEP 02b(properties에 listing_type 등 5개 컬럼 추가)와 동일한 성격의 보강이다.

create type public.investment_category as enum (
  'land',
  'building',
  'commercial',
  'residential',
  'industrial',
  'warehouse',
  'other'
);

alter table public.investment_products
  add column category public.investment_category not null default 'other';

comment on column public.investment_products.category is
  '투자상품의 대상 자산 유형(화면 카테고리 필터용). product_type(상품 구조: REIT 지분/공동투자/펀드 등)과는 독립된 축이다 — 예: category=residential + product_type=reit_share. 기본값 other는 기존 행 보존용이며, 등록 화면에서는 항상 명시적으로 선택한다.';

create index investment_products_category_idx on public.investment_products (category);
