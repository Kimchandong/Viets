-- [2026-10-22 사용자 지시] 부동산 정보(기사) 북마커.
--
-- 새 표를 만들지 않는다. favorites는 이미 (user_id, target_type, target_id) 폴리모픽
-- 구조라 'article'만 허용 목록에 더하면 된다 — 북마크 로직·RLS·스토어를 그대로 쓴다.
--
-- CHECK 제약은 값을 덧붙일 수 없어 drop 후 재생성한다
-- (20260929000000에서 dividend_frequency에 쓴 방식과 같다).

alter table public.favorites
  drop constraint if exists favorites_target_type_check;

alter table public.favorites
  add constraint favorites_target_type_check
  check (target_type in ('property', 'investment_product', 'article'));

comment on constraint favorites_target_type_check on public.favorites is
  '[2026-10-22] article 추가 — 홈 Ai BĐS 리스트의 북마커가 이 표를 쓴다.';
