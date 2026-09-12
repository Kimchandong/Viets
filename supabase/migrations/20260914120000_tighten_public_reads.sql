-- ============================================================================
-- [2026-09-12 RLS 전수 점검] 로그인 없이 읽을 수 있던 두 표를 좁힌다
--
-- 점검 결과 대부분은 문제가 없었다(35개 표 전부 RLS 켜짐, 정책 있는 표에 GRANT 누락
-- 없음, security definer 함수 전부 search_path 고정, to public 권한 잔존 없음).
-- `using (true)`인 정책 다섯 개 중 셋은 의도된 것이다 —
--   · locations / property_categories — 참조 데이터(도시 목록, 카테고리)
--   · property_ad_slots — 순위표는 경쟁 금액이 보여야 성립한다(오버추어 방식, 사용자 결정)
-- 나머지 둘을 여기서 좁힌다.
--
-- 1) payment_settings — **은행명·예금주·계좌번호·QR**이 들어 있고 `to anon`이었다.
--    입금 정보는 원래 남에게 알려 주는 값이지만, 로그인도 하지 않은 쪽이 긁어 갈 수
--    있어야 할 이유는 없다. 계좌 정보가 그대로 노출되면 같은 예금주 이름으로 다른
--    계좌를 안내하는 사칭이 쉬워진다.
--    읽는 화면은 둘뿐이고(payment-info: 업체 계정, admin-payments: 관리자) 둘 다
--    로그인이 필요하다 — authenticated로 좁혀도 잃는 것이 없다.
--
-- 2) agency_permissions — 어느 업체가 어떤 권한을 갖고 있는지가 `to anon`이었다.
--    클라이언트에서 직접 읽는 곳이 없고(권한 판정은 전부 서버 함수가 한다),
--    업체별 권한 구성은 굳이 밖에 보일 정보가 아니다.
--
-- 되돌리기 쉬운 변경이다 — 비로그인 화면에서 이 값이 필요해지면 그때 다시 연다.
-- ============================================================================

drop policy if exists "payment_settings_select_all" on public.payment_settings;

create policy "payment_settings_select_authenticated"
  on public.payment_settings for select
  to authenticated
  using (true);

comment on table public.payment_settings is
  '입금 안내(은행/예금주/계좌/QR)와 요금 설정. 계좌 정보가 들어 있어 로그인한 사용자만 읽는다.';

drop policy if exists "agency_permissions_select_public" on public.agency_permissions;

create policy "agency_permissions_select_authenticated"
  on public.agency_permissions for select
  to authenticated
  using (true);
