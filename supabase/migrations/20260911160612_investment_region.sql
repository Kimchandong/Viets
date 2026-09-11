-- [2026-09-11 사용자 지시 — 4차] 투자상품에 지역.
--
-- 투자상품 등록 폼 맨 위에 지역 선택을 두기로 했는데 investment_products에는 지역을
-- 담을 자리가 없었다. 연계 매물이 있으면 그 매물의 주소에서 지역을 알 수 있지만,
-- 연계 매물은 선택 사항이라 그것만으로는 채워지지 않는다 — 상품 자체의 값으로 둔다.
--
-- 값은 매물 지역 필터·등록신청 폼과 같은 목록(constants/mockData.ts MOCK_REGIONS)을
-- 쓴다. locations 테이블이 여전히 비어 있어 FK 대신 텍스트다.
--
-- 이전 마이그레이션: 20260911153018_settlement_rename.sql

alter table public.investment_products
  add column if not exists region text;

comment on column public.investment_products.region is
  '투자상품 지역. 매물 지역 필터(MOCK_REGIONS) 및 agencies.region과 같은 값을 쓴다 — 세 곳이 같은 목록을 보고 있어야 지역으로 묶어 볼 수 있다.';

create index if not exists investment_products_region_idx on public.investment_products (region);
