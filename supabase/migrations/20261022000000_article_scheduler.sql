-- ============================================================================
-- 부동산 정보 자동 수집 — 스케줄러 (STEP 07)
--
-- [2026-10-22] 요구사항 §9: 매일 지정한 오전 시각에 수집이 자동으로 돌아야 한다.
-- "서버 재시작이나 앱 종료와 관계없이" 돌아야 하므로 앱 타이머는 쓸 수 없다.
--
-- pg_cron(DB 안의 스케줄러) + pg_net(DB에서 HTTP 호출)으로 엣지 함수를 부른다.
-- 둘 다 이 프로젝트에서 사용 가능한 것을 확인하고 쓴다(pg_cron 1.6.4 / pg_net 0.20.4).
--
-- ── 왜 "매일 08:00"으로 cron을 걸지 않는가 ──────────────────────────────────
-- 요구사항은 실행 시각을 **관리자가 바꿀 수 있어야** 한다고 못박는다. cron 식에
-- 시각을 박아 두면 설정을 바꿀 때마다 cron.alter_job을 불러야 하고, DB의 cron 식과
-- article_publish_settings의 값이 어긋날 수 있다 — 둘 중 어느 것이 진짜인지
-- 알 수 없게 된다.
--
-- 그래서 cron은 **10분마다** 돌고, 판단은 설정 테이블이 한다:
--   "오늘 아직 안 돌았고, 지금이 설정된 시각을 지났으면 돌린다."
--
-- 이 방식의 이점이 하나 더 있다. 그 시각에 DB가 멈춰 있었거나 호출이 실패해도
-- 다음 10분 뒤에 다시 시도한다 — 정각 한 번만 쏘는 방식은 그 한 번을 놓치면
-- 그날은 끝이다.
--
-- 시간대: 서버는 UTC다(확인함). 베트남 시각은 설정의 timezone으로 그때그때
-- 환산한다 — UTC 오프셋을 상수로 박지 않는다.
--
-- ── 비밀값 ──────────────────────────────────────────────────────────────────
-- 엣지 함수 URL과 호출 비밀값은 **이 파일에 넣지 않는다.** 마이그레이션은 깃에
-- 들어가기 때문이다. Vault(supabase_vault, 이미 설치돼 있음)에서 읽는다.
-- 값 넣는 방법은 파일 맨 아래 주석 참고.
--
-- 이전 마이그레이션: 20261020000200_article_sources_seed.sql
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ── 디스패처 ────────────────────────────────────────────────────────────────
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

  -- 설정된 시간대의 '지금'과 '오늘 몇 시에 돌기로 했는가'.
  v_local := now() at time zone v_timezone;
  v_due := date_trunc('day', v_local)
           + make_interval(hours => v_run_hour, mins => v_run_minute);

  if v_local < v_due then
    return 'too-early';
  end if;

  -- 오늘(현지 기준) 이미 돌았으면 끝. 멱등성 — 10분마다 깨어나도 하루 한 번이다.
  -- running도 센다. 수집이 2분쯤 걸리므로 그 사이에 또 깨어날 수 있다.
  v_local_day_start := date_trunc('day', v_local) at time zone v_timezone;

  select count(*) into v_already
    from public.research_jobs
   where job_type = 'collect'
     and status in ('running', 'succeeded')
     and created_at >= v_local_day_start;

  if v_already > 0 then
    return 'already-ran-today';
  end if;

  -- 비밀값은 Vault에서. 없으면 아무것도 하지 않는다 — 빈 값으로 호출하면
  -- 엣지 함수가 403을 돌려주고, 그 실패가 매 10분마다 반복된다.
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
    -- 수집은 피드 3곳을 돌고 번역까지 하므로 1~2분이 걸린다. pg_net은 응답을
    -- 기다리지 않고 비동기로 던지지만, 타임아웃이 너무 짧으면 요청이 끊긴다.
    timeout_milliseconds := 120000
  );

  return 'dispatched';
end;
$$;

comment on function public.dispatch_article_collection() is
  '10분마다 깨어나 "오늘 아직 안 돌았고 설정 시각을 지났으면" 수집 엣지 함수를 호출한다. 실행 시각은 article_publish_settings가 정한다 — cron 식에 시각을 박지 않는다.';

revoke all on function public.dispatch_article_collection() from public;
revoke all on function public.dispatch_article_collection() from anon, authenticated;

-- ── 스케줄 ──────────────────────────────────────────────────────────────────
-- 같은 이름의 작업이 있으면 지우고 다시 건다(여러 번 실행해도 중복되지 않는다).
do $$
begin
  perform cron.unschedule('article-collect-dispatch');
exception
  when others then null;  -- 없으면 그냥 넘어간다
end $$;

select cron.schedule(
  'article-collect-dispatch',
  '*/10 * * * *',
  $$select public.dispatch_article_collection()$$
);

-- ============================================================================
-- 적용 후 해야 할 일 (이 파일에 비밀값을 넣지 않았으므로)
--
--   1) Vault에 두 값을 넣는다 — SQL Editor에서 한 번만:
--
--        select vault.create_secret(
--          'https://<프로젝트>.supabase.co/functions/v1/research-news',
--          'research_news_url');
--        select vault.create_secret('<RESEARCH_CRON_SECRET 값>',
--          'research_news_cron_secret');
--
--   2) 자동 게시를 켠다:
--
--        update public.article_publish_settings set enabled = true where id = true;
--
--   끄려면 enabled = false로 두면 된다. cron은 계속 깨어나지만 아무것도 하지 않는다.
-- ============================================================================
