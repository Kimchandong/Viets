-- [2026-09-11] 앞선 마이그레이션(20260911131529_property_created_by.sql)의 백필을 바로잡는다.
--
-- 무엇을 잘못했나:
-- created_by를 도입하면서 기존 행의 등록자를 "제목에 '테스트 매물'이 들어가면 teststore"
-- 라는 규칙으로 채웠다. 근거가 제목뿐인 추측이었고, 실제로는 정확히 반대였다 —
--
--   · 제목에 '테스트 매물'이 든 3건: 2026-09-10 06시 생성. teststore 계정은 2026-09-11에
--     만들었으므로 그 계정이 등록했을 수가 없다.
--   · 'Vinhomes Harmony': 2026-09-11 11:50:36 생성 — teststore로 등록한 실제 매물인데,
--     created_by 컬럼이 그날 13시에 생겼으므로 비어 있었다.
--
-- 이번에는 추측하지 않는다. 근거는 **사진 업로더**다: storage.objects.owner는 파일을
-- 올린 계정을 실제로 기록하고 있고(Vinhomes Harmony의 사진 3장은 11:50:35에
-- teststore가 업로드 — 매물 생성 1초 전), 매물 사진은 등록 화면에서 그 매물을 등록하는
-- 사람이 올린다. 사진이 없는 매물은 추정할 근거가 없으므로 NULL로 남긴다
-- (= 관리자에게만 보인다).
--
-- 이전 마이그레이션: 20260911131529_property_created_by.sql

-- ============================================================================
-- 1. 잘못 붙인 백필 되돌리기
-- ============================================================================
--
-- 계정이 만들어지기 전에 생성된 매물을 그 계정 것으로 둘 수는 없다. 시각 비교로
-- 좁히므로, 나중에 teststore가 실제로 등록한 매물(계정 생성 이후)은 건드리지 않는다.

update public.properties as p
set created_by = null
from auth.users as u
where p.created_by = u.id
  and p.created_at < u.created_at;

-- ============================================================================
-- 2. 사진 업로더로 등록자 채우기
-- ============================================================================
--
-- property_images.url은 공개 URL이라 버킷 내부 경로(storage.objects.name)가 그 안에
-- 들어 있다 — `.../object/public/property-images/uploads/xxx.jpeg`. 그 뒤쪽을 잘라
-- storage.objects와 맞춘다. 사진이 여러 장이면 대표 사진(sort_order가 가장 작은 것)의
-- 업로더를 쓴다 — 한 매물의 사진은 한 사람이 한 화면에서 올리므로 어느 것을 골라도
-- 같지만, 결과가 매번 같아야 하므로 순서를 고정한다.

update public.properties as p
set created_by = src.owner
from (
  select distinct on (i.property_id)
         i.property_id,
         o.owner
  from public.property_images as i
  join storage.objects as o
    on o.bucket_id = 'property-images'
   and o.name = split_part(i.url, '/object/public/property-images/', 2)
  where o.owner is not null
  order by i.property_id, i.sort_order nulls last
) as src
where src.property_id = p.id
  and p.created_by is null;
