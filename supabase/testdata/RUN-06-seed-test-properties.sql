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
--   · **다국어** — description_i18n에 6개 언어를 직접 넣는다
--
-- [2026-09-28] 다국어를 SQL에 박아 넣은 이유: 앱 등록 경로는 저장 시점에 번역 API를
-- 부르지만, SQL로 직접 넣은 행은 번역이 비어 있다. 그 상태로는 "중국어 화면인데
-- 설명만 한국어"가 데이터 문제인지 화면 문제인지 가릴 수 없다. 번역을 넣어 두면
-- 그래도 한국어가 보일 때 원인이 앱 쪽으로 좁혀진다.
-- ============================================================================

delete from public.properties where title like '[TEST]%';

with cats(cat, ord, ko, vi, en, zh, ja, th) as (
  values
    ('apartment'::public.property_category,  1, '아파트',     'Căn hộ',           'Apartment', '公寓',     'アパート',     'อพาร์ตเมนต์'),
    ('villa'::public.property_category,      2, '빌라',       'Biệt thự',         'Villa',     '别墅',     'ヴィラ',       'วิลล่า'),
    ('townhouse'::public.property_category,  3, '타운하우스', 'Nhà phố',          'Townhouse', '联排别墅', 'タウンハウス', 'ทาวน์เฮาส์'),
    ('land'::public.property_category,       4, '토지',       'Đất nền',          'Land',      '土地',     '土地',         'ที่ดิน'),
    ('office'::public.property_category,     5, '오피스',     'Văn phòng',        'Office',    '写字楼',   'オフィス',     'สำนักงาน'),
    ('retail'::public.property_category,     6, '상가',       'Mặt bằng bán lẻ',  'Retail',    '商铺',     '店舗',         'ร้านค้า'),
    ('hotel'::public.property_category,      7, '호텔',       'Khách sạn',        'Hotel',     '酒店',     'ホテル',       'โรงแรม'),
    ('industrial'::public.property_category, 8, '공장',       'Nhà xưởng',        'Factory',   '厂房',     '工場',         'โรงงาน')
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
kinds(n, listing, ko, vi, en, zh, ja, th) as (
  values
    ( 1, 'for_sale'::public.property_listing_type, '매매', 'Bán',      'For sale', '出售', '売買', 'ขาย'),
    ( 2, 'for_rent'::public.property_listing_type, '임대', 'Cho thuê', 'For rent', '出租', '賃貸', 'เช่า'),
    ( 3, 'presale'::public.property_listing_type,  '분양', 'Mở bán',   'Presale',  '预售', '分譲', 'พรีเซล'),
    ( 4, 'for_sale'::public.property_listing_type, '매매', 'Bán',      'For sale', '出售', '売買', 'ขาย'),
    ( 5, 'for_rent'::public.property_listing_type, '임대', 'Cho thuê', 'For rent', '出租', '賃貸', 'เช่า'),
    ( 6, 'presale'::public.property_listing_type,  '분양', 'Mở bán',   'Presale',  '预售', '分譲', 'พรีเซล'),
    ( 7, 'for_sale'::public.property_listing_type, '매매', 'Bán',      'For sale', '出售', '売買', 'ขาย'),
    ( 8, 'for_rent'::public.property_listing_type, '임대', 'Cho thuê', 'For rent', '出租', '賃貸', 'เช่า'),
    ( 9, 'presale'::public.property_listing_type,  '분양', 'Mở bán',   'Presale',  '预售', '分譲', 'พรีเซล'),
    (10, 'for_sale'::public.property_listing_type, '매매', 'Bán',      'For sale', '出售', '売買', 'ขาย')
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
  title, description, description_lang, description_i18n,
  category, listing_type, price, currency,
  area, land_area, building_area, floors, year_built,
  bedrooms, bathrooms, rental_yield, occupancy_rate, rental_income,
  address, region, latitude, longitude,
  status, featured
)
select
  format('[TEST] %s %s — %s', c.ko, g.n, r.region),
  -- 원문(한국어). description_lang이 'ko'이므로 화면은 한국어 사용자에게 이 문장을 쓴다.
  format('테스트용 매물입니다. %s / %s / %s. 지역·금액·거래종류 필터 확인용 데이터이며 실제 매물이 아닙니다.',
         c.ko, k.ko, r.region),
  'ko',
  -- 나머지 5개 언어. 앱은 description_lang 자리에 원문을 얹고 이 맵에서 나머지를 꺼낸다.
  jsonb_build_object(
    'vi', format('Đây là bất động sản dùng để thử nghiệm. %s / %s / %s. Dữ liệu tạo ra để kiểm tra bộ lọc khu vực, giá và loại giao dịch, không phải bất động sản thật.', c.vi, k.vi, r.region),
    'en', format('This is a test listing. %s / %s / %s. Created to verify the region, price and listing-type filters — not a real property.', c.en, k.en, r.region),
    'zh', format('这是测试房源。%s / %s / %s。用于验证地区、价格和交易类型筛选的数据，并非真实房源。', c.zh, k.zh, r.region),
    'ja', format('テスト用の物件です。%s / %s / %s。地域・価格・取引種別フィルターの確認用データであり、実際の物件ではありません。', c.ja, k.ja, r.region),
    'th', format('นี่คือรายการทดสอบ %s / %s / %s ข้อมูลนี้สร้างขึ้นเพื่อตรวจสอบตัวกรองพื้นที่ ราคา และประเภทการซื้อขาย ไม่ใช่ทรัพย์จริง', c.th, k.th, r.region)
  ),
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
  count(*) filter (where description_i18n ? 'zh')   as 중국어,
  count(*) filter (where description_i18n ? 'ja')   as 일본어
from public.properties
where title like '[TEST]%'
group by category
order by category::text;

-- ── 지울 때 ────────────────────────────────────────────────────────────────
-- delete from public.properties where title like '[TEST]%';
