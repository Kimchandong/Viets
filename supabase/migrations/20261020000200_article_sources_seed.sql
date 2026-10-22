-- ============================================================================
-- 정보원 등록 — STEP 01 검증 결과를 그대로 반영
--
-- [2026-10-20] 테스트 데이터가 아니라 **운영 기준 데이터**라 마이그레이션에 둔다.
-- 수집 엔진이 이 행들을 전제로 동작하므로 없으면 아무것도 돌지 않고, 새 환경에서는
-- db push만으로 같은 상태가 되어야 한다. (테스트 매물처럼 지워도 되는 데이터는
-- supabase/testdata/RUN-*.sql로 따로 둔다.)
--
-- 아래 값은 전부 2026-10-20에 실제 피드를 조회해 확인한 것이다
-- (REALTY_AI_API_INVENTORY.md). 추정한 값은 없다.
--
-- 멱등: domain이 유일키라 on conflict do nothing. 여러 번 실행해도 안전하다.
-- 이미 등록된 출처의 설정을 사람이 관리자 화면에서 바꿨을 수 있으므로
-- **덮어쓰지 않는다**(do nothing, do update 아님).
--
-- 이전 마이그레이션: 20261020000100_article_tables.sql
-- ============================================================================

insert into public.article_sources (
  name, domain, homepage_url, source_type, access_method, feed_url,
  content_permission, permission_note, trust_score, status, language, daily_limit
) values

-- ── 검증 완료 — 자동 수집 대상 ──────────────────────────────────────────────

-- 공급량 1위. 1회 조회 50건이 전부 같은 날짜였다(약 50건/일).
-- 약관에 복제 금지 문구가 없고 출처 표기만 요구해, 세 곳 중 유일하게 내부 저장이
-- 가능하다. 그래도 본문 전문은 저장하지 않는다 — 피드가 주는 요약까지만.
(
  'CafeF', 'cafef.vn', 'https://cafef.vn', 'news', 'rss',
  'https://cafef.vn/bat-dong-san.rss',
  'internal_allowed',
  '2026-10-20 확인: 복제 금지 문구 없음, 출처 표기만 요구("ghi rõ nguồn"). 하위 피드 thi-truong / tin-tuc-du-an 등 추가 가능.',
  0.85, 'verified', 'vi', 5
),

-- 지연 0일(조회 시각과 같은 날 08:00 기사). 약 14건/일.
-- 상업적 복제·배포·출판은 사전 서면 허가가 필요하다 → 링크만.
(
  'VnExpress', 'vnexpress.net', 'https://vnexpress.net', 'news', 'rss',
  'https://vnexpress.net/rss/bat-dong-san.rss',
  'link_only',
  '2026-10-20 확인: 상업적 복제·배포·출판에 사전 서면 허가 필요. 이미지는 enclosure와 본문 img에 같은 1장이 중복 제공됨.',
  0.95, 'verified', 'vi', 4
),

-- 지연 0일이지만 생산량이 적다(약 2건/일). 10건을 채우는 보조 출처다.
-- 서면 허가 없는 복제 금지 + 출처 표기 의무 → 링크만.
(
  'Thanh Niên', 'thanhnien.vn', 'https://thanhnien.vn', 'news', 'rss',
  'https://thanhnien.vn/rss/kinh-te/dia-oc.rss',
  'link_only',
  '2026-10-20 확인: 서면 허가 없는 복제 금지, 재사용 시 출처 표기 의무.',
  0.90, 'verified', 'vi', 3
),

-- ── 확인 중 — 수집에서 제외된다(status=pending) ─────────────────────────────

-- 신뢰도는 가장 높지만 월·분기 발행이라 일일 공급원이 아니다. RSS가 없어
-- HTML을 읽어야 하므로 수집기 1차 범위를 넘는다. 등록만 해 둔다.
-- 자체 생산물(보도자료·통계표)은 출처 표기 조건으로 내부 저장이 가능해 보이나,
-- /tin-tuc-khac/ 섹션은 타 매체 전재물이라 권한이 다르다 → 건별 재판정 필요.
(
  'Cục Thống kê (통계청)', 'nso.gov.vn', 'https://www.nso.gov.vn', 'government', 'manual',
  'https://www.nso.gov.vn/dau-tu-va-xay-dung/',
  'pending_review',
  '2026-10-20 확인: gso.gov.vn에서 도메인 이전. RSS 없음, PX-Web 통계DB 존재(API 미검증). 월·분기 발행. 자체 생산물은 출처 표기 조건부 전재 가능으로 읽히나 전재 기사 섹션은 별도 판정 필요.',
  1.00, 'pending', 'vi', 2
),

-- 법정 공표 주소(Nghị định 357/2025 제35조)인데 robots.txt가 루트 외 모든 경로의
-- 자동 조회를 금지한다. 우회하지 않는다 → disabled.
(
  'Bộ Xây dựng 부동산시장 정보시스템', 'batdongsan.xaydung.gov.vn',
  'https://batdongsan.xaydung.gov.vn', 'government', 'manual', null,
  'pending_review',
  '2026-10-20 확인: robots.txt가 루트 외 전 경로 자동 수집 금지. 공개 루트 지표도 2024 Q1에서 멈춰 있었다. 수집 허용 문의 필요.',
  1.00, 'disabled', 'vi', 1
)

on conflict (domain) do nothing;

-- ── 출처별 상한의 합이 일일 상한을 넘도록 설정을 맞춘다 ─────────────────────
--
-- 출처별 daily_limit 합이 12(5+4+3)이고 전체 상한이 10이다. 전체 상한이 먼저
-- 걸리는 것이 의도다 — 특정 출처가 조용히 죽어도 나머지가 10건을 채운다.
--
-- per_source_limit의 기본값이 3이었는데, 그러면 CafeF 5를 3으로 깎아 최대 9건이
-- 되어 10건 목표에 못 미친다. 수집기는 min(출처.daily_limit, per_source_limit)을
-- 쓰므로 이 값을 5로 올린다.
update public.article_publish_settings
   set per_source_limit = 5,
       updated_at = now()
 where id = true
   and per_source_limit < 5;

-- ── 확인 ────────────────────────────────────────────────────────────────────
select
  name                          as 출처,
  domain                        as 도메인,
  status::text                  as 상태,
  content_permission::text      as 권한,
  trust_score                   as 신뢰도,
  daily_limit                   as 일일상한,
  access_method                 as 방식
from public.article_sources
order by status::text, trust_score desc;
