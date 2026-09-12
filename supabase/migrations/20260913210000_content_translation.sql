-- ============================================================================
-- [2026-09-12] 콘텐츠 번역 확장 — 매물·투자상품 **설명**을 6개 언어로
--
-- 지금까지 UI는 6개 언어인데 매물/투자상품 설명은 등록자가 쓴 한 언어 그대로였다.
-- 베트남 사용자가 한국어 설명을, 한국 사용자가 베트남어 설명을 읽는 상태다.
--
-- 방식은 게시판(20260911170000_boards.sql)에서 이미 검증한 것을 그대로 쓴다:
-- **저장 시점에** 나머지 5개 언어로 번역해 jsonb에 넣어 둔다. 읽을 때 번역하지 않는
-- 이유는 게시판과 같다 — 목록 한 번에 수십 건을 번역하면 화면이 멈추고, 같은 문장을
-- 볼 때마다 다시 번역해 비용이 열람 수에 비례한다. 설명은 자주 바뀌지 않으므로
-- 저장이 몇 초 걸리는 편이 낫다.
--
-- **매물명과 주소는 번역하지 않는다** (DECISIONS.md D49 불변 규칙). 주소를 번역하면
-- 그 주소로 찾아갈 수 없고, 매물명은 고유명사에 가깝다. 이 migration도 설명 컬럼만
-- 다룬다.
--
-- description_lang: 원문이 어느 언어인지. 뷰어 언어가 원문 언어와 같으면 번역본을
-- 쓰지 않고 원문을 보여 주기 위해 필요하다(번역을 거친 문장은 원문보다 반드시 나쁘다).
-- 기존 행은 NULL로 둔다 — 번역본이 아예 없으므로 어느 언어로 읽든 원문으로 떨어지고,
-- 결과가 지금과 완전히 같다. 등록자가 설명을 한 번 수정하면 그때 채워진다.
-- ============================================================================

alter table public.properties
  add column if not exists description_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_lang text;

comment on column public.properties.description_i18n is
  '언어코드 → 번역된 설명. 저장 시점에 채운다(게시판과 같은 방식). 비어 있으면 화면은 description 원문으로 떨어진다.';
comment on column public.properties.description_lang is
  '설명 원문의 언어. NULL이면 원문 언어를 모른다는 뜻이고, 이 경우 모든 언어에서 원문이 보인다.';

alter table public.investment_products
  add column if not exists description_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_lang text;

comment on column public.investment_products.description_i18n is
  '언어코드 → 번역된 설명. properties.description_i18n과 같은 규칙.';
comment on column public.investment_products.description_lang is
  '설명 원문의 언어. NULL이면 모든 언어에서 원문이 보인다.';

-- ----------------------------------------------------------------------------
-- 컬럼 권한
-- ----------------------------------------------------------------------------
-- 두 테이블은 이미 authenticated에게 테이블 단위 select/insert/update가 있고
-- (20260910061326, 20260910070155), 컬럼 단위 GRANT를 쓰지 않으므로 새 컬럼도
-- 자동으로 포함된다. 누가 무엇을 바꿀 수 있는지는 기존 RLS 정책이 그대로 정한다.
-- 여기서 정책을 건드리지 않는 것이 중요하다 — 설명은 매물의 일부이지 별도 자원이 아니다.
