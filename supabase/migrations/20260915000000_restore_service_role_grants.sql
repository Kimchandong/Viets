-- ============================================================================
-- [2026-09-12] service_role의 테이블 권한 복구 — **푸시 알림이 전혀 가지 않던 원인**
--
-- 증상: 업체가 입금을 신고하면 관리자 수신함에는 알림이 정상으로 쌓이는데
-- (트리거가 만든다) 푸시는 한 건도 가지 않았다. send-push 로그에 남은 것은
-- 한 줄이었다:
--
--   [send-push] lookup failed: permission denied for table user_notifications
--
-- 원인: public 스키마의 **모든 테이블(35개)** 에서 service_role의
-- SELECT/INSERT/UPDATE/DELETE가 빠져 있었다. 앞선 마이그레이션들이 공개 노출을
-- 좁히려고 `revoke ... from public`을 걸었는데, service_role이 상속받아 쓰던 권한이
-- 그 public 권한이었다. RLS를 우회하는 역할이라 "권한이 없다"는 생각을 못 했지만,
-- RLS 우회와 테이블 GRANT는 서로 다른 층이다 — GRANT가 없으면 RLS까지 가지도 못한다.
--
-- 이 결함은 엣지 함수(service_role로 도는 코드) 전부에 걸쳐 있었다. 앱은
-- authenticated로 돌아 권한이 남아 있었기 때문에 화면상으로는 멀쩡해 보였고,
-- 그래서 실기기 테스트 전까지 드러나지 않았다.
--
-- charge_ad_click의 service_role EXECUTE 누락(20260914150000)과 같은 종류의 사고다.
-- 그때는 함수 하나였고 이번에는 테이블 전체였다.
--
-- default privileges까지 함께 되돌린다 — 앞으로 만들 테이블에서 같은 일이
-- 반복되지 않게 하기 위해서다. 이것이 Supabase의 기본 상태이며, service_role 키는
-- 서버(엣지 함수)에서만 쓰이므로 공개 노출과는 무관하다.
-- ============================================================================

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;
