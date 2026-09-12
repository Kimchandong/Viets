-- ============================================================================
-- [2026-09-12 사용자 지시] 거래완료(또는 보류) 처리 시 유료광고 자리를 자동으로 반납
--
-- 지금까지: 상태를 'sold'/'draft'로 바꾸면 고객 화면에서는 사라졌지만
-- (조회가 status='active'만 본다) property_ad_slots 행은 남아 있었다. 그 결과
--   · 자리 수 계산(set_ad_bid)이 그 행을 세어, 팔린 매물이 남의 자리를 계속 막고
--   · 순위표에는 노출되지 않는 매물이 상위에 박혀 있는 것처럼 보였다.
--
-- 광고는 "지금 팔 수 있는 매물"에만 의미가 있으므로, 매물이 공개 상태를 벗어나는
-- 순간 자리를 비운다. 다시 공개로 돌리면 자동 복귀하지 않는다 — 그 사이 자리는
-- 다른 업체가 가져갔을 수 있고, 되돌아올 자리를 남겨 두면 순위가 흔들린다(사용자
-- 결정: 밀려나거나 빠진 자리는 다시 설정해야 한다).
--
-- 클릭 과금은 영향받지 않는다. charge_ad_click은 active_ad_slots에 있는 매물만
-- 과금하는데, 자리가 사라지면 거기 들어 있을 수 없다.
-- ============================================================================

create or replace function public.release_ad_slots_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 공개(active)에서 벗어나는 순간에만 움직인다. 이미 비공개였던 매물을 수정할 때마다
  -- 지우려 들면 불필요한 쓰기가 반복된다.
  if new.status is distinct from 'active' and old.status is distinct from new.status then
    delete from public.property_ad_slots where property_id = new.id;
    -- 추천 표시는 광고 자리와 한 몸이다 — 자리를 비우면 함께 내린다.
    new.featured := false;
    new.featured_until := null;
  end if;

  return new;
end;
$$;

comment on function public.release_ad_slots_on_status() is
  '매물이 공개 상태를 벗어나면(거래완료/보류) 유료광고 자리를 반납한다. 다시 공개해도 자동 복귀하지 않는다.';

drop trigger if exists properties_release_ad_slots on public.properties;

create trigger properties_release_ad_slots
  before update of status on public.properties
  for each row
  execute function public.release_ad_slots_on_status();

-- ----------------------------------------------------------------------------
-- 기존 데이터 정리 — 이미 공개가 아닌 매물이 붙잡고 있던 자리를 비운다
-- ----------------------------------------------------------------------------

delete from public.property_ad_slots s
using public.properties p
where p.id = s.property_id
  and p.status is distinct from 'active';

update public.properties
set featured = false, featured_until = null
where featured
  and status is distinct from 'active';
