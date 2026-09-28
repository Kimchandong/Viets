-- ============================================================================
-- RUN-06 · 테스트용 매물 일괄 등록 (카테고리 8종 × 10건 = 80건)
--
-- 실행 위치: Supabase 대시보드 → SQL Editor
-- 실행 방법: 아래 전체를 붙여넣고 Run. 몇 번을 실행해도 결과는 같다
--            (맨 앞에서 이전 테스트 매물을 지우고 다시 넣는다).
--
-- 왜 마이그레이션이 아닌가: 이건 스키마가 아니라 **데이터**다. 마이그레이션에 넣으면
-- 테스트 매물이 스키마 이력에 영구히 박히고 운영 DB에도 따라 들어간다.
--
-- 지우는 법: 맨 아래 주석의 delete 한 줄만 실행하면 된다.
--
-- 설계(무엇을 테스트할 수 있게 만들었나):
--   · 카테고리 — DB enum 8종을 모두 덮는다(화면 분류 6종이 전부 여기서 나온다)
--   · 지역     — 10개 지역에 하나씩. 지역 필터가 한 건씩 걸리는지 바로 보인다
--   · 거래종류 — 매매 / 임대 / 분양을 번갈아 넣는다
--   · 금액     — 임대는 300만~1.5억(1억 이상 체크박스까지), 매매·분양은 1.5억~100억
--                슬라이더 양 끝과 중간이 모두 걸리도록 흩어 놓았다
-- ============================================================================

-- 이전 테스트 매물 제거 — 제목이 '[TEST]'로 시작하는 것만 지운다.
delete from public.properties where title like '[TEST]%';

with cats(cat, ko, ord) as (
  values
    ('apartment'::public.property_category,  '아파트',     1),
    ('villa'::public.property_category,      '빌라',       2),
    ('townhouse'::public.property_category,  '타운하우스', 3),
    ('land'::public.property_category,       '토지',       4),
    ('office'::public.property_category,     '오피스',     5),
    ('retail'::public.property_category,     '상가',       6),
    ('hotel'::public.property_category,      '호텔',       7),
    ('industrial'::public.property_category, '공장',       8)
),
regions(n, region, lat, lng) as (
  values
    ( 1, 'TP. Hồ Chí Minh', 10.7769, 106.7009),
    ( 2, 'Hà Nội',          21.0278, 105.8342),
    ( 3, 'Hải Phòng',       20.8449, 106.6881),
    ( 4, 'Đà Nẵng',         16.0544, 108.2022),
    ( 5, 'Huế',             16.4637, 107.5909),
    ( 6, 'Cần Thơ',         10.0452, 105.7469),
    ( 7, 'Khánh Hòa',       12.2388, 109.1967),
    ( 8, 'Lâm Đồng',        11.9404, 108.4583),
    ( 9, 'Quảng Ninh',      20.9515, 107.0798),
    (10, 'Bắc Ninh',        21.1861, 106.0763)
),
-- 거래 종류는 1→매매, 2→임대, 3→분양을 번갈아 준다.
kinds(n, listing) as (
  select n,
         (array['for_sale', 'for_rent', 'presale'])[((n - 1) % 3) + 1]::public.property_listing_type
  from generate_series(1, 10) as n
),
-- 금액은 거래 종류별로 자릿수가 다르다(화면의 금액 슬라이더 범위와 같다).
prices(n, rent, sale, presale) as (
  select n,
         (array[3, 7, 12, 18, 25, 35, 50, 70, 95, 150])[n] * 1000000::numeric,
         (array[150, 300, 500, 800, 1200, 2000, 3500, 5000, 7500, 9500])[n] * 1000000::numeric,
         (array[200, 400, 700, 1000, 1500, 2500, 4000, 6000, 8000, 10000])[n] * 1000000::numeric
  from generate_series(1, 10) as n
)
insert into public.properties (
  title, description, description_lang,
  category, listing_type, price, currency,
  area, land_area, building_area, floors, year_built,
  bedrooms, bathrooms, rental_yield, occupancy_rate, rental_income,
  address, region, latitude, longitude,
  status, featured
)
select
  format('[TEST] %s %s — %s', c.ko, g.n, r.region),
  format('테스트용 매물입니다. %s / %s / %s. 지역·금액·거래종류 필터를 확인하려고 만든 데이터이며 실제 매물이 아닙니다.',
         c.ko,
         case k.listing when 'for_rent' then '임대' when 'presale' then '분양' else '매매' end,
         r.region),
  'ko',
  c.cat,
  k.listing,
  case k.listing
    when 'for_rent' then p.rent
    when 'presale'  then p.presale
    else p.sale
  end,
  'VND',
  -- 면적: 카테고리마다 자릿수가 다르다(토지·공장은 넓다).
  case c.cat
    when 'land'       then 200 + g.n * 150
    when 'industrial' then 500 + g.n * 300
    when 'hotel'      then 300 + g.n * 120
    else 40 + g.n * 15
  end,
  case when c.cat in ('land', 'industrial', 'villa', 'townhouse') then 150 + g.n * 120 else null end,
  case when c.cat in ('office', 'retail', 'hotel', 'industrial') then 400 + g.n * 200 else null end,
  case when c.cat = 'land' then null else 1 + (g.n % 12) end,
  case when c.cat = 'land' then null else 1990 + g.n * 3 end,
  -- 침실·욕실은 주거용에만 둔다.
  case when c.cat in ('apartment', 'villa', 'townhouse') then 1 + (g.n % 4) else null end,
  case when c.cat in ('apartment', 'villa', 'townhouse') then 1 + (g.n % 3) else null end,
  -- 수익률·공실률·임대수입은 임대 매물에만.
  case when k.listing = 'for_rent' then round((4 + g.n * 0.3)::numeric, 1) else null end,
  case when k.listing = 'for_rent' then round((70 + g.n * 2.5)::numeric, 2) else null end,
  case when k.listing = 'for_rent' then p.rent else null end,
  format('Quận %s, %s', g.n, r.region),
  r.region,
  -- 같은 지역 안에서도 마커가 겹치지 않게 조금씩 흩어 놓는다.
  r.lat + (c.ord - 4) * 0.012,
  r.lng + (g.n - 5) * 0.012,
  'active'::public.property_status,
  -- 카테고리마다 앞 2건은 추천 매물로 — 홈 '추천' 영역을 채운다.
  g.n <= 2
from cats c
cross join generate_series(1, 10) as g(n)
join regions r on r.n = g.n
join kinds   k on k.n = g.n
join prices  p on p.n = g.n;

-- ── 결과 확인 ───────────────────────────────────────────────────────────────
select
  category::text                                    as 카테고리,
  count(*)                                          as 건수,
  count(*) filter (where listing_type = 'for_sale') as 매매,
  count(*) filter (where listing_type = 'for_rent') as 임대,
  count(*) filter (where listing_type = 'presale')  as 분양,
  count(distinct region)                            as 지역수,
  to_char(min(price), 'FM999,999,999,999')          as 최저가,
  to_char(max(price), 'FM999,999,999,999')          as 최고가
from public.properties
where title like '[TEST]%'
group by category
order by category::text;

-- ── 지울 때 ────────────────────────────────────────────────────────────────
-- delete from public.properties where title like '[TEST]%';
