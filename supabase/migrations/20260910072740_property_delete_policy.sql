-- STEP 04 — 매물 삭제 정책.
--
-- 사용자 결정(2026-09-10): "기본은 소프트 삭제(status='archived'), admin만 하드 삭제".
--
-- 소프트 삭제는 기존 UPDATE 정책(properties_update_admin / properties_update_agency)으로
-- 이미 가능하다 — status를 'archived'로 바꾸면 Public-Read 정책(status='active'만 허용)에
-- 걸려 목록/검색/상세에서 사라진다. 반면 **하드 삭제는 아예 불가능했다** — STEP 02
-- 원본 migration에 properties DELETE 정책이 없었기 때문이다(정책 없음 = RLS 기본 거부).
--
-- 이 migration은 admin 계열에만 하드 삭제를 허용한다. Agency 소속 계정에는 주지 않는다 —
-- 하드 삭제는 되돌릴 수 없고, 삭제 시 property_images/property_documents가 함께 cascade
-- 삭제되며(STEP 02 FK 정의), 상담 이력·찜 등 다른 도메인이 참조하던 매물이 사라진다.
-- Agency는 소프트 삭제(archived)까지만 가능하다.

create policy "properties_delete_admin"
  on public.properties for delete
  to authenticated
  using ( public.is_admin_or_above() );

-- ⚠️ GRANT 필수(2026-09-10 규칙): 정책만으로는 권한이 생기지 않는다.
-- STEP 02c(20260910061326)에서 properties에는 delete 정책이 없어 grant도 하지 않았다.
grant delete on public.properties to authenticated;
