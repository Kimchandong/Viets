-- STEP 04 화면 검증 중 발견: 20260910004541_property_domain_foundation.sql이 RLS
-- POLICY는 만들었지만 테이블 자체에 대한 GRANT(base table privilege)를 anon/
-- authenticated에 내주지 않았다. Postgres RLS는 "GRANT로 기본 접근 자체가 허용된
-- 상태에서 어느 행을 볼 수 있는지"를 거르는 것이라, 밑에 깔린 GRANT가 없으면
-- 정책과 무관하게 "permission denied for table properties"로 전부 거부된다 —
-- 2026-09-09 property_conversations/property_messages GRANT 누락 버그
-- (20260909090000_grant_chat_table_privileges.sql)와 정확히 동일한 패턴이 Property
-- Domain 7개 테이블에도 재발했다. 각 GRANT의 to 대상/verb는 원본 migration의
-- create policy ... to ... 절과 정확히 일치시켰다(과다 권한 부여 금지, RLS가 최종
-- 방어선).

grant select on public.locations to anon, authenticated;
grant insert, update, delete on public.locations to authenticated;

grant select on public.developers to anon, authenticated;
grant insert, update, delete on public.developers to authenticated;

grant select on public.owners to anon, authenticated;
grant insert, update, delete on public.owners to authenticated;

grant select on public.property_categories to anon, authenticated;
grant insert, update, delete on public.property_categories to authenticated;

-- properties: delete policy가 원본 migration에 없다(관리자도 하드 삭제 대신
-- status='archived'로 소프트 삭제하는 설계로 추정) — delete는 grant하지 않는다.
grant select on public.properties to anon, authenticated;
grant insert, update on public.properties to authenticated;

grant select on public.property_images to anon, authenticated;
grant insert, update, delete on public.property_images to authenticated;

-- property_documents: Public-Read이 아니라 Auth-Read(로그인 필요)로 설계됨
-- (원본 migration property_documents_select_active_auth 정책이 "to authenticated"만
-- 지정) — anon에는 select도 주지 않는다.
grant select, insert, update, delete on public.property_documents to authenticated;
