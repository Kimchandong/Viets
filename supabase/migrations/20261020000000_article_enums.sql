-- ============================================================================
-- 부동산 정보 자동 수집 — enum 4종
--
-- [2026-10-20] STEP 02. enum만 별도 파일로 둔다.
--
-- 왜 분리하는가: Postgres는 **새 enum 값을 추가한 트랜잭션 안에서 그 값을 쓸 수
-- 없다.** 같은 파일에 테이블 생성까지 넣어도 지금은 통과하지만, 나중에 이 enum에
-- 값을 더하면서 같은 파일을 고치면 그 순간 깨진다. 처음부터 갈라 둔다
-- (20260930000000에서 user_permission_type을 분리한 것과 같은 이유).
--
-- 기존 enum 명명 규칙을 따른다: 소문자 스네이크, 테이블명 단수 + 의미.
-- ============================================================================

-- 정보원의 사용 가능 여부. PENDING·DISABLED는 자동 수집에서 제외한다.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'article_source_status' and n.nspname = 'public'
  ) then
    create type public.article_source_status as enum (
      'verified',   -- 접근 방법과 사용 권한 확인 완료 → 자동 수집 대상
      'pending',    -- 계약·권한 확인 중 → 수집하지 않는다
      'disabled'    -- 접근 오류·계약 종료·약관 금지 → 수집하지 않는다
    );
  end if;
end $$;

-- 콘텐츠를 앱 내부에 저장·표시할 수 있는지. 화면 분기의 근거다.
--
-- AI가 판단해 정하는 값이 **아니다.** 약관·계약·검토된 출처 정책에 따라 사람이
-- 정한다(요구사항 §7). 수집기는 정보원에 설정된 값을 기사에 물려줄 뿐이다.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'article_content_permission' and n.nspname = 'public'
  ) then
    create type public.article_content_permission as enum (
      'internal_allowed',  -- 앱 내부 상세페이지 제공 가능
      'link_only',         -- 원문 외부 브라우저로만. 본문·사진을 복제하지 않는다
      'pending_review',    -- 권한 불명확 → 자동 게시 금지
      'revoked'            -- 권한 철회 → 신규 노출 중단
    );
  end if;
end $$;

-- 기사의 게시 상태.
--
-- 사용자 결정(2026-10-20): **관리자 검토 없이 자동 게시**한다. 그래서 사람이 보는
-- 대기 큐가 없다 — 게이트를 통과하면 published, 못 넘으면 rejected로 남고 화면에
-- 나오지 않는다. rejected는 "사람이 볼 큐"가 아니라 탈락 보관함이다.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'article_status' and n.nspname = 'public'
  ) then
    create type public.article_status as enum (
      'collected',   -- 수집만 됨
      'processing',  -- 분석·번역 중
      'published',   -- 게시됨 (화면에 노출)
      'rejected',    -- 품질 게이트 탈락 (reject_reason에 사유)
      'archived'     -- 만료·원문 삭제·권한 철회로 내려감
    );
  end if;
end $$;

-- 수집 작업의 상태.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'research_job_status' and n.nspname = 'public'
  ) then
    create type public.research_job_status as enum (
      'queued',
      'running',
      'succeeded',
      'failed'
    );
  end if;
end $$;
