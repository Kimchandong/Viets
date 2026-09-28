-- ============================================================================
-- 분양(presale) 거래 종류 · 단일(%) 배당주기 추가
--
-- 왜 필요한가: 두 값 모두 **화면에는 선택지로 있는데 DB에는 없었다.**
--   · 매물 > 종류 > 분양  → property_listing_type enum에 'presale'이 없어 0건
--   · 투자 > 배당주기 > 단일(%) → dividend_frequency check에 'single'이 없어 0건
-- 고르면 아무것도 안 나오니 사용자에게는 "검색이 고장난 것"으로 보인다.
--
-- 이전 마이그레이션:
--   20260910045923_property_listing_fields.sql (property_listing_type 생성)
--   20260910070155_investment_domain.sql       (dividend_frequency check 생성)
-- ============================================================================

-- ── 1. property_listing_type에 'presale' ────────────────────────────────────
-- add value if not exists라 여러 번 실행해도 안전하다. 같은 트랜잭션 안에서 이 값을
-- **쓰지는** 않는다 — 쓰면 Postgres가 거부한다(새 enum 값은 커밋 후에 쓸 수 있다).
alter type public.property_listing_type add value if not exists 'presale';

comment on column public.properties.listing_type is
  '매매(for_sale)/임대(for_rent)/분양(presale) 구분 — properties.status(등록 진행 상태)와는 독립된 축. price 컬럼의 의미가 이 값에 따라 달라진다: for_sale·presale이면 총 대금, for_rent이면 currency 기준 월세(1개월 임대료).';

-- ── 2. dividend_frequency에 'single' ────────────────────────────────────────
-- check 제약은 새 값을 덧붙일 수 없어 지우고 다시 만든다. 이름을 못 박아 두지
-- 않았으므로 컬럼에 걸린 제약을 찾아 지운다(여러 번 실행해도 안전하다).
do $$
declare
  v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public'
     and rel.relname = 'investment_products'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%dividend_frequency%'
   limit 1;

  if v_name is not null then
    execute format('alter table public.investment_products drop constraint %I', v_name);
  end if;
end $$;

alter table public.investment_products
  add constraint investment_products_dividend_frequency_check
  check (dividend_frequency in ('monthly', 'quarterly', 'yearly', 'single'));

comment on column public.investment_products.dividend_frequency is
  '배당주기 — monthly/quarterly/yearly, 그리고 single(단일 %: 만기에 한 번만 지급). NULL이면 미정.';
