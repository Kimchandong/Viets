-- STEP 04 — 찜하기(즐겨찾기) 서버 저장. DATABASE.md §4 "watchlists / favorites" 설계를
-- 그대로 구현한다. 지금까지는 store/useFavoritesStore.ts의 메모리 상태라 앱을 재시작하면
-- 찜이 전부 사라졌다.
--
-- 이 테이블은 DATABASE.md §4 원문대로 클라이언트가 직접 write하는 예외 테이블이다
-- (금전 데이터가 아니므로 Edge Function을 경유하지 않는다) — 대신 RLS로 본인 행만
-- 다루도록 강제한다.
--
-- ⚠️ GRANT 필수(2026-09-10 재발 방지 규칙, DATABASE.md 상단 참고): RLS 정책만 만들고
-- GRANT를 빠뜨리면 permission denied로 전부 거부된다.

create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- DATABASE.md §4 원문의 target_type text('property'|'investment_product') 구조를
  -- 그대로 유지한다(enum으로 바꾸지 않음) — investment_products 테이블이 아직 없어
  -- target_id에 FK를 걸 수 없는 폴리모픽 패턴이라, 값 제약만 CHECK로 둔다.
  target_type text not null check (target_type in ('property', 'investment_product')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

comment on table public.favorites is
  '사용자별 관심 매물/투자상품(찜). target_type+target_id 폴리모픽 참조 — investment_products 테이블 생성(STEP 05) 후에도 FK는 걸지 않는다(대상 테이블이 둘이라 단일 FK로 표현 불가).';

create index favorites_user_id_idx on public.favorites (user_id);
create index favorites_target_idx on public.favorites (target_type, target_id);

alter table public.favorites enable row level security;

-- Owner-Only: 본인 행만 조회/추가/삭제. UPDATE 정책은 두지 않는다 — 찜은 토글
-- (insert/delete)만 존재하고 수정할 컬럼 자체가 없다.
create policy "favorites_select_own"
  on public.favorites for select
  to authenticated
  using (user_id = auth.uid());

create policy "favorites_insert_own"
  on public.favorites for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "favorites_delete_own"
  on public.favorites for delete
  to authenticated
  using (user_id = auth.uid());

-- 비로그인(anon)은 찜 자체가 불가능하므로 어떤 권한도 주지 않는다.
grant select, insert, delete on public.favorites to authenticated;
