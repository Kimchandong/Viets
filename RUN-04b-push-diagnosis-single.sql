-- ============================================================================
-- RUN-04b · 푸시알림 진단 (결과 1개 표로 합침)
--
-- 실행 위치: Supabase 대시보드 → SQL Editor (읽기 전용)
--
-- RUN-04는 쿼리가 6개라 SQL Editor가 마지막 것만 보여 줬다.
-- 이 파일은 전부를 UNION ALL로 이어 붙인 **하나의 쿼리**다.
-- ============================================================================

select 구분, 항목, 값, 비고
from (

  -- ── A. 등록된 푸시 토큰 ────────────────────────────────────────────────
  -- 0건이면 보낼 곳이 없다는 뜻이고, 그 뒤 항목은 볼 필요도 없다.
  select 10 as ord, 'A 푸시토큰' as 구분, '총 토큰 수' as 항목,
         count(*)::text as 값,
         case when count(*) = 0 then '❌ 0건 — 푸시가 나갈 기기가 없음' else '' end as 비고
  from public.push_tokens
  union all
  select 11, 'A 푸시토큰', '토큰 보유 사용자 수', count(distinct user_id)::text, ''
  from public.push_tokens
  union all
  select 12, 'A 푸시토큰', 'android / ios',
         count(*) filter (where platform = 'android')::text || ' / ' ||
         count(*) filter (where platform = 'ios')::text, ''
  from public.push_tokens
  union all
  select 13, 'A 푸시토큰', 'ExponentPushToken 형식',
         count(*) filter (where token like 'ExponentPushToken%')::text,
         case when count(*) > 0
               and count(*) filter (where token like 'ExponentPushToken%') < count(*)
              then '⚠ 형식이 다른 토큰 있음' else '' end
  from public.push_tokens
  union all
  select 14, 'A 푸시토큰', '최근 등록 시각', coalesce(max(updated_at)::text, '-'), ''
  from public.push_tokens

  -- ── B. 수신함 적재 vs 실제 발송 (핵심) ─────────────────────────────────
  -- pushed_at은 send-push 엣지 함수가 Expo 발송에 성공했을 때만 채워진다.
  union all
  select 20, 'B 발송합계', '전체 알림 / 푸시성공',
         count(*)::text || ' / ' || count(*) filter (where pushed_at is not null)::text,
         case when count(*) > 0 and count(*) filter (where pushed_at is not null) = 0
              then '❌ 한 번도 발송 안 됨' else '' end
  from public.user_notifications
  union all
  select 21, 'B 종류별', kind,
         count(*)::text || '건 · 푸시 ' || count(*) filter (where pushed_at is not null)::text,
         case when count(*) filter (where pushed_at is not null) = 0 then '❌' else '' end
  from public.user_notifications
  group by kind

  -- ── C. 알림을 만드는 트리거 ────────────────────────────────────────────
  union all
  select 30, 'C 트리거', e.name,
         case when t.tgname is null then '없음' else '있음' end,
         case when t.tgname is null then '❌ 이 종류는 알림 자체가 안 생김' else '' end
  from (values
    ('ad_notifications_mirror'),
    ('agencies_notify_review'),
    ('agencies_notify_applied'),
    ('payment_requests_notify_review'),
    ('payment_requests_notify_requested'),
    ('board_posts_notify_answer'),
    ('property_reports_notify_resolved')
  ) as e(name)
  left join pg_trigger t on t.tgname = e.name and not t.tgisinternal

  -- ── C2. 함수 ──────────────────────────────────────────────────────────
  union all
  select 40, 'C 함수', e.name,
         case when count(p.oid) = 0 then '없음' else '있음' end,
         case when count(p.oid) = 0 then '❌' else '' end
  from (values
    ('notify_user'),
    ('register_push_token'),
    ('is_admin_or_above'),
    ('my_unread_notification_count')
  ) as e(name)
  left join pg_proc p
    on p.proname = e.name and p.pronamespace = 'public'::regnamespace
  group by e.name

  -- ── D. 최근 알림 15건 ─────────────────────────────────────────────────
  -- 수신자의 기기 수가 0이면 "푸시 안 나감"의 원인이 그 사람에게 앱이 없다는 것이다.
  union all
  select 50, 'D 최근알림',
         to_char(n.created_at, 'MM-DD HH24:MI') || ' · ' || n.kind,
         case when n.pushed_at is null then '푸시 안나감' else '푸시 나감' end,
         '수신자 기기 ' ||
         (select count(*) from public.push_tokens pt where pt.user_id = n.user_id)::text || '대' ||
         coalesce(' · ' || n.link, '')
  from (
    select * from public.user_notifications order by created_at desc limit 15
  ) n

  -- ── E. 알림을 꺼 둔 사용자 ─────────────────────────────────────────────
  -- 껐으면 수신함에도 안 들어온다(notify_user 본문). "안 온다"의 원인일 수 있다.
  union all
  select 60, 'E 알림끔', kind, count(*)::text || '명', ''
  from public.notification_preferences
  where enabled = false
  group by kind

) x
order by ord, 항목;
