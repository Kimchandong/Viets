-- ============================================================================
-- [2026-09-12] 푸시를 받는 사람의 언어로 / 수신함 알림도 푸시로
--
-- 두 가지를 고친다.
--
-- 1) **푸시가 한국어로만 나간다.** ad-click / ad-bid 엣지 함수가 문구를 한국어
--    문자열로 박아 보내고 있다. 앱은 6개 언어인데 베트남 사용자도 한국어 푸시를
--    받는다. 앱 안(i18n)은 맞고 앱 밖(푸시)만 틀린 상태다.
--
--    푸시는 앱이 꺼져 있을 때 표시되므로 앱의 i18n을 쓸 수 없다 — 보내는 쪽이
--    받는 사람의 언어를 알아야 한다. 토큰은 기기마다 하나이고 언어도 기기 설정이므로
--    **토큰에 언어를 붙인다**(사용자 단위가 아니라 기기 단위인 것이 맞다 — 한 사람이
--    한국어 폰과 베트남어 폰을 쓸 수 있고, 각 기기는 자기 언어로 받아야 한다).
--
-- 2) **수신함 알림이 푸시로 나가지 않는다.** 09-12에 만든 user_notifications는 앱을
--    열어야 보인다. 충전이 승인됐는데 앱을 안 열면 모른다.
--
--    발송 여부를 여기에 기록한다(pushed_at) — 두 번 보내지 않기 위해서다. 실제 발송은
--    엣지 함수(send-push)가 한다. DB는 외부로 요청을 보낼 수 없다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 토큰에 언어
-- ---------------------------------------------------------------------------

alter table public.push_tokens
  add column if not exists lang text;

comment on column public.push_tokens.lang is
  '이 기기의 앱 언어(vi/ko/en/zh/ja/th). 푸시 문구를 이 언어로 만든다. NULL이면 발송 쪽이 vi로 본다.';

-- register_push_token에 언어를 추가한다. **인자 목록이 바뀌므로 예전 2인자 함수를
-- 먼저 지운다** — 남겨 두면 구버전 앱이 그쪽을 계속 부르고, 언어 없는 토큰이 쌓인다.
drop function if exists public.register_push_token(text, text);

create or replace function public.register_push_token(
  p_token text,
  p_platform text,
  p_lang text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not-authenticated' using errcode = '28000';
  end if;
  if coalesce(btrim(p_token), '') = '' then
    raise exception 'empty-token' using errcode = '22023';
  end if;

  insert into public.push_tokens (user_id, token, platform, lang)
  values (auth.uid(), p_token, p_platform, nullif(btrim(coalesce(p_lang, '')), ''))
  on conflict (token)
  do update set
    user_id = auth.uid(),
    platform = excluded.platform,
    -- 기기 언어가 바뀌면 따라간다. 값을 주지 않은 호출이 기존 언어를 지우지는 않는다.
    lang = coalesce(excluded.lang, public.push_tokens.lang),
    updated_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text, text) from public;
grant execute on function public.register_push_token(text, text, text) to authenticated;

comment on function public.register_push_token(text, text, text) is
  '기기 푸시 토큰 등록/갱신. 언어를 함께 받아 푸시 문구를 그 언어로 만든다.';

-- ---------------------------------------------------------------------------
-- 2. 수신함 알림의 발송 기록
-- ---------------------------------------------------------------------------

alter table public.user_notifications
  add column if not exists pushed_at timestamptz;

comment on column public.user_notifications.pushed_at is
  '푸시를 실제로 보낸 시각. NULL이면 아직 보내지 않았다 — 같은 알림을 두 번 보내지 않기 위한 표시다.';

-- 아직 안 보낸 것만 훑는 조회가 대부분이라 부분 인덱스로 둔다(보낸 행은 색인에서 빠진다).
create index if not exists user_notifications_unpushed_idx
  on public.user_notifications (kind, dedupe_key)
  where pushed_at is null;
