-- STEP T-1 — 채팅 자동번역 비용 최적화: 전역 번역 캐시 + 상태 + 사용량 로그.
--
-- 배경(현재 구조 감사 결과, 2026-09-10):
--   기존에도 번역 캐시는 있었다 — property_messages.translations(jsonb, 언어코드→번역문).
--   덕분에 "같은 메시지를 다시 열 때 재호출하지 않는다"(원칙 4)는 이미 충족되고 있었다.
--   그러나 세 가지 누수가 남아 있었다:
--     (1) 캐시가 **메시지 단위**라, 같은 문장을 다른 사람이 보내면 매번 새로 호출한다.
--         고정 문구인 상담원 자동응답도 대화마다 다시 번역됐다.
--     (2) 실패를 기록하지 않아, 번역에 실패한 메시지는 화면을 열 때마다 재호출된다.
--     (3) 호출량/문자 수를 알 수 없어 비용 추적이 불가능하다.
--
-- 이 migration은 위 세 가지를 해결한다. **기존 property_messages.translations 컬럼과
-- 그 안의 데이터는 건드리지 않는다** — 기존 메시지 호환성을 위해 그대로 두고(읽기 경로
-- 에서 계속 우선 사용), 앞으로의 번역만 전역 캐시를 함께 사용한다.

-- ---------------------------------------------------------------------------
-- 1. translation_cache — 전역 문장 단위 캐시
-- ---------------------------------------------------------------------------

create table public.translation_cache (
  -- sha256(source_lang || ':' || target_lang || ':' || normalized_text)를 hex로 저장한다.
  -- 원문 자체를 키로 쓰지 않는 이유: 인덱스 크기와, 로그/키에 원문이 그대로 남지 않게
  -- 하기 위함이다(지시서 §15 — 민감정보가 키에 평문으로 남지 않도록).
  -- 이 컬럼이 primary key다 — 동시에 같은 문장을 번역하려 해도 unique 제약이
  -- 중복 삽입을 막는다(§9 동시성 보호의 근거).
  translation_key text primary key,
  source_lang text not null,
  target_lang text not null,
  translated_text text not null,
  provider text not null default 'google',
  -- 재사용 빈도 추적용 — Cache Hit Rate 계산과 "어떤 문장이 자주 쓰이는지" 파악에 쓴다.
  hit_count int not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index translation_cache_lang_idx on public.translation_cache (source_lang, target_lang);
create index translation_cache_last_used_idx on public.translation_cache (last_used_at);

comment on table public.translation_cache is
  '문장 단위 전역 번역 캐시. 같은 (원문, 출발언어, 도착언어) 조합은 여러 사용자·여러 메시지에 걸쳐 한 번만 Google Translation API를 호출한다. 원문은 저장하지 않고 해시(translation_key)만 저장해, 캐시 자체가 대화 내용을 평문으로 보관하지 않도록 한다.';

comment on column public.translation_cache.translation_key is
  'sha256(source_lang:target_lang:normalized_text)의 hex. 원문 평문을 키로 쓰지 않는 이유는 §15(민감정보 보호)와 인덱스 크기 때문이다.';

alter table public.translation_cache enable row level security;

-- 클라이언트는 이 테이블을 직접 읽거나 쓰지 않는다 — Edge Function(service_role)만
-- 접근한다. 정책을 하나도 만들지 않으면 anon/authenticated는 전면 거부된다(RLS 기본).
-- service_role은 RLS를 우회하므로 별도 정책이 필요 없다.

-- ---------------------------------------------------------------------------
-- 2. translation_usage_log — 호출/캐시 히트 기록 (비용 모니터링)
-- ---------------------------------------------------------------------------

create type public.translation_outcome as enum (
  'api_call',    -- 실제로 Google API를 호출함(과금 대상)
  'cache_hit',   -- 캐시로 처리(무과금)
  'skipped',     -- 번역 불필요(같은 언어, 이미지 메시지 등)
  'failed'       -- API 호출 실패
);

create table public.translation_usage_log (
  id uuid primary key default gen_random_uuid(),
  outcome public.translation_outcome not null,
  source_lang text,
  target_lang text,
  -- 과금 기준이 문자 수라 함께 기록한다(Google Translation v2는 문자당 과금).
  char_count int not null default 0,
  message_id uuid,
  error_message text,
  created_at timestamptz not null default now()
);

create index translation_usage_log_created_idx on public.translation_usage_log (created_at desc);
create index translation_usage_log_outcome_idx on public.translation_usage_log (outcome, created_at desc);

comment on table public.translation_usage_log is
  '번역 요청 1건당 1행. Cache Hit Rate와 실제 과금 문자 수를 계산하는 근거 데이터다. 원문/번역문은 저장하지 않는다(문자 수만) — 로그에 대화 내용이 남지 않게 하기 위함(§15).';

alter table public.translation_usage_log enable row level security;

-- 기록은 Edge Function(service_role)만 남긴다. 조회는 admin 계열만 허용한다.
create policy "translation_usage_log_select_admin"
  on public.translation_usage_log for select
  to authenticated
  using (public.is_admin_or_above());

grant select on public.translation_usage_log to authenticated;

-- ---------------------------------------------------------------------------
-- 3. property_messages — 번역 상태 컬럼 추가
-- ---------------------------------------------------------------------------
-- 실패한 메시지를 매번 재호출하던 문제를 막기 위해 상태를 기록한다.
-- 기존 컬럼(translations 포함)은 그대로 두고 새 컬럼만 추가한다.

create type public.message_translation_status as enum (
  'not_required',  -- 번역 불필요(이미지 메시지 등)
  'pending',       -- 아직 번역되지 않음(기존 메시지의 기본값)
  'translated',    -- 최소 1개 언어로 번역 완료
  'failed'         -- 번역 시도했으나 실패
);

alter table public.property_messages
  add column translation_status public.message_translation_status not null default 'pending',
  -- 실패 재시도 횟수. 지시서 §19 — 무한 재시도를 금지하므로 상한(3회)을 코드에서
  -- 이 값으로 판단한다.
  add column translation_attempts int not null default 0,
  add column translation_error text,
  add column translated_at timestamptz;

comment on column public.property_messages.translation_status is
  '이 메시지의 번역 상태. failed로 기록된 메시지는 화면을 다시 열어도 재호출하지 않는다(translation_attempts 상한 3회) — 기존에는 실패가 기록되지 않아 열 때마다 API를 재호출했다.';

comment on column public.property_messages.translations is
  '언어코드 → 번역문 캐시(기존 컬럼, 유지). 전역 캐시(translation_cache)와 병행한다: 이 컬럼이 있으면 서버 호출 없이 즉시 사용하고, 없을 때만 Edge Function을 호출한다.';

create index property_messages_translation_status_idx
  on public.property_messages (translation_status)
  where translation_status in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- 4. 관리자용 사용량 집계 함수
-- ---------------------------------------------------------------------------

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
    when 'month' then date_trunc('month', now())
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
  '관리자용 번역 사용량 집계(period: today | month). 과금 문자 수는 실제 API 호출분만 합산한다. 단가는 이 함수에 하드코딩하지 않는다 — 요금 체계가 바뀔 수 있어 앱/설정에서 곱한다(지시서 §17).';

grant execute on function public.admin_translation_usage(text) to authenticated;
