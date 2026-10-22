-- ============================================================================
-- 스케줄러 — anon key 헤더 제거
--
-- [2026-10-22] 20261022000100에서 게이트웨이 401을 피하려고 Authorization 헤더에
-- anon key를 실어 보내게 했다. 그 판단을 되돌린다.
--
-- anon key는 앱 번들에 들어가는 **공개 값**이라 보안을 전혀 더하지 않는다.
-- 게이트웨이를 지나가기 위한 통행증일 뿐인데, 그 값을 Vault에 넣고 헤더로
-- 나르느라 단계와 실패 지점만 늘었다(실제로 값을 잘못 넣어 두 번 막혔다).
--
-- 대신 research-news 함수를 --no-verify-jwt로 배포해 게이트웨이 검사를 끈다.
-- 권한 판정은 함수 안의 두 경로가 그대로 맡는다:
--   · x-cron-secret 일치 (스케줄러)
--   · is_admin_or_above (관리자)
-- 자격 증명이 하나도 없는 요청은 DB를 건드리기 전에 403으로 끝낸다.
--
-- 즉 보안이 약해진 것이 아니라, **보안을 주지 않던 층을 걷어낸 것**이다.
--
-- 이전 마이그레이션: 20261022000100_scheduler_auth_header.sql
-- ============================================================================

create or replace function public.dispatch_article_collection()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enabled boolean;
  v_run_hour integer;
  v_run_minute integer;
  v_timezone text;
  v_local timestamp;
  v_due timestamp;
  v_local_day_start timestamptz;
  v_already integer;
  v_url text;
  v_secret text;
begin
  select enabled, run_hour, run_minute, timezone
    into v_enabled, v_run_hour, v_run_minute, v_timezone
    from public.article_publish_settings
   where id = true;

  if v_enabled is distinct from true then
    return 'disabled';
  end if;

  v_local := now() at time zone v_timezone;
  v_due := date_trunc('day', v_local)
           + make_interval(hours => v_run_hour, mins => v_run_minute);

  if v_local < v_due then
    return 'too-early';
  end if;

  -- 오늘(현지 기준) 이미 돌았으면 끝. running도 센다 — 수집이 1~2분 걸리므로
  -- 그 사이에 다음 10분 틱이 올 수 있다.
  v_local_day_start := date_trunc('day', v_local) at time zone v_timezone;

  select count(*) into v_already
    from public.research_jobs
   where job_type = 'collect'
     and status in ('running', 'succeeded')
     and created_at >= v_local_day_start;

  if v_already > 0 then
    return 'already-ran-today';
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'research_news_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'research_news_cron_secret';

  if v_url is null or v_secret is null then
    return 'missing-vault-secret';
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );

  return 'dispatched';
end;
$$;

revoke all on function public.dispatch_article_collection() from public;
revoke all on function public.dispatch_article_collection() from anon, authenticated;

-- 잘못 들어간 anon key 비밀값을 치운다. 이제 쓰지 않는다.
delete from vault.secrets where name = 'research_news_anon_key';

-- ============================================================================
-- 적용 후: 함수를 게이트웨이 검사 없이 다시 배포해야 한다.
--
--   npx supabase functions deploy research-news --no-verify-jwt
--
-- 이 한 줄을 빼먹으면 스케줄러가 계속 401을 받는다.
-- ============================================================================
