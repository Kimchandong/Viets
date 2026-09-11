-- STEP 02d — profiles / user_roles / agency 계열 / audit_logs 테이블 GRANT 누락 수정.
--
-- 증상(2026-09-11 실기기 QA에서 발견): admin role을 가진 계정으로 로그인해도 MY탭에
-- "운영"(매물 등록 / 투자상품 등록 / 계정 권한 관리 / 번역 사용량) 섹션이 아예 보이지
-- 않았다. 화면이 없어서가 아니라, services/roles.ts의 fetchMyRoles()가
--   select role from public.user_roles
-- 를 실행하는 순간 `permission denied for table user_roles`로 거부되어 빈 배열이
-- 돌아왔고, my.tsx의 `canRegister || canManageInvest || isAdminUser` 조건이 전부
-- false가 되어 섹션 전체가 렌더되지 않은 것이다.
--
-- 원인: Postgres의 RLS는 2단 구조다 — 테이블 GRANT가 먼저 통과해야 그 다음에 정책이
-- 행을 걸러낸다. GRANT가 없으면 정책이 아무리 잘 쓰여 있어도 전면 거부된다. Supabase는
-- 프로젝트 생성 시점의 테이블에만 기본 권한을 걸어주고, 그 뒤 migration으로 만든
-- 테이블에는 걸어주지 않는다.
--
-- **같은 부류의 세 번째 재발이다.**
--   1회차 2026-09-09 — 채팅 테이블 (20260909090000_grant_chat_table_privileges.sql)
--   2회차 2026-09-10 — Property 도메인 (20260910061326_grant_property_domain_table_privileges.sql)
--   3회차 2026-09-11 — 이 파일 (가장 먼저 만들어진 테이블들이 마지막까지 남아 있었다)
-- 앞의 두 번은 새로 만든 테이블을 고쳤을 뿐, 2026-08-28/09-01에 만들어진 기존
-- 테이블은 점검하지 않았다. 이번에 `information_schema.table_privileges`를 전수
-- 조회해 GRANT가 없는 테이블 6개를 찾아 한 번에 정리한다.
--
-- 권한은 각 테이블에 실제로 존재하는 정책의 `to` 절과 정확히 맞춘다 — GRANT는
-- "정책 심사를 받을 자격"일 뿐이고, 누가 어떤 행을 보는지는 정책이 결정한다.
-- (예: user_roles에 authenticated SELECT를 줘도 user_roles_select_own 정책 때문에
--  각자 자기 role만 보인다.)

-- ---------------------------------------------------------------------------
-- 1. profiles — 본인 행만 조회/수정 (profiles_select_own / profiles_update_own)
-- ---------------------------------------------------------------------------
-- INSERT는 주지 않는다: 가입 시 handle_new_user() 트리거(SECURITY DEFINER)가 만든다.
-- DELETE도 주지 않는다: 계정 삭제는 auth.users에서 cascade된다.
grant select, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. user_roles — 본인 role 조회 + super_admin의 부여/변경/회수
-- ---------------------------------------------------------------------------
-- INSERT/UPDATE/DELETE 정책은 super_admin만 통과시키므로, GRANT를 줘도 일반
-- 사용자가 자기 role을 admin으로 올릴 수 없다(정책이 막는다).
grant select, insert, update, delete on public.user_roles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. agencies — 승인된 업체는 공개, 소속/관리자는 그 외까지
-- ---------------------------------------------------------------------------
grant select on public.agencies to anon;
grant select, insert, update on public.agencies to authenticated;

-- ---------------------------------------------------------------------------
-- 4. agency_members — 본인/소유자/관리자 조회, 관리자 편집
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.agency_members to authenticated;

-- ---------------------------------------------------------------------------
-- 5. agency_permissions — 기능 권한 노출은 공개(업체 카드에서 chat 가능 여부 등 표시)
-- ---------------------------------------------------------------------------
grant select on public.agency_permissions to anon;
grant select, insert, update, delete on public.agency_permissions to authenticated;

-- ---------------------------------------------------------------------------
-- 6. audit_logs — super_admin 조회 전용
-- ---------------------------------------------------------------------------
-- INSERT를 주지 않는 이유: 감사 로그는 서버(트리거/Edge Function)가 남기는 것이고,
-- 클라이언트가 직접 쓸 수 있으면 기록을 위조할 수 있다.
grant select on public.audit_logs to authenticated;
