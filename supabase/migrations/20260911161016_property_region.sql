-- [2026-09-11 사용자 지시 — 4차] 매물에 지역.
--
-- 매물 등록 화면 맨 위에도 투자상품 등록과 같은 지역 선택을 둔다. 지금까지 매물의
-- 지역은 주소 문자열 안에 도시명이 들어 있는지로 추측했다(services/properties.ts의
-- resolveProvince) — 주소를 "Quận 2, TP. Hồ Chí Minh"처럼 적으면 맞지만, 그 표기를
-- 쓰지 않으면 지역 필터에서 빠진다. 고른 값을 그대로 저장해 추측을 없앤다.
--
-- province_id(locations FK)를 쓰지 않는 이유는 locations 테이블이 여전히 비어 있기
-- 때문이다. agencies.region / investment_products.region과 같은 텍스트 목록
-- (constants/mockData.ts MOCK_REGIONS)을 쓴다 — 세 곳이 같은 값을 봐야 지역으로 묶인다.
--
-- 이전 마이그레이션: 20260911160613_translation_usage_periods.sql

alter table public.properties
  add column if not exists region text;

comment on column public.properties.region is
  '매물 지역. 등록 화면에서 고른 값을 그대로 담는다 — 비어 있으면 화면이 주소 문자열에서 추측한다(옛 매물). agencies.region / investment_products.region과 같은 목록을 쓴다.';

create index if not exists properties_region_idx on public.properties (region);
