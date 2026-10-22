-- ============================================================================
-- 스케줄러 결함 수정 — Authorization 헤더 누락
--
-- [2026-10-22] 20261022000000에서 만든 디스패처가 x-cron-secret만 보내고
-- Authorization 헤더를 보내지 않았다. 실제로 호출해 보니 401이었다:
--
--   {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
--
-- 엣지 함수 **앞단의 게이트웨이**가 유효한 JWT를 먼저 요구한다. 함수 코드에
-- 닿기도 전에 막히므로, 함수 안의 x-cron-secret 검사는 실행될 기회조차 없었다.
-- (수동 실행이 되던 것은 그 PowerShell 명령에 anon key를 함께 넣었기 때문이다.
--  디스패처를 만들면서 그 헤더를 빠뜨렸다.)
--
-- anon key를 쓴다. 이 값은 앱 번들에 들어가는 공개 값이라 권한을 더하지 않는다 —
-- 게이트웨이를 지나가기 위한 것뿐이고, **누가 불렀는지는 여전히 x-cron-secret이
-- 가린다.** service_role key를 쓰면 통과는 되지만 RLS를 우회하는 키를 스케줄러
-- 경로에 두게 되어, 필요 없는 권한을 얹는 셈이다.
--
-- 이전 마이그레이션: 20261022000000_article_scheduler.sql
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
  v_anon text;
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
  select decrypted_secret into v_anon
    from vault.decrypted_secrets where name = 'research_news_anon_key';

  if v_url is null or v_secret is null or v_anon is null then
    return 'missing-vault-secret';
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- 게이트웨이를 지나기 위한 헤더. 권한은 이 값이 주지 않는다.
      'Authorization', 'Bearer ' || v_anon,
      -- 실제 권한 판정. 이 값이 맞아야 수집이 돈다.
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

-- ============================================================================
-- 적용 후: Vault에 anon key를 추가한다(SQL Editor에서 한 번만).
--
--   select vault.create_secret('<EXPO_PUBLIC_SUPABASE_ANON_KEY 값>',
--     'research_news_anon_key');
--
-- 이 값은 앱 번들에 이미 들어가는 공개 값이라 비밀은 아니지만, URL·비밀값과
-- 같은 자리에 모아 두어야 나중에 키를 돌릴 때 한곳만 보면 된다.
-- ============================================================================
