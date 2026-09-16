-- ============================================================================
-- [2026-09-16 확정-결정사항 1·9] 언어·통화를 profiles에 올리기 전에, 그 두 열을
-- "안 정했음"을 표현할 수 있게 만든다
--
-- 배경(불일치-목록 3①): profiles는 9개 열 중 id와 avatar_url 두 개만 쓰인다.
-- default_language / default_currency는 2026-08-28에 만들어진 뒤 **앱·엣지 함수·
-- SQL 어디에서도 한 번도 읽히거나 쓰인 적이 없다.** 지금 모든 행의 값은
-- 열 기본값('en' / 'USD')일 뿐이고, 사용자가 고른 값이 아니다.
--
-- 그대로 두고 "로그인하면 서버 값을 따른다"를 켜면, 기존 사용자가 로그인할 때마다
-- 화면이 영어·USD로 튕긴다. 아무도 고른 적 없는 값이 사용자의 선택을 덮어쓰는 것이다.
--
-- 그래서 NULL을 **"아직 정하지 않음"**으로 쓸 수 있게 만든다:
--
--   NULL      → 기기에서 감지/저장한 값을 쓴다. 앱이 처음 로그인할 때 그 값을 올린다.
--   값 있음   → 사용자가 고른 값이다. 로그인하면 그 값을 따른다.
--
-- 이 판정이 성립하려면 세 가지가 함께 필요하다 — 하나라도 빠지면 다시 "아무도
-- 고르지 않은 값"이 쌓인다.
-- ============================================================================

-- ① NULL을 허용한다.
alter table public.profiles
  alter column default_language drop not null,
  alter column default_currency drop not null;

-- ② 기본값을 없앤다. 남겨 두면 handle_new_user()가 profiles(id)만 넣을 때
--    새 사용자마다 다시 'en'/'USD'가 들어간다(그 함수는 이 두 열을 지정하지 않는다).
alter table public.profiles
  alter column default_language drop default,
  alter column default_currency drop default;

-- ③ 기존 값을 비운다.
--
--    지우는 것이 안전한 근거: 3단계 감사에서 이 두 열의 이름을 마이그레이션 전체·
--    엣지 함수·앱 코드에서 찾았고, 자기 정의문 한 줄 말고는 **한 번도 나오지 않았다**.
--    즉 현재 값은 전부 열 기본값이며 사용자의 선택이 아니다. 지워도 잃는 정보가 없다.
--
--    조건을 붙여 둔다 — 혹시 누군가 손으로 다른 값을 넣어 두었다면 그건 남긴다.
update public.profiles
set default_language = null
where default_language = 'en';

update public.profiles
set default_currency = null
where default_currency = 'USD';

comment on column public.profiles.default_language is
  '사용자가 고른 화면 언어. NULL이면 아직 고르지 않은 것 — 앱은 기기 설정을 쓰고, 처음 고를 때 여기 올린다.';

comment on column public.profiles.default_currency is
  '사용자가 고른 표시 통화. NULL이면 아직 고르지 않은 것. 신규 기본값은 앱이 VND로 잡는다(2026-09-16 결정).';
