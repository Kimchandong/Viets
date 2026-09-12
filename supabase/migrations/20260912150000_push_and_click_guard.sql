-- ============================================================================
-- [2026-09-12 사용자 지시]
--   ① 광고비 잔액 소진 시 등록자에게 **푸시 알림** 발송
--   ② 클릭 어뷰징 방어를 IP/디바이스 기준으로 옮김 (엣지 함수 ad-click)
--
-- 구조
--   앱은 더 이상 charge_ad_click을 직접 부르지 않는다. 엣지 함수 ad-click이
--   요청 IP를 해시해 넘겨 주고(클라이언트가 스스로 보내는 값은 위조할 수 있으므로
--   서버가 헤더에서 읽는다), 잔액이 0이 되면 Expo 푸시까지 보낸다.
--   그래서 이 마이그레이션은 anon/authenticated의 charge_ad_click 실행 권한을 **회수**한다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 푸시 토큰
-- ----------------------------------------------------------------------------

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Expo push token(ExponentPushToken[...]). 기기마다 하나씩이라 사용자당 여러 행.
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  unique (token)
);

comment on table public.push_tokens is
  '기기별 Expo 푸시 토큰. 같은 토큰이 다른 계정으로 재등록될 수 있어 token 자체를 유일키로 둔다(기기 주인이 바뀌면 행이 갱신된다).';

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

drop policy if exists "push_tokens_select_own" on public.push_tokens;
create policy "push_tokens_select_own"
  on public.push_tokens for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "push_tokens_insert_own" on public.push_tokens;
create policy "push_tokens_insert_own"
  on public.push_tokens for insert
  to authenticated
  with check (user_id = auth.uid());

-- 같은 기기를 다른 계정으로 다시 등록하는 경우가 있어 UPDATE도 본인 행으로 연다.
-- (앞 주인의 행을 빼앗는 것은 막는다 — using 절이 본인 행만 허용한다.)
drop policy if exists "push_tokens_update_own" on public.push_tokens;
create policy "push_tokens_update_own"
  on public.push_tokens for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "push_tokens_delete_own" on public.push_tokens;
create policy "push_tokens_delete_own"
  on public.push_tokens for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.push_tokens to authenticated;

-- 기기 주인이 바뀌었을 때(로그아웃 후 다른 계정 로그인) 토큰 소유자를 갈아끼운다.
-- 정책만으로는 "남의 행을 내 것으로" 바꿀 수 없어 함수로 처리한다.
create or replace function public.register_push_token(p_token text, p_platform text)
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

  insert into public.push_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (token)
  do update set user_id = auth.uid(), platform = excluded.platform, updated_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. 알림 본문을 앱이 아니라 발송 쪽에서도 알 수 있게
-- ----------------------------------------------------------------------------
--
-- ad_notifications는 kind만 갖고 있었다(문구는 앱이 i18n으로 만든다). 푸시는 앱 밖에서
-- 표시되므로 보낸 시점의 문구가 필요하다 — 발송 여부도 함께 기록한다.

alter table public.ad_notifications
  add column if not exists pushed_at timestamptz;

comment on column public.ad_notifications.pushed_at is
  '푸시 발송 시각. 같은 알림을 두 번 보내지 않기 위한 표시 — 앱 안 표시(read_at)와는 별개다.';

-- ----------------------------------------------------------------------------
-- 3. 클릭 어뷰징 방어 — IP 해시
-- ----------------------------------------------------------------------------

alter table public.ad_click_log
  add column if not exists ip_hash text;

comment on column public.ad_click_log.ip_hash is
  '요청 IP의 해시(엣지 함수가 헤더에서 읽어 해시한다). 원본 IP는 저장하지 않는다 — 개인정보를 남기지 않으면서 같은 곳에서 온 반복 클릭만 가려낸다.';

create index if not exists ad_click_log_ip_idx
  on public.ad_click_log (property_id, placement, ip_hash, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. 과금 함수 — IP 기준 중복 방지 추가
-- ----------------------------------------------------------------------------
--
-- 반환값을 넓힌다: 차감액뿐 아니라 "잔액이 이번에 0이 되었는지"를 함께 돌려줘야
-- 엣지 함수가 푸시를 보낼지 판단할 수 있다.

create or replace function public.charge_ad_click(
  p_property_id uuid,
  p_placement text,
  p_ip_hash text,
  p_viewer uuid
)
returns table (charged numeric, depleted boolean, owner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_placement public.ad_placement;
  v_agency uuid;
  v_bid numeric;
  v_available numeric;
  v_charge numeric;
  v_owner uuid;
begin
  charged := 0;
  depleted := false;
  owner_id := null;

  begin
    v_placement := p_placement::public.ad_placement;
  exception when others then
    return next;
    return;
  end;

  select s.bid_amount, s.agency_id
    into v_bid, v_agency
  from public.property_ad_slots s
  where s.property_id = p_property_id and s.placement = v_placement;

  if v_bid is null then
    return next;
    return;
  end if;

  -- 노출되지 않는 순위(자리 수 밖)는 과금하지 않는다.
  if not exists (
    select 1 from public.active_ad_slots(p_placement) a where a.property_id = p_property_id
  ) then
    return next;
    return;
  end if;

  -- 같은 사람(로그인) 또는 같은 곳(IP)에서 1시간 안에 다시 누른 경우는 이미 받은 것으로 본다.
  -- 비로그인 클릭까지 걸러지도록 IP 해시를 함께 본다 — 이것이 이번 변경의 핵심이다.
  if exists (
    select 1
    from public.ad_click_log l
    where l.property_id = p_property_id
      and l.placement = v_placement
      and l.created_at > now() - interval '1 hour'
      and (
        (p_viewer is not null and l.viewer_id = p_viewer)
        or (p_ip_hash is not null and l.ip_hash = p_ip_hash)
      )
  ) then
    return next;
    return;
  end if;

  v_available := coalesce(public.agency_available_internal(v_agency), 0);
  if v_available <= 0 then
    return next;
    return;
  end if;

  -- 마지막 클릭에서는 남은 잔액만큼만 받는다 — 잔액을 음수로 만들지 않는다.
  v_charge := least(v_bid, v_available);

  insert into public.balance_entries (agency_id, amount, kind, ref_id, memo, created_by)
  values (
    v_agency,
    -v_charge,
    v_placement::text::public.balance_entry_kind,
    p_property_id,
    'click',
    p_viewer
  );

  insert into public.ad_click_log (property_id, placement, viewer_id, charged, ip_hash)
  values (p_property_id, v_placement, p_viewer, v_charge, p_ip_hash);

  charged := v_charge;

  if v_available - v_charge <= 0 then
    depleted := true;

    select m.user_id into v_owner
    from public.agency_members m
    where m.agency_id = v_agency and m.status = 'active' and m.role_in_agency = 'owner'
    order by m.created_at asc
    limit 1;

    owner_id := v_owner;

    if v_owner is not null then
      insert into public.ad_notifications (user_id, kind, dedupe_key)
      values (v_owner, 'balance_empty', v_agency::text || ':' || to_char(now(), 'YYYY-MM-DD'))
      on conflict (user_id, kind, dedupe_key) do nothing;
    end if;
  end if;

  return next;
end;
$$;

revoke all on function public.charge_ad_click(uuid, text, text, uuid) from public, anon, authenticated;

comment on function public.charge_ad_click(uuid, text, text, uuid) is
  '광고 클릭 과금 — 엣지 함수 ad-click 전용(service_role). 앱에서 직접 부를 수 없다: IP 해시와 조회자 id를 서버가 정해야 위조되지 않는다.';

-- 앱이 직접 부르던 2인자 버전은 없앤다. 남겨 두면 IP 방어를 우회하는 경로가 된다.
drop function if exists public.charge_ad_click(uuid, text);
