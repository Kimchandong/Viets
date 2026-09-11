-- [2026-09-11 사용자 지시 — 4차] 번역 사용량 — 오늘/이번주/이번달/전체.
--
-- 기존 admin_translation_usage(period)는 'today'와 'month'만 알았고, 그 외 값은 조용히
-- 'month'로 떨어졌다. 화면에 주/전체 탭을 붙이려면 함수가 그 둘을 알아야 한다 —
-- 모르는 값을 month로 흘려보내면 "전체"를 눌렀는데 이번 달 숫자가 나온다.
--
-- 그리고 "전체는 1년 기록을 그래프로" — 합계 하나로는 그래프를 그릴 수 없으므로 월별
-- 집계를 돌려주는 함수를 따로 둔다.
--
-- 이전 마이그레이션: 20260911153018_settlement_rename.sql

create or replace function public.admin_translation_usage(period text default 'month')
returns table (
  api_calls bigint,
  cache_hits bigint,
  skipped bigint,
  failures bigint,
  billable_chars bigint,
  cache_hit_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  since timestamptz;
begin
  if not public.is_admin_or_above() then
    raise exception 'permission denied: admin only'
      using errcode = 'insufficient_privilege';
  end if;

  since := case period
    when 'today' then date_trunc('day', now())
    when 'week' then date_trunc('week', now())
    when 'month' then date_trunc('month', now())
    -- 'all'은 기록 전체 — 시작점을 두지 않는다.
    when 'all' then '-infinity'::timestamptz
    else date_trunc('month', now())
  end;

  return query
  select
    count(*) filter (where l.outcome = 'api_call'),
    count(*) filter (where l.outcome = 'cache_hit'),
    count(*) filter (where l.outcome = 'skipped'),
    count(*) filter (where l.outcome = 'failed'),
    -- 과금은 실제 API 호출분만 발생한다.
    coalesce(sum(l.char_count) filter (where l.outcome = 'api_call'), 0),
    -- Cache Hit Rate = 캐시 히트 / (캐시 히트 + 실제 호출) × 100.
    -- skipped(번역 불필요)는 애초에 번역 요청이 아니므로 분모에서 제외한다.
    case
      when count(*) filter (where l.outcome in ('api_call', 'cache_hit')) = 0 then 0
      else round(
        100.0 * count(*) filter (where l.outcome = 'cache_hit')
        / count(*) filter (where l.outcome in ('api_call', 'cache_hit')),
        1
      )
    end
  from public.translation_usage_log l
  where l.created_at >= since;
end;
$$;

comment on function public.admin_translation_usage(text) is
  '관리자용 번역 사용량 집계(period: today | week | month | all). 과금 문자 수는 실제 API 호출분만 합산한다. 단가는 이 함수에 하드코딩하지 않는다 — 요금 체계가 바뀔 수 있어 앱에서 곱한다(지시서 §17).';

grant execute on function public.admin_translation_usage(text) to authenticated;

-- ============================================================================
-- 월별 추이 — "전체" 탭의 1년 그래프
-- ============================================================================
--
-- 기록이 없는 달도 0으로 채워 돌려준다. 빠진 달을 클라이언트가 채우게 두면 화면마다
-- 다르게 그려지고, 무엇보다 "기록이 없는 달"과 "0인 달"이 구분되지 않는다.

create or replace function public.admin_translation_usage_monthly()
returns table (
  month date,
  api_calls bigint,
  billable_chars bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_above() then
    raise exception 'permission denied: admin only'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with months as (
    select generate_series(
      date_trunc('month', now()) - interval '11 months',
      date_trunc('month', now()),
      interval '1 month'
    )::date as month
  )
  select
    m.month,
    coalesce(count(l.*) filter (where l.outcome = 'api_call'), 0)::bigint,
    coalesce(sum(l.char_count) filter (where l.outcome = 'api_call'), 0)::bigint
  from months m
  left join public.translation_usage_log l
    on date_trunc('month', l.created_at)::date = m.month
  group by m.month
  order by m.month;
end;
$$;

comment on function public.admin_translation_usage_monthly() is
  '최근 12개월 번역 사용량(월별) — 관리자 화면의 "전체" 탭 그래프용. 기록이 없는 달도 0으로 채워 돌려준다.';

grant execute on function public.admin_translation_usage_monthly() to authenticated;
