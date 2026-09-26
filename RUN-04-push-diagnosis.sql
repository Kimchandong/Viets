-- ============================================================================
-- RUN-04 · 푸시알림 실제 동작 여부 진단
--
-- 실행 위치: Supabase 대시보드 → SQL Editor (읽기 전용 — 아무것도 바꾸지 않는다)
-- 실행 방법: 아래 전체를 붙여넣고 Run. 결과가 6개 표로 나온다.
--
-- 판정 기준(요약):
--   [A] push_tokens 0건  → 푸시가 나갈 곳이 없다. 앱이 토큰을 등록하지 못한 것.
--   [B] pushed_at 전부 NULL → 수신함에는 쌓이는데 푸시가 한 번도 안 나갔다.
--   [C] 트리거/함수 누락  → 알림 자체가 안 만들어진다.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- [A] 등록된 푸시 토큰 — 여기가 0이면 그 뒤는 볼 것도 없다
--
-- Expo 토큰은 **실기기 + 알림 권한 허용**에서만 발급된다. 웹 미리보기·에뮬레이터는
-- services/push.ts가 아예 시도하지 않는다(Device.isDevice 검사).
-- ────────────────────────────────────────────────────────────────────────────
select
  'A. 푸시 토큰'                                        as 구분,
  count(*)                                              as 토큰수,
  count(distinct user_id)                               as 사용자수,
  count(*) filter (where platform = 'android')          as 안드로이드,
  count(*) filter (where platform = 'ios')              as ios,
  count(*) filter (where lang is null)                  as 언어없음,
  count(*) filter (where token like 'ExponentPushToken%') as 정상형식,
  max(updated_at)                                       as 최근등록
from public.push_tokens;


-- ────────────────────────────────────────────────────────────────────────────
-- [B] 수신함 적재 vs 실제 발송 — 핵심 표
--
-- pushed_at이 채워지는 유일한 경로는 send-push 엣지 함수가 Expo 발송에 성공했을 때다
-- (supabase/functions/send-push/index.ts). 그러므로:
--   알림수 > 0 이고 푸시성공 = 0  →  푸시가 한 번도 나가지 않았다.
-- ────────────────────────────────────────────────────────────────────────────
select
  'B. 종류별 발송'                          as 구분,
  kind                                      as 알림종류,
  count(*)                                  as 알림수,
  count(*) filter (where pushed_at is not null) as 푸시성공,
  count(*) filter (where pushed_at is null)     as 푸시안됨,
  min(created_at)                           as 최초,
  max(created_at)                           as 최근
from public.user_notifications
group by kind
order by max(created_at) desc;


-- ────────────────────────────────────────────────────────────────────────────
-- [C] 알림을 만드는 장치가 다 붙어 있는지 — 트리거 7개 + 함수
--
-- 하나라도 빠지면 그 종류는 수신함에도 안 들어온다.
-- ────────────────────────────────────────────────────────────────────────────
select
  'C. 트리거'                                as 구분,
  expected.name                              as 이름,
  case when t.tgname is null then '없음 ❌' else '있음' end as 상태
from (values
  ('ad_notifications_mirror'),
  ('agencies_notify_review'),
  ('agencies_notify_applied'),
  ('payment_requests_notify_review'),
  ('payment_requests_notify_requested'),
  ('board_posts_notify_answer'),
  ('property_reports_notify_resolved')
) as expected(name)
left join pg_trigger t
  on t.tgname = expected.name and not t.tgisinternal
order by 3, 2;

select
  'C. 함수'                                  as 구분,
  expected.name                              as 이름,
  case when p.proname is null then '없음 ❌' else '있음' end as 상태
from (values
  ('notify_user'),
  ('register_push_token'),
  ('is_admin_or_above'),
  ('my_unread_notification_count')
) as expected(name)
left join pg_proc p
  on p.proname = expected.name
 and p.pronamespace = 'public'::regnamespace
group by expected.name, p.proname
order by 3, 2;


-- ────────────────────────────────────────────────────────────────────────────
-- [D] 최근 알림 20건 — 누구에게, 언제, 푸시는 나갔는지
--
-- 같은 kind+dedupe_key가 여러 행이면 "받는 사람이 여럿"인 정상 동작이다.
-- ────────────────────────────────────────────────────────────────────────────
select
  'D. 최근 알림'                             as 구분,
  n.created_at                               as 생성시각,
  n.kind                                     as 종류,
  n.dedupe_key                               as 키,
  n.link                                     as 링크,
  case when n.pushed_at is null then '안나감' else '나감' end as 푸시,
  (select count(*) from public.push_tokens pt where pt.user_id = n.user_id) as 수신자기기수
from public.user_notifications n
order by n.created_at desc
limit 20;


-- ────────────────────────────────────────────────────────────────────────────
-- [E] 알림을 꺼 둔 사용자 — 껐으면 수신함에도 안 들어온다(notify_user 본문)
--
-- "알림이 안 온다"의 원인이 설정일 수도 있으므로 함께 본다.
-- ────────────────────────────────────────────────────────────────────────────
select
  'E. 알림 끔'                               as 구분,
  kind                                       as 종류,
  count(*)                                   as 끈사용자수
from public.notification_preferences
where enabled = false
group by kind
order by 3 desc;


-- ────────────────────────────────────────────────────────────────────────────
-- [F] register_push_token 인자/권한 — 앱이 3인자로 부른다(services/push.ts)
--
-- 2인자 함수만 남아 있으면 앱의 호출이 통째로 실패해 토큰이 안 쌓인다.
-- ────────────────────────────────────────────────────────────────────────────
select
  'F. 토큰등록 RPC'                          as 구분,
  p.proname                                  as 함수,
  pg_get_function_identity_arguments(p.oid)  as 인자,
  has_function_privilege('authenticated', p.oid, 'execute') as 로그인사용자실행가능
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname = 'register_push_token';
