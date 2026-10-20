-- ============================================================================
-- 부동산 정보 자동 수집 — 테이블 · RLS
--
-- [2026-10-20] STEP 02. 요구사항 §11의 `real_estate_*` 대신 **docs/DATABASE.md §5와
-- docs/AI_RESEARCH.md에 이미 설계된 이름**(article_sources / articles /
-- research_jobs)을 쓴다. 요구사항이 그 이름을 "설계 예시"로 명시했고, 두 이름
-- 체계가 공존하면 DATABASE.md가 즉시 거짓이 된다(개발 원칙 12 — 중복 구현 금지).
--
-- properties를 재사용하지 않는 이유: properties는 **업체가 등록해 거래하는 매물**이고
-- 광고 입찰(property_ad_slots)·상담(property_conversations)·투자상품과 FK로 엮여
-- 있다. 외부에서 수집한 기사를 같은 표에 넣으면 매물 검색과 광고 자리에 외부
-- 콘텐츠가 섞인다.
--
-- 다국어는 board_posts 패턴을 그대로 쓴다 — `source_lang text` + `*_i18n jsonb`.
-- language_code enum을 쓰지 않는 이유: 그 enum에 **'th'가 없다**(vi/ko/en/zh/ja만).
-- 앱은 6개 언어이므로 enum을 쓰면 타이어가 저장되지 않는다. board_posts도 같은
-- 이유로 text를 썼다.
--
-- 쓰기 권한: 이 표들에 authenticated용 INSERT/UPDATE 정책을 **두지 않는다.**
-- 수집·분석은 엣지 함수가 service_role로 수행하고, service_role은 RLS를 우회한다.
-- 관리자는 상태 변경(UPDATE)만 허용한다.
--
-- 이전 마이그레이션: 20261020000000_article_enums.sql
-- ============================================================================

-- ── 1. 정보원 ───────────────────────────────────────────────────────────────
create table if not exists public.article_sources (
  id uuid primary key default gen_random_uuid(),

  -- 화면에 노출되는 기관명·매체명. 예정작업 #2(우측 출처 패널)가 이 값을 쓴다.
  name text not null,
  -- 도메인은 정보원의 자연키다. 같은 매체를 두 번 등록하지 않게 한다.
  domain text not null unique,
  homepage_url text,

  source_type text not null default 'news'
    check (source_type in ('news', 'government', 'portal', 'agency', 'developer')),

  -- 어떻게 가져오는가. STEP 01 검증 결과를 그대로 적는다.
  access_method text not null default 'rss'
    check (access_method in ('rss', 'sitemap', 'api', 'manual')),
  feed_url text,

  -- 이 출처에서 온 기사의 기본 권한. 기사별로 덮어쓸 수 있다.
  content_permission public.article_content_permission not null default 'pending_review',
  -- 약관 근거를 남긴다. 나중에 "왜 link_only인가"를 다시 조사하지 않게.
  permission_note text,

  -- 0.00~1.00. 자동 게시 임계값과 비교한다.
  trust_score numeric(3,2) not null default 1.00
    check (trust_score >= 0 and trust_score <= 1),

  status public.article_source_status not null default 'pending',

  -- 원문 언어. 번역의 출발 언어로 쓴다.
  language text not null default 'vi',

  -- 한 출처가 일일 게시 칸을 다 먹지 않게 한다. STEP 01에서 CafeF 한 곳이
  -- 전체 공급량의 70%를 넘는 것을 확인했다.
  daily_limit integer not null default 3 check (daily_limit > 0),

  -- ── 헬스체크 ──
  -- STEP 01에서 **피드가 조용히 죽는 것**을 실제로 확인했다: Báo Đầu tư는 XML이
  -- 열리는데 항목이 0건, VnEconomy는 13일 전에 멈췄다. 조회 성공만 보면 둘 다
  -- "정상"으로 보인다. 그래서 마지막 **항목**의 시각을 따로 둔다.
  last_fetched_at timestamptz,
  last_item_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.article_sources is
  '부동산 정보 수집 대상. status가 verified인 것만 자동 수집한다. last_item_at은 피드가 열리지만 내용이 멈춘 경우를 잡기 위한 값이다(last_fetched_at만으로는 구분되지 않는다).';
comment on column public.article_sources.content_permission is
  '이 출처 콘텐츠를 앱 내부에 저장·표시할 수 있는가. 약관·계약에 따라 사람이 정한다 — AI가 판단하지 않는다.';
comment on column public.article_sources.daily_limit is
  '이 출처에서 하루에 게시할 최대 건수. 한 출처 편중을 막는다.';

create index if not exists article_sources_status_idx
  on public.article_sources (status);

-- ── 2. 기사 ─────────────────────────────────────────────────────────────────
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.article_sources (id) on delete cascade,

  -- ── 원문에서 그대로 가져오는 값 ──
  title text not null,
  summary text,
  source_lang text not null default 'vi',
  -- 언어코드 → 번역문. board_posts의 title_i18n/body_i18n과 같은 모양.
  title_i18n jsonb,
  summary_i18n jsonb,

  original_url text not null,
  -- 정규화한 URL의 sha256. 같은 기사를 두 번 넣지 않는다. 쿼리 문자열·추적
  -- 파라미터가 붙은 같은 주소를 URL 비교로는 잡을 수 없어 해시로 둔다.
  url_hash text not null unique,
  -- 제목+요약을 정규화한 해시. URL이 달라도 같은 기사인 경우를 잡는다
  -- (여러 매체가 같은 보도자료를 받아쓰는 경우).
  content_hash text,

  -- ── 날짜 ──
  -- 원문 게시일. 요구사항의 "출시일". 피드의 pubDate이며 발행자가 직접 넣은 값이다.
  -- 없으면 NULL — 추정하지 않는다. 자동 게시 게이트가 NULL을 탈락시킨다.
  source_published_at timestamptz,
  collected_at timestamptz not null default now(),
  last_checked_at timestamptz,
  published_at timestamptz,

  -- ── 분류 (AI가 채우되 원문에 근거해야 한다) ──
  -- 원문에서 추출한 지역 문자열. 행정구역 마스터와 매칭되면 location_id도 채운다.
  -- 둘을 함께 두는 이유: 매칭이 실패해도 원문이 말한 지역을 잃지 않는다.
  region text,
  location_id uuid references public.locations (id) on delete set null,

  property_type text,
  transaction_type text
    check (transaction_type is null or transaction_type in ('for_sale', 'for_rent', 'presale', 'news')),

  -- 원문에 금액이 명시된 경우만. 없으면 NULL — AI가 만들어 넣지 않는다.
  price_min numeric,
  price_max numeric,
  currency text,

  -- ── 기간 (요구사항: 날짜·기간을 정확하게 노출) ──
  -- 분양·모집·완공 기간처럼 원문에 명시된 기간만 채운다. 뉴스 기사에는 대부분
  -- 없으므로 NULL이 정상이고, 화면은 NULL이면 칸 자체를 숨긴다.
  -- period_label은 "2026년 4분기 입주 예정"처럼 날짜로 환산할 수 없는 표현을 담는다.
  period_start date,
  period_end date,
  period_label text,

  relevance_score numeric(3,2)
    check (relevance_score is null or (relevance_score >= 0 and relevance_score <= 1)),
  keywords text[],

  -- ── 권한·상태 ──
  -- 출처의 기본값을 수집기가 복사해 넣는다. 기사별로 달라질 수 있어 별도 컬럼이다
  -- (출처는 link_only인데 특정 보도자료만 허가를 받는 경우 등).
  content_permission public.article_content_permission not null default 'pending_review',
  status public.article_status not null default 'collected',
  -- 자동 게시 게이트에서 탈락한 이유. 사람이 보는 큐는 없지만 왜 안 떴는지는
  -- 남겨야 한다 — 없으면 "수집은 됐는데 안 보인다"를 조사할 방법이 없다.
  reject_reason text,

  -- ── 이미지 ──
  -- 카드에 쓰는 대표 이미지. 피드가 주는 1장이 보통 여기 들어간다.
  thumbnail_url text,
  -- article_images의 개수를 비정규화해 둔다. 카드에 「사진 N」 배지를 띄울 때
  -- 목록 조회마다 이미지 표를 조인하지 않기 위한 것이다.
  image_count integer not null default 0 check (image_count >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.articles is
  '수집한 부동산 정보. 원문에 없는 값(가격·주소·게시일·기간)은 NULL로 둔다 — 추정값을 채우지 않는다. status=published만 공개 노출된다.';
comment on column public.articles.source_published_at is
  '원문 게시일(요구사항의 "출시일"). 피드의 pubDate이며 발행자가 넣은 값이다. NULL이면 자동 게시하지 않는다.';
comment on column public.articles.url_hash is
  '정규화 URL의 sha256. 추적 파라미터가 붙은 같은 주소를 URL 문자열 비교로는 잡을 수 없다.';
comment on column public.articles.period_label is
  '날짜로 환산할 수 없는 기간 표현("2026년 4분기 입주 예정" 등). period_start/end와 함께 비어 있으면 화면에서 기간 칸을 숨긴다.';
comment on column public.articles.image_count is
  'article_images 개수의 사본. 목록에서 「사진 N」 배지를 띄울 때 조인을 피하려고 둔다.';

-- 홈 리스트의 기본 조회: 게시된 것 중 최신순.
create index if not exists articles_published_idx
  on public.articles (status, published_at desc);
create index if not exists articles_source_idx
  on public.articles (source_id);
create index if not exists articles_source_published_at_idx
  on public.articles (source_published_at desc);
create index if not exists articles_content_hash_idx
  on public.articles (content_hash);
create index if not exists articles_keywords_idx
  on public.articles using gin (keywords);

-- ── 3. 기사 사진 ────────────────────────────────────────────────────────────
-- property_images와 같은 모양이다.
--
-- [2026-10-20 STEP 01 결과] 지금 검증된 출처는 **전부 사진이 1장**이다. 뉴스 RSS는
-- 1장, 정부 출처는 0~2장이고, 사진이 여러 장인 매물 포털은 약관이 복제를 금지한다.
-- 그래서 이 표는 당장은 거의 0~1행만 갖는다. 그래도 지금 만드는 이유는, 제휴가
-- 성사되면(Masterise·Ecopark) 그때 스키마를 바꾸지 않고 바로 담을 수 있어야 하기
-- 때문이다. 슬라이드 UI도 같은 전제로 만든다.
create table if not exists public.article_images (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  url text not null,
  sort_order integer not null default 0,
  caption text,
  -- 이 사진의 출처. 원문 도메인과 다를 수 있다(보도자료 사진 등).
  image_source text,
  created_at timestamptz not null default now(),
  unique (article_id, url)
);

comment on table public.article_images is
  '기사 사진. 권한이 internal_allowed인 출처에서만 채운다 — link_only 출처의 사진은 저장하지 않고 썸네일 1장(피드 제공분)만 쓴다.';

create index if not exists article_images_article_idx
  on public.article_images (article_id, sort_order);

-- ── 4. 수집 작업 로그 ───────────────────────────────────────────────────────
create table if not exists public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null default 'collect',
  status public.research_job_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  -- 정보원별 요청 수, 수집·중복제거·분석·게시·실패 건수, 외부 API 사용량.
  -- 항목이 늘어날 것이라 jsonb로 둔다(요구사항 §10의 로그 항목).
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.research_jobs is
  '자동 수집 실행 기록. stats에 정보원별 요청·수집·중복·게시·실패 건수를 담는다.';

create index if not exists research_jobs_status_idx
  on public.research_jobs (status, created_at desc);

-- ── 5. 자동 게시 설정 ───────────────────────────────────────────────────────
-- 이 프로젝트에는 관리자 설정 테이블이 **없었다**(app_settings·admin_settings 모두
-- 부재). key/value 표가 아니라 단일 행 표로 둔다 — 항목이 고정이고 타입이 살아야
-- 숫자 상한을 DB가 검사할 수 있다.
create table if not exists public.article_publish_settings (
  -- 행이 하나만 존재하게 고정한다.
  id boolean primary key default true check (id),

  enabled boolean not null default false,

  -- 매일 실행 시각. 요구사항 기본값 08:00 / Asia/Ho_Chi_Minh.
  -- 서버가 UTC로 돌아도 이 시간대 기준으로 환산한다.
  run_hour integer not null default 8 check (run_hour between 0 and 23),
  run_minute integer not null default 0 check (run_minute between 0 and 59),
  timezone text not null default 'Asia/Ho_Chi_Minh',

  -- 하루 게시 수 상한. 사용자 지시: 10개 내외.
  daily_limit integer not null default 10 check (daily_limit between 1 and 100),
  per_source_limit integer not null default 3 check (per_source_limit between 1 and 100),

  -- 게시일이 이보다 오래된 기사는 게시하지 않는다.
  max_age_days integer not null default 7 check (max_age_days between 1 and 90),
  -- 관련성 점수 임계값. 사람이 검토하지 않으므로 이 값이 품질 게이트다.
  min_relevance numeric(3,2) not null default 0.60
    check (min_relevance >= 0 and min_relevance <= 1),
  -- 출처 신뢰도 임계값.
  min_trust_score numeric(3,2) not null default 0.50
    check (min_trust_score >= 0 and min_trust_score <= 1),

  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.article_publish_settings is
  '자동 게시 설정 — 단일 행. 사용자 결정(2026-10-20)으로 관리자 검토 없이 자동 게시하므로, 여기 임계값들이 유일한 품질 게이트다.';

insert into public.article_publish_settings (id) values (true)
on conflict (id) do nothing;

-- ── 6. updated_at 트리거 ────────────────────────────────────────────────────
-- set_updated_at()은 20260910004541에서 이미 만들어 두었다.
drop trigger if exists article_sources_updated_at on public.article_sources;
create trigger article_sources_updated_at
  before update on public.article_sources
  for each row execute function public.set_updated_at();

drop trigger if exists articles_updated_at on public.articles;
create trigger articles_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

-- ── 7. RLS ──────────────────────────────────────────────────────────────────
alter table public.article_sources enable row level security;
alter table public.articles enable row level security;
alter table public.article_images enable row level security;
alter table public.research_jobs enable row level security;
alter table public.article_publish_settings enable row level security;

-- 정보원·로그·설정은 내부 운영 데이터다. 공개 읽기가 필요 없다.
--
-- 다만 **기사 목록 화면이 기관명을 보여줘야 한다**(예정작업 #2의 출처 패널). 그래서
-- article_sources는 공개 읽기를 열되, 노출해도 되는 것만 담겨 있어야 한다 — 접속
-- 정보(API 키 등)는 이 표에 넣지 않고 Supabase Secrets에 둔다. feed_url은 공개
-- 주소이므로 문제가 없다.
drop policy if exists "article_sources_select_public" on public.article_sources;
create policy "article_sources_select_public"
  on public.article_sources for select
  to anon, authenticated
  using (true);

drop policy if exists "article_sources_admin_all" on public.article_sources;
create policy "article_sources_admin_all"
  on public.article_sources for all
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- 기사: 게시된 것만 누구나. 비로그인도 본다(매물 상세와 같은 정책).
drop policy if exists "articles_select_published" on public.articles;
create policy "articles_select_published"
  on public.articles for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "articles_admin_all" on public.articles;
create policy "articles_admin_all"
  on public.articles for all
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- 사진: 부모 기사가 게시된 경우만.
drop policy if exists "article_images_select_published" on public.article_images;
create policy "article_images_select_published"
  on public.article_images for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.articles a
      where a.id = article_images.article_id
        and a.status = 'published'
    )
  );

drop policy if exists "article_images_admin_all" on public.article_images;
create policy "article_images_admin_all"
  on public.article_images for all
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- 실행 로그: 관리자만 읽는다. 쓰기는 엣지 함수(service_role)만.
drop policy if exists "research_jobs_admin_select" on public.research_jobs;
create policy "research_jobs_admin_select"
  on public.research_jobs for select
  to authenticated
  using (public.is_admin_or_above());

-- 설정: 관리자만.
drop policy if exists "article_publish_settings_admin_all" on public.article_publish_settings;
create policy "article_publish_settings_admin_all"
  on public.article_publish_settings for all
  to authenticated
  using (public.is_admin_or_above())
  with check (public.is_admin_or_above());

-- ── 8. 권한 ─────────────────────────────────────────────────────────────────
grant select on public.article_sources to anon, authenticated;
grant insert, update, delete on public.article_sources to authenticated;

grant select on public.articles to anon, authenticated;
grant insert, update, delete on public.articles to authenticated;

grant select on public.article_images to anon, authenticated;
grant insert, update, delete on public.article_images to authenticated;

grant select on public.research_jobs to authenticated;

grant select, insert, update on public.article_publish_settings to authenticated;
