-- ============================================================================
-- [2026-09-16 정책 감사 결함 ①] property_manage 계정이 자기 사진을 못 읽는다
--
-- 정책을 나란히 놓으면 바로 보인다:
--
--   property_images INSERT _permitted   있다  → 사진을 넣을 수 있다
--   property_images DELETE _permitted   있다  → 사진을 지울 수 있다
--   property_images SELECT _permitted   없다  → **읽을 수 없다**
--
-- properties에는 properties_select_permitted가 있는데 property_images에는 대응하는
-- 정책이 없다. 그래서 업체에 속하지 않고 관리자도 아니며 property_manage 권한만 받은
-- 계정이 **비공개(draft) 매물**을 수정하려고 열면, 본문은 보이는데 이미 올린 사진이
-- 하나도 안 보인다(listPropertyImages가 0건을 돌려준다).
--
-- 부모 매물이 active가 되면 _active_public으로 보이므로 비공개 상태에서만 나타난다.
-- 그래서 지금까지 눈에 띄지 않았다.
--
-- 지금 고치는 이유: 확정-결정사항 3으로 M7(계정 권한 관리)을 되살렸다. 관리자가
-- 앱에서 개별 계정에 property_manage를 줄 수 있게 되어, 정확히 이 조건의 계정이
-- 3개 기기 테스트에서 만들어진다.
--
-- 조건은 같은 표의 INSERT·DELETE _permitted 정책과 **글자 그대로 같게** 둔다 —
-- 넣고 지울 수 있는 것과 읽을 수 있는 것이 다르면 또 다른 비대칭이 생긴다.
--
-- 같은 감사에서 나온 나머지 두 건은 **고치지 않는다**(2026-09-16 사용자 결정):
--   · 결함 ② 사진 UPDATE가 관리자 전용 — 지금은 앱에 사진 수정 경로가 없다.
--     사진 순서 바꾸기를 붙일 때 함께 연다.
--   · 주의사항 featured 직접 수정 — 앱 화면에 토글이 없어 정상 사용으로는 일어나지
--     않고, set_ad_bid가 돌 때 정리된다. 빌드 직전에 권한을 더 건드리지 않는다.
-- ============================================================================

drop policy if exists property_images_select_permitted on public.property_images;

create policy property_images_select_permitted
  on public.property_images
  for select
  to authenticated
  using (
    public.has_user_permission('property_manage')
    and exists (
      select 1
      from public.properties p
      where p.id = property_images.property_id
        and p.created_by = auth.uid()
    )
  );

comment on policy property_images_select_permitted on public.property_images is
  'property_manage 권한자가 자기가 등록한 매물의 사진을 읽는다. 같은 표의 insert/delete _permitted와 같은 조건 — 비공개 매물 수정 화면에서 사진이 비어 보이던 결함(2026-09-16 정책 감사 ①)을 막는다.';

-- 적용 후 확인(2026-09-16 실측으로 아래와 일치함을 확인했다):
--   select cmd, count(*) from pg_policies
--   where schemaname = 'public' and tablename = 'property_images' group by cmd;
--     SELECT 4 · INSERT 3 · UPDATE 1 · DELETE 3 = 11
