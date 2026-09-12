-- ============================================================================
-- [2026-09-12 사용자 지시] 허위매물 신고
--
-- 매물 상세에서 누구나 신고할 수 있고, 관리자는 MY에서 신고 목록을 본다.
--
-- 로그인한 사용자만 신고할 수 있게 한 이유: 비로그인 신고를 허용하면 경쟁 업체가
-- 같은 매물을 무한히 신고해 목록을 채울 수 있고, 관리자는 어느 신고가 진짜인지
-- 가릴 근거가 없다. 사용자당 매물 1건으로도 제한한다(unique).
-- ============================================================================

create table if not exists public.property_reports (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  -- 접수 → 처리완료. 반려 같은 세부 상태는 운영하면서 필요해지면 늘린다.
  status text not null default 'open' check (status in ('open', 'resolved')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (property_id, reporter_id)
);

comment on table public.property_reports is
  '허위매물 신고. 같은 사람이 같은 매물을 여러 번 신고하지 못하도록 (property_id, reporter_id)를 유일키로 둔다.';

create index if not exists property_reports_status_idx
  on public.property_reports (status, created_at desc);

alter table public.property_reports enable row level security;

-- 신고 접수 — 본인 명의로만.
drop policy if exists "property_reports_insert_own" on public.property_reports;
create policy "property_reports_insert_own"
  on public.property_reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

-- 조회 — 관리자는 전체, 신고자는 자기 신고만(같은 매물을 또 눌렀을 때 "이미 신고함"을
-- 보여 주려면 본인 행을 읽을 수 있어야 한다).
drop policy if exists "property_reports_select" on public.property_reports;
create policy "property_reports_select"
  on public.property_reports for select
  to authenticated
  using (public.is_admin_or_above() or reporter_id = auth.uid());

-- 처리 — 관리자만.
drop policy if exists "property_reports_update_admin" on public.property_reports;
create policy "property_reports_update_admin"
  on public.property_reports for update
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- DELETE policy 없음(deny) — 신고 이력은 지우지 않는다. 처리 결과는 status로 남긴다.

grant select, insert, update on public.property_reports to authenticated;
