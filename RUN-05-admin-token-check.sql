-- ============================================================================
-- RUN-05 · "관리자가 푸시를 못 받는다"의 원인 확정
--
-- 실행 위치: Supabase 대시보드 → SQL Editor (읽기 전용)
--
-- RUN-04b에서 드러난 것: payment_requested 알림의 **수신자 기기가 0대**다.
-- 관리자 계정에 푸시 토큰이 없으면 엣지 함수는 보낼 곳이 없어 조용히 넘어간다
-- (supabase/functions/send-push/index.ts — messages.length === 0 이면 false 반환).
--
-- 이 쿼리는 "누가 관리자이고, 그 관리자에게 기기가 붙어 있는가"를 확인한다.
-- ============================================================================

select 구분, 항목, 값, 비고
from (

  -- ── 1. 관리자별 푸시 토큰 보유 현황 (핵심) ─────────────────────────────
  select 10 as ord,
         '1 관리자' as 구분,
         coalesce(u.email, r.user_id::text) as 항목,
         r.role || ' · 기기 ' ||
           (select count(*) from public.push_tokens t where t.user_id = r.user_id)::text || '대' as 값,
         case when (select count(*) from public.push_tokens t where t.user_id = r.user_id) = 0
              then '❌ 이 관리자는 푸시를 받을 수 없음'
              else '' end as 비고
  from public.user_roles r
  left join auth.users u on u.id = r.user_id
  where r.role in ('admin', 'super_admin')

  -- ── 2. 실제 토큰 4개의 주인 ────────────────────────────────────────────
  -- 같은 기기에서 다른 계정으로 로그인하면 토큰의 주인이 옮겨간다(token이 유일키).
  -- 관리자가 예전에 갖고 있던 토큰이 다른 계정으로 넘어갔는지 여기서 보인다.
  union all
  select 20,
         '2 토큰주인',
         coalesce(u.email, t.user_id::text),
         coalesce(t.platform, '?') || ' · ' || coalesce(t.lang, '언어없음') ||
           ' · ' || to_char(t.updated_at, 'MM-DD HH24:MI'),
         coalesce(
           (select string_agg(distinct r.role, ',') from public.user_roles r where r.user_id = t.user_id),
           '역할없음(일반 사용자)')
  from public.push_tokens t
  left join auth.users u on u.id = t.user_id

  -- ── 3. RUN-04b에서 이름을 잘못 짚은 트리거 재확인 ──────────────────────
  -- 앞선 쿼리에서 'payment_requests_notify_requested'를 찾았는데, 저장소의 실제
  -- 이름은 payment_requests_notify_new 였다. 실제 이름으로 다시 본다.
  union all
  select 30, '3 트리거', e.name,
         case when t.tgname is null then '없음' else '있음' end,
         case when t.tgname is null then '❌ 적용 안 된 마이그레이션 있음' else '' end
  from (values
    ('payment_requests_notify_new'),
    ('agencies_notify_applied')
  ) as e(name)
  left join pg_trigger t on t.tgname = e.name and not t.tgisinternal

) x
order by ord, 항목;
