-- ============================================================================
-- [2026-09-12 웹 검증에서 발견] 클릭 과금이 한 번도 일어나지 않고 있었다
--
-- 증상: 광고 자리를 사고 홈·부동산에 노출까지 되는데, 고객이 눌러도 잔액이 1원도
-- 줄지 않았다. 화면만 보면 정상이라 더 위험했다 — 광고주는 노출되고 있다고 믿고,
-- 플랫폼은 돈을 받지 못한다.
--
-- 원인: 20260912150000이 charge_ad_click을 다시 만들면서
--     revoke all on function ... from public, anon, authenticated;
-- 만 하고 **service_role에 execute를 주지 않았다.** 주석에는 "엣지 함수 ad-click
-- 전용(service_role)"이라고 적어 두고 정작 그 권한을 빼먹은 것이다.
--
-- 그 결과 ad-click이 service_role로 RPC를 부를 때마다 permission denied가 났는데,
-- 엣지 함수가 과금 실패를 200 + charged:0으로 삼키도록 만들어져 있어(고객의 화면
-- 이동을 막지 않으려는 의도) 앱에도, 콘솔에도 아무 흔적이 남지 않았다.
--
-- set_ad_bid가 멀쩡했던 이유는 반대다 — 그쪽은 authenticated에 권한을 주고
-- 호출자의 JWT로 실행한다. 권한을 준 쪽만 동작했다.
--
-- 교훈: security definer 함수에서 revoke를 쓸 때는 **누가 부를 것인지**를 같은
-- 자리에 적는다. 부를 사람에게 grant하지 않은 revoke는 기능을 조용히 끄는 것과 같다.
-- ============================================================================

grant execute on function public.charge_ad_click(uuid, text, text, uuid) to service_role;

comment on function public.charge_ad_click(uuid, text, text, uuid) is
  '광고 클릭 과금 — 엣지 함수 ad-click 전용. service_role에만 execute를 준다(앱에서 직접 부를 수 없다: IP 해시와 조회자 id를 서버가 정해야 위조되지 않는다).';

-- ----------------------------------------------------------------------------
-- 같은 부류 점검 — service_role이 부르는데 권한이 없는 함수가 더 있는지
-- ----------------------------------------------------------------------------
-- notify_user와 agency_available_internal도 public에서 revoke돼 있지만, 둘 다
-- **다른 security definer 함수(트리거 포함) 안에서만** 불린다. 그 함수들은 소유자
-- 권한으로 실행되므로 호출자 권한과 무관하다 — 여기서 손댈 것이 없다.
--
-- register_push_token / set_ad_bid / active_ad_slots는 각각 authenticated 또는
-- anon에게 execute가 있고, 실제로 그 권한으로 불린다.
