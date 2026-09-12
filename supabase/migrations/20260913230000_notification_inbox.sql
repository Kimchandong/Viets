-- ============================================================================
-- [2026-09-12] 알림 수신함 — 지나간 알림을 다시 볼 곳
--
-- 지금까지: 앱 안에 알림이 **세 군데**로 흩어져 있었다.
--   · 홈 종 아이콘 배지 — 숫자만 있고 내용이 없다(읽음 기록 방식, user_read_marks)
--   · MY 토스트 — 광고 알림을 화면에 잠깐 띄우고 사라진다(ad_notifications)
--   · 푸시 — 알림창을 지우면 끝이다
-- 셋 다 "지나간 것을 다시 볼 곳"이 없다. 광고비가 소진돼 순위에서 빠졌다는 알림을
-- 놓치면 왜 노출이 멈췄는지 알 방법이 없다.
--
-- 이 파일이 만드는 것:
--   1. user_notifications — 사용자별 알림 목록(수신함)
--   2. notification_preferences — 종류별 켜기/끄기
--   3. notify_user() — 알림을 남기는 단일 통로(설정이 꺼져 있으면 남기지 않는다)
--   4. 알림이 생기는 지점들을 **트리거로** 연결
--
-- 왜 트리거인가: 알림을 남겨야 하는 지점(업체 승인, 충전 승인, QA 답변, 광고 탈락)이
-- 이미 각자의 함수 안에서 동작하고 있다. 그 함수들을 하나씩 다시 쓰면 검증된 코드를
-- 여러 개 건드리게 된다. 트리거는 "상태가 이렇게 바뀌면 알린다"는 사실만 추가하므로
-- 기존 함수는 한 줄도 바뀌지 않는다.
--
-- 문구를 DB에 넣지 않는 이유: 앱은 6개 언어다. 한국어 문장을 저장해 두면 베트남
-- 사용자가 한국어 알림을 읽게 된다. 그래서 **kind(종류)와 params(값)만** 남기고,
-- 문장은 앱이 i18n으로 만든다 — 번역 비용도 들지 않고, 사용자가 언어를 바꾸면 지난
-- 알림까지 함께 바뀐다.
--
-- 푸시는 이 파일의 범위가 아니다. DB는 외부로 발송할 수 없어 엣지 함수가 필요하고,
-- 지금 푸시가 붙어 있는 것은 광고 2종뿐이다(ad-click / ad-bid). 이 표가 쌓이기
-- 시작하면 그 위에 발송을 얹는다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 수신함
-- ---------------------------------------------------------------------------

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 앱이 i18n 키로 쓰는 값. 예: 'ad_balance_empty', 'payment_approved'.
  kind text not null,
  -- 문구에 끼워 넣을 값(금액, 매물명 등). 문장 자체는 앱이 만든다.
  params jsonb not null default '{}'::jsonb,
  -- 누르면 갈 앱 내 경로. 없으면 목록에서 넘어가지 않는다.
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- 같은 사건으로 알림이 반복되지 않게 하는 잠금 키(대화+날짜 등). NULL이면 매번 남긴다.
  dedupe_key text
);

comment on table public.user_notifications is
  '사용자 알림 수신함. 문구가 아니라 kind + params를 저장하고 문장은 앱이 i18n으로 만든다(6개 언어).';

-- 같은 사건 두 번 방지. dedupe_key가 NULL인 행은 이 인덱스에 걸리지 않으므로
-- (Postgres에서 NULL은 서로 같지 않다) 매번 남기고 싶은 알림은 NULL로 둔다.
create unique index if not exists user_notifications_dedupe_idx
  on public.user_notifications (user_id, kind, dedupe_key)
  where dedupe_key is not null;

create index if not exists user_notifications_user_idx
  on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

-- 읽기·읽음표시는 본인만. INSERT 정책은 두지 않는다 — 알림은 notify_user()만 만든다.
-- 클라이언트가 직접 넣을 수 있으면 남의 수신함에 아무 문구나 넣을 수 있다.
drop policy if exists "user_notifications_select_own" on public.user_notifications;
create policy "user_notifications_select_own"
  on public.user_notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_notifications_update_own" on public.user_notifications;
create policy "user_notifications_update_own"
  on public.user_notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 지우기는 본인만. 이력을 남길 이유가 있는 표가 아니다 — 읽고 치우는 목록이다.
drop policy if exists "user_notifications_delete_own" on public.user_notifications;
create policy "user_notifications_delete_own"
  on public.user_notifications for delete
  to authenticated
  using (user_id = auth.uid());

grant select, update, delete on public.user_notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 종류별 켜기/끄기
-- ---------------------------------------------------------------------------
-- 행이 없으면 켜진 것으로 본다(기본 수신). 끈 사람만 행이 생긴다 — 사용자 수만큼
-- 미리 행을 만들어 두면 알림 종류를 하나 늘릴 때마다 전체 사용자에 대해 채워야 한다.

create table if not exists public.notification_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

comment on table public.notification_preferences is
  '알림 종류별 수신 여부. 행이 없으면 수신(기본값)이다 — 끈 사람만 행이 생긴다.';

alter table public.notification_preferences enable row level security;

drop policy if exists "notification_preferences_own" on public.notification_preferences;
create policy "notification_preferences_own"
  on public.notification_preferences for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.notification_preferences to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 알림을 남기는 단일 통로
-- ---------------------------------------------------------------------------
-- security definer인 이유: 알림을 만드는 쪽(관리자, 상대방, 트리거)과 받는 쪽이
-- 다른 사람이다. 호출자 권한으로는 남의 행을 넣을 수 없다. 대신 이 함수는 인자로
-- 받은 사용자에게 한 줄 넣는 일만 하고 아무것도 돌려주지 않는다.

create or replace function public.notify_user(
  p_user_id uuid,
  p_kind text,
  p_params jsonb default '{}'::jsonb,
  p_link text default null,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_kind is null then
    return;
  end if;

  -- 껐으면 남기지 않는다. 끈 알림이 수신함에만 쌓이면 "껐는데 왜 있냐"가 된다.
  if exists (
    select 1 from public.notification_preferences
    where user_id = p_user_id and kind = p_kind and enabled = false
  ) then
    return;
  end if;

  insert into public.user_notifications (user_id, kind, params, link, dedupe_key)
  values (p_user_id, p_kind, coalesce(p_params, '{}'::jsonb), p_link, p_dedupe_key)
  on conflict do nothing;
end;
$$;

revoke all on function public.notify_user(uuid, text, jsonb, text, text) from public;
-- 클라이언트에는 주지 않는다 — 알림은 서버에서 일어난 일의 결과이지 앱이 요청하는 것이 아니다.

comment on function public.notify_user(uuid, text, jsonb, text, text) is
  '알림 한 줄을 남긴다. 수신 설정이 꺼져 있으면 아무것도 하지 않는다. 클라이언트 실행 권한 없음.';

-- ---------------------------------------------------------------------------
-- 4. 알림이 생기는 지점
-- ---------------------------------------------------------------------------

-- 4-1. 광고 알림 — ad_notifications에 이미 쌓이고 있다.
-- 그쪽 함수(charge_ad_click, set_ad_bid)와 엣지 함수는 손대지 않고, 그 표에 행이
-- 생기는 것을 보고 수신함에 옮겨 적는다. 광고 쪽 코드는 한 줄도 바뀌지 않는다.
create or replace function public.mirror_ad_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_user(
    new.user_id,
    case new.kind
      when 'balance_empty' then 'ad_balance_empty'
      when 'slot_dropped' then 'ad_slot_dropped'
      else 'ad_' || new.kind
    end,
    '{}'::jsonb,
    -- 잔액이 비면 충전하러, 자리에서 빠졌으면 다시 순위를 사러 간다.
    case new.kind when 'balance_empty' then '/payment-info' else '/ad-manage' end,
    new.dedupe_key
  );
  return new;
end;
$$;

drop trigger if exists ad_notifications_mirror on public.ad_notifications;
create trigger ad_notifications_mirror
  after insert on public.ad_notifications
  for each row
  execute function public.mirror_ad_notification();

-- 4-2. 업체 승인 / 반려
create or replace function public.notify_agency_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if new.approval_status is not distinct from old.approval_status then
    return new;
  end if;
  if new.approval_status not in ('approved', 'rejected') then
    return new;
  end if;

  select m.user_id into v_owner
  from public.agency_members m
  where m.agency_id = new.id
    and m.status = 'active'
    and m.role_in_agency = 'owner'
  order by m.created_at asc
  limit 1;

  perform public.notify_user(
    v_owner,
    case new.approval_status when 'approved' then 'agency_approved' else 'agency_rejected' end,
    jsonb_build_object('agency', new.name, 'reason', coalesce(new.rejection_reason, '')),
    '/my',
    new.id::text || ':' || new.approval_status
  );
  return new;
end;
$$;

drop trigger if exists agencies_notify_review on public.agencies;
create trigger agencies_notify_review
  after update of approval_status on public.agencies
  for each row
  execute function public.notify_agency_review();

-- 4-3. 광고비 충전 승인 / 반려
-- 신청한 사람에게 알린다(업체 대표가 아니라) — 기다리고 있는 사람이 그 사람이다.
create or replace function public.notify_payment_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status::text not in ('approved', 'rejected') then
    return new;
  end if;

  perform public.notify_user(
    new.requested_by,
    case new.status::text when 'approved' then 'payment_approved' else 'payment_rejected' end,
    jsonb_build_object('amount', new.amount, 'reason', coalesce(new.reject_reason, '')),
    '/payment-info',
    new.id::text || ':' || new.status::text
  );
  return new;
end;
$$;

drop trigger if exists payment_requests_notify_review on public.payment_requests;
create trigger payment_requests_notify_review
  after update of status on public.payment_requests
  for each row
  execute function public.notify_payment_review();

-- 4-4. QA 답변
create or replace function public.notify_qa_answered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'qa' then
    return new;
  end if;
  -- 답변이 "없다 → 있다"로 바뀐 순간만. 관리자가 답변을 고칠 때마다 알리지 않는다.
  if coalesce(old.answer_body, '') <> '' or coalesce(new.answer_body, '') = '' then
    return new;
  end if;

  perform public.notify_user(
    new.author_id,
    'qa_answered',
    jsonb_build_object('title', new.title),
    '/boards',
    new.id::text
  );
  return new;
end;
$$;

drop trigger if exists board_posts_notify_answer on public.board_posts;
create trigger board_posts_notify_answer
  after update of answer_body on public.board_posts
  for each row
  execute function public.notify_qa_answered();

-- 4-5. 허위매물 신고 처리
-- 신고한 사람에게 결과를 알린다 — 신고만 받고 아무 말이 없으면 다시 신고하게 된다.
create or replace function public.notify_report_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'resolved' or old.status = 'resolved' then
    return new;
  end if;

  perform public.notify_user(
    new.reporter_id,
    'report_resolved',
    '{}'::jsonb,
    null,
    new.id::text
  );
  return new;
end;
$$;

drop trigger if exists property_reports_notify_resolved on public.property_reports;
create trigger property_reports_notify_resolved
  after update of status on public.property_reports
  for each row
  execute function public.notify_report_resolved();

-- ---------------------------------------------------------------------------
-- 5. 안 읽은 개수
-- ---------------------------------------------------------------------------
-- invoker(기본) 권한으로 둔다 — 무엇이 내게 보이는지는 이미 RLS가 정한다. 그 판단을
-- 함수에 다시 적으면 어긋나는 순간 남의 알림 수가 샌다(20260911171500과 같은 이유).

create or replace function public.my_unread_notification_count()
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.user_notifications
  where read_at is null;
$$;

grant execute on function public.my_unread_notification_count() to authenticated;
