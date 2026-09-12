-- ============================================================================
-- [2026-09-12 사용자 지시] 광고비를 "등록자별"로 집계해서 본다
--
-- 지금까지 MY 상단은 **내 업체의 남은 잔액**만 보여 줬다. 그런데 관리자가 이 화면에서
-- 알고 싶은 것은 잔액이 아니라 **플랫폼이 받은 광고비**다 — 등록자들이 넣은 돈과,
-- 그중 노출로 실제 빠져나간 돈.
--
-- 바뀌는 것(사용자 결정):
--   · MY 상단 주황 큰 글씨 = **노출광고로 차감된 금액의 합산**
--     (관리자는 전체 업체 합 = 플랫폼 광고 수익, 업체는 자기 업체 것)
--   · 그 아래 회색 = **입금 합산액** (관리자는 전체 업체 합)
--   · MY > 광고비 정산 = 관리자에게는 **등록자 리스트**(업체별 차감액/입금액/잔액)
--
-- "노출광고로 차감된 금액"은 클릭 과금(featured / top10)만 센다. 매물 등록비
-- (property_register)는 광고가 아니라 등록 수수료라 성격이 다르다 — 한 숫자에 섞으면
-- "광고로 얼마를 벌었나"를 알 수 없게 된다.
--
-- 보이는 범위는 한 함수 안에서 갈린다: 관리자는 전체 업체, 그 외에는 자기가 활성
-- 멤버인 업체만. security definer라 RLS를 우회하므로 **함수 안에서 직접 확인한다**
-- (agency_balance가 쓰는 것과 같은 방식).
-- ============================================================================

create or replace function public.ad_billing_summary()
returns table (
  agency_id uuid,
  agency_name text,
  ad_spent numeric,
  total_deposited numeric,
  available numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.name,
    -- 노출광고 차감분만. 원장에는 음수로 쌓이므로 부호를 뒤집어 "쓴 돈"으로 만든다.
    coalesce(
      -sum(e.amount) filter (
        where e.amount < 0 and e.kind in ('featured', 'top10')
      ),
      0
    ) as ad_spent,
    coalesce(sum(e.amount) filter (where e.amount > 0), 0) as total_deposited,
    coalesce(sum(e.amount), 0) as available
  from public.agencies a
  left join public.balance_entries e on e.agency_id = a.id
  where public.is_admin_or_above()
     or public.is_active_agency_member(a.id)
  group by a.id, a.name
  order by ad_spent desc, a.name asc;
$$;

revoke all on function public.ad_billing_summary() from public;
grant execute on function public.ad_billing_summary() to authenticated;

comment on function public.ad_billing_summary() is
  '업체별 광고비 집계 — ad_spent(노출광고 클릭 차감 합산), total_deposited(입금 합산), available(잔액). 관리자는 전체 업체, 그 외에는 본인이 활성 멤버인 업체만 돌려준다.';
