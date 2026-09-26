-- ############################################################################
-- 2026-09-17 진단 — "관리자는 어떤 푸싱알람도 오지 않는다"의 남은 원인 확인
--
-- 3차 검토까지 코드 경로는 9단계를 모두 확인했고 전부 정상이었다:
--   트리거(관리자 전원 루프) → RPC 반환값 → 앱의 푸시 호출 → 엣지 함수 권한 예외
--   → pushed_at 컬럼 → push_tokens 표 → register_push_token 3인자 일치
--   → 알림 10종 ↔ i18n ↔ pushText 일치 → 트리거 파라미터 ↔ 문구 {{변수}} 일치
--
-- 남은 것은 데이터뿐이다. 이 쿼리 하나로 갈린다.
--
-- 읽는 법:
--   기기토큰수 = 0      → **원인 확정.** 그 관리자 계정은 실기기에서 알림 권한을
--                        허용한 적이 없다. 토큰이 없으면 보낼 곳이 없다.
--                        (웹 미리보기·에뮬레이터는 토큰을 발급하지 않는다)
--   꺼둔알림에 값 있음  → 그 종류는 수신함에도 안 쌓인다. 앱에서 다시 켜면 된다.
--   받은알림 = 0        → 트리거가 안 돈 것이다. user_roles에 그 계정의 admin 행이
--                        있는지부터 본다(아래 2번).
--   푸시안나간알림 > 0  → 알림은 생겼는데 발송이 안 됐다. 기기토큰수를 함께 본다.
-- ############################################################################

-- 1) 관리자별 알림 수신 상태
select
  u.email                                                                     as 계정,
  ur.role                                                                     as 역할,
  (select count(*) from public.push_tokens pt
     where pt.user_id = u.id)                                                 as 기기토큰수,
  (select string_agg(pt.platform || '/' || coalesce(pt.lang, '-'), ', ')
     from public.push_tokens pt where pt.user_id = u.id)                       as 기기목록,
  (select string_agg(np.kind, ', ')
     from public.notification_preferences np
     where np.user_id = u.id and np.enabled = false)                           as 꺼둔알림,
  (select count(*) from public.user_notifications n
     where n.user_id = u.id)                                                   as 받은알림,
  (select count(*) from public.user_notifications n
     where n.user_id = u.id and n.pushed_at is null)                           as 푸시안나간알림,
  (select max(n.created_at) from public.user_notifications n
     where n.user_id = u.id)                                                   as 마지막알림시각
from public.user_roles ur
join auth.users u on u.id = ur.user_id
where ur.role in ('admin', 'super_admin')
order by u.email;
