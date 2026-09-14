-- 20260916000000_close_public_read_leaks.sql
--
-- [2026-09-14 RLS 전수 재점검] 비로그인(anon)에게 열려 있던 읽기 3곳을 닫는다.
--
-- anon 키는 앱 번들 안에 들어 있다. 즉 "anon에게 열림"은 앱을 받은 누구나, 화면을
-- 거치지 않고 PostgREST로 직접 표 전체를 긁어 갈 수 있다는 뜻이다. 아래 세 표는
-- **앱이 공개 경로에서 읽지 않는데도** 열려 있었다.
--
--   agencies          사업자등록번호 · 담당자명 · 전화 · 주소 · 사업자등록증 파일 경로 ·
--                     반려 사유까지 전 컬럼. 개인정보다.
--   property_ad_slots bid_amount(업체별 클릭 단가)와 agency_id. 남의 입찰가가 보이면
--                     한 단위만 올려 낙찰받을 수 있어 경매가 성립하지 않는다.
--   owners/developers contact.
--
-- 지워도 되는 근거(2026-09-14 코드 전수 확인):
--
--   agencies   — 클라이언트의 agencies 조회는 두 군데뿐이다. services/agencies.ts의
--                listAgencies(관리자 화면)와 getMyAgency(agency_members 경유),
--                그리고 services/payments.ts의 agencies(name) 중첩 조회. 셋 다
--                로그인 상태이며 agencies_select_admin / agencies_select_own_member가
--                이미 덮는다.
--   owners     — services/ app/ components/ 전체에서 참조 0건.
--   developers — 동일.
--   ad_slots   — 홈/부동산의 광고 목록은 표가 아니라 RPC active_ad_slots(security
--                definer, anon 실행 허용)가 property_id만 돌려준다. 표를 직접 읽는
--                곳은 app/ad-slots.tsx(업체 순위표)와 getMyBid뿐이라 로그인 상태다.
--
-- 순위표는 오버추어식 경매라 **입찰가를 서로 보는 것이 설계 의도**다. 그래서
-- ad_slots는 정책을 없애지 않고 대상에서 anon만 뺀다.

begin;

-- 1. agencies — 공개 읽기 제거
drop policy if exists agencies_select_approved_public on public.agencies;

-- 2. owners / developers — 공개 읽기 제거
drop policy if exists owners_select_active_public on public.owners;
drop policy if exists developers_select_active_public on public.developers;

-- 3. property_ad_slots — anon만 제외하고 로그인 사용자에게는 그대로 연다
drop policy if exists ad_slots_select_all on public.property_ad_slots;

create policy ad_slots_select_authenticated
  on public.property_ad_slots
  for select
  to authenticated
  using (true);

comment on table public.property_ad_slots is
  '광고 자리 입찰. 순위표(app/ad-slots.tsx)가 서로의 단가를 보도록 로그인 사용자에게는 전체 공개하되, 비로그인에게는 닫는다. 공개 화면은 active_ad_slots RPC로 property_id만 받는다.';

-- 4. 표 권한 자체도 회수한다(정책이 실수로 다시 생겨도 anon이 못 읽도록).
--    지금은 정책이 없어 결과가 비어 있을 뿐, 권한은 남아 있었다.
revoke select on public.agencies          from anon;
revoke select on public.owners            from anon;
revoke select on public.developers        from anon;
revoke select on public.property_ad_slots from anon;

commit;
