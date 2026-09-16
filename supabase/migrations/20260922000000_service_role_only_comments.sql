-- ============================================================================
-- [2026-09-16 확정-결정사항 12] 정책이 0개인 표에 그 이유를 적어 둔다
--
-- translation_cache와 ad_click_log는 RLS 정책이 하나도 없다. 정책 0개 = 일반
-- 사용자(anon/authenticated)가 이 표를 **아예 읽지 못한다**는 뜻이다. 동작에는
-- 문제가 없다 — 엣지 함수가 service_role로 접근하고, service_role은 RLS를 비켜간다.
--
-- 사용자 결정: 동작은 그대로 두고 **의도를 명시한다.**
--
-- 왜 주석이 필요한가: 2단계 감사에서 이 두 표를 보고 "정책이 빠진 것 아닌가" 하고
-- 멈췄다. 다음 사람도 같은 자리에서 멈춘다 — 그리고 "빠졌으니 채우자"며 select
-- 정책을 붙일 수 있다. 그 순간 번역 캐시(원문·번역문 전체)와 광고 클릭 기록
-- (IP 해시·과금액)이 열린다. 비어 있는 것이 의도라는 사실이 표에 붙어 있어야 한다.
--
-- 이 마이그레이션은 데이터도 권한도 바꾸지 않는다. comment만 단다.
-- ============================================================================

comment on table public.translation_cache is
  '번역 캐시. **RLS 정책을 일부러 두지 않았다** — 엣지 함수(translate)가 service_role로만 접근한다. 정책을 추가하면 원문·번역문 전체가 열린다. 앱은 이 표를 직접 읽지 않는다.';

comment on table public.ad_click_log is
  '광고 클릭 기록(과금 근거). **RLS 정책을 일부러 두지 않았다** — 엣지 함수(ad-click) → charge_ad_click(security definer)만 쓴다. 정책을 추가하면 IP 해시와 업체별 과금액이 열린다. 앱은 이 표를 직접 읽지 않는다.';

-- 확인용: 아래가 0행이면 두 표의 정책은 여전히 없다(의도한 상태).
--
--   select tablename, count(*) from pg_policies
--   where schemaname = 'public'
--     and tablename in ('translation_cache', 'ad_click_log')
--   group by tablename;
