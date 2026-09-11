import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { setStatusBarBackgroundColor, setStatusBarStyle, setStatusBarTranslucent } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import {
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { FadeInText } from "@/components/FadeInText";
import { HorizontalCardCarousel } from "@/components/HorizontalCardCarousel";
import { InvestmentCard } from "@/components/InvestmentCard";
import { PropertyCard } from "@/components/PropertyCard";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, layout, opacity, radius, spacing, textStyles, typography, ThemeColors } from "@/constants/theme";
import {
  HOME_CATEGORIES,
  HOME_INVEST_CATEGORIES,
  type MockInvestmentProduct,
  type MockProperty,
} from "@/constants/mockData";
import { listProperties } from "@/services/properties";
import { listInvestmentProducts } from "@/services/investments";
import { listBoardPosts, type BoardPost } from "@/services/boards";
import { getNewInvestmentCount, getUnreadChatCount } from "@/services/notifications";

// STEP 4-9B — Home UI 레이아웃 기반. 실제 Property/Market 데이터 fetch는 하지 않는다
// (constants/mockData.ts의 mock 값만 사용).
//
// [FULL-DEV] 매물 카드 press를 app/property-detail/[id].tsx로 연결했고, 기존에 없던
// "추천 투자상품"(MOCK_INVESTMENT_PRODUCTS 기반) 섹션을 추가해 Home에서도 Invest
// 상세로 바로 진입할 수 있게 했다(§7 요구사항 — Home 최소 구성에 추천 투자상품 포함).
// 위치/알림/시장 소식은 아직 실제 기능이 없으므로 기존처럼 showComingSoon으로 남긴다.

export default function HomeScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지, 비로그인 공개 화면)
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<string | null>(null);

  // [STEP: 2026-09-09-9] 사용자 요청 — 상단 배너를 정적 이미지에서 영상(무음 반복
  // 재생)으로 교체. 실제 오디오 트랙이 없는 5초 루프 클립이라 muted는 형식상 켜두는
  // 정도지만, 오디오가 있는 영상으로 교체되더라도 배경 장식 용도라 소리가 나지
  // 않도록 항상 muted를 유지한다.
  const heroVideoPlayer = useVideoPlayer(require("@/assets/videos/home/banner-flag.mp4"), (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  // [STEP S-2, 2026-09-09] 사용자 요청 — 상단 배너가 상태바 영역까지 이어지고(흰
  // 여백 없음) 그 아래 흰 콘텐츠 영역만 좌우 상단이 16px 라운딩되어야 한다. 이
  // 화면(Home)에 포커스가 있는 동안만 상태바를 투명(translucent)+밝은 아이콘으로
  // 전환하고, 다른 탭으로 이동하면(다른 화면은 흰 배경이라 어두운 아이콘이 맞음)
  // 원래 상태로 되돌린다 — 탭 화면들은 전환 시 unmount되지 않으므로
  // expo-status-bar의 "컴포넌트 unmount 시 자동 복원"이 아니라 useFocusEffect로
  // 포커스 진입/이탈 시점에 직접 전환한다.
  // [STEP: 2026-09-09-9] 같은 이유(탭 화면은 전환 시 unmount되지 않음)로, 배너
  // 영상도 Home 탭에 포커스가 없는 동안은 일시정지해 불필요한 배터리/리소스
  // 소모를 막는다.
  useFocusEffect(
    useCallback(() => {
      setStatusBarTranslucent(true);
      setStatusBarStyle("light");
      setStatusBarBackgroundColor("transparent", true);
      heroVideoPlayer.play();
      return () => {
        setStatusBarTranslucent(false);
        setStatusBarStyle("dark");
        setStatusBarBackgroundColor("#ffffff", true);
        heroVideoPlayer.pause();
      };
    }, [heroVideoPlayer])
  );
  // [STEP: 홈 카테고리 2탭 전환] "카테고리" 라벨을 없애고 그 자리를 "부동산 투자"/
  // "부동산 매물" 2개 탭으로 바꿨다.
  // [STEP: 2026-09-08 사용자 요청] 기본 선택 탭을 "부동산 매물"에서 "부동산 투자"로
  // 바꿨다 — 탭에 따라 아래 노출되는 섹션도 달라진다(부동산 투자: 추천 투자상품 +
  // 전체상품(투자 페이지와 동일한 목록) / 부동산 매물: 추천 매물 + 주변 매물 +
  // 시장 동향, 추천 투자상품은 제외).
  const [categoryTab, setCategoryTab] = useState<"property" | "invest">("invest");
  // [STEP: 2026-09-08 사용자 요청] 홈 검색창을 "누르면 /property로 이동만 하는 버튼"에서
  // 실제 텍스트 입력이 가능한 검색창으로 바꿨다 — 커서가 실제로 동작해야 한다는 요청.
  const [homeSearch, setHomeSearch] = useState("");

  // [STEP 04] 매물 목록 실DB 조회. 홈 탭은 다른 탭으로 이동해도 unmount되지 않으므로
  // (§useFocusEffect 주석 참고) 마운트 시 1회 조회한다 — SQL/등록으로 매물이 추가된
  // 경우 앱을 새로고침해야 반영된다(property.tsx와 동일한 정책).
  const [properties, setProperties] = useState<MockProperty[]>([]);
  const [investmentProducts, setInvestmentProducts] = useState<MockInvestmentProduct[]>([]);
  // [2026-09-11 사용자 지시] 홈의 "시장 소식"을 관리자가 올린 공지사항 최신 10건으로
  // 바꾼다. 이전에는 constants/mockData.ts의 MOCK_MARKET_INSIGHTS 3건이 코드에 박혀
  // 있어 내용이 고정이었고, 번역도 되지 않았다(베트남어 원문 그대로).
  const [notices, setNotices] = useState<BoardPost[]>([]);
  const [faqs, setFaqs] = useState<BoardPost[]>([]);
  // [2026-09-11 사용자 지시] 상단 우측 알림 두 개 — 부동산(상담 미읽음) / 투자(신규 상품).
  // 숫자는 DB 함수가 센다(services/notifications.ts 주석 참고).
  const [unreadChats, setUnreadChats] = useState(0);
  const [newInvestments, setNewInvestments] = useState(0);

  // [2026-09-11 사용자 지시] 화면에 들어올 때마다 다시 조회한다.
  // 이전에는 useEffect(..., [])로 **마운트 시 1회만** 불러왔다. Expo Router는 탭
  // 화면을 언마운트하지 않고 그대로 두므로, 매물을 등록하고 목록 탭으로 돌아와도
  // 새로 등록한 매물이 보이지 않았다(앱을 껐다 켜야 반영됐다).
  // useFocusEffect는 포커스를 받을 때마다 실행되므로 이 문제가 사라진다.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      listProperties().then((result) => {
        if (active) setProperties(result);
      });
      listInvestmentProducts().then((result) => {
        if (active) setInvestmentProducts(result);
      });
      listBoardPosts("notice", i18n.language, { limit: 10 }).then((result) => {
        if (active) setNotices(result);
      });
      listBoardPosts("faq", i18n.language, { limit: 5 }).then((result) => {
        if (active) setFaqs(result);
      });
      // 화면에 들어올 때마다 다시 센다 — 상담을 읽고 돌아오면 숫자가 줄어야 한다.
      getUnreadChatCount().then((count) => {
        if (active) setUnreadChats(count);
      });
      getNewInvestmentCount().then((count) => {
        if (active) setNewInvestments(count);
      });
      return () => {
        active = false;
      };
    }, [i18n.language]),
  );

  function submitHomeSearch() {
    const query = homeSearch.trim();
    router.push({ pathname: "/property", params: query ? { search: query } : {} });
  }

  function showComingSoon() {
    setToast(t("common.comingSoon"));
    setTimeout(() => setToast(null), 1600);
  }

  // [STEP 04] 홈의 매물 섹션(추천/주변·최근)도 Mock(MOCK_PROPERTIES) 대신 실제
  // Supabase properties 테이블을 읽는다 — app/(tabs)/property.tsx와 동일하게
  // services/properties.ts의 listProperties()(status='active'만 조회)를 쓴다.
  // [STEP 06] 투자상품도 실제 investment_products 테이블로 전환(시장동향은 DB 없음 — Mock 유지).
  const featured = properties.filter((property) => property.featured);
  const nearby = properties.filter((property) => !property.featured);
  const recommendedInvestments = investmentProducts.filter((product) => product.featured);
  // [STEP: 2026-09-08] "전체상품" 섹션 — invest.tsx의 "전체상품"(전체보기 없이 항상
  // 노출되는 전체 목록) 섹션과 동일하게 featured가 아닌 상품만 별도로 나열한다
  // (featured 상품은 위 "추천 투자상품" 캐러셀에서 이미 보여주므로 중복 노출하지
  // 않는다 — invest.tsx의 featured/others 분리와 동일한 원칙).
  const investAllProducts = investmentProducts.filter((product) => !product.featured);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* [STEP: 2026-09-09-9] 사용자 요청 — 상단 배너를 정적 이미지에서 사용자가
            제공한 영상(무음 반복 재생)으로 교체. 기존 ImageBackground 대신 heroBanner
            View 안에 절대위치 VideoView를 깔고 그 위에 기존 로고/위치/알림/검색창을
            그대로 얹는 구조로 바꿨다 — heroBanner 자체의 레이아웃(padding/gap/
            overflow)과 그 아래 body와의 관계는 전혀 건드리지 않는다. */}
        <View testID="home-hero-banner" style={[styles.heroBanner, { paddingTop: insets.top + spacing.md }]}>
          <VideoView
            player={heroVideoPlayer}
            style={styles.heroBannerVideo}
            contentFit="cover"
            nativeControls={false}
            allowsPictureInPicture={false}
            pointerEvents="none"
          />
          <View testID="home-top-bar" style={styles.topBar}>
            <View>
              <FadeInText
                style={[textStyles.screenTitle, { color: theme.onAccent, fontSize: typography.size.xl * 1.2 }]}
                segments={[
                  { text: "REIT", style: { fontWeight: typography.weight.bold } },
                  { text: " VIET", style: { fontWeight: typography.weight.regular } },
                ]}
              />
              {/* 사용자 요청: 로고 아래 위치 표기(아이콘+텍스트+화살표) 전체를 70% 불투명도로. */}
              <Pressable
                style={[styles.locationRow, { opacity: 0.7 }]}
                onPress={showComingSoon}
                accessibilityRole="button"
              >
                <Ionicons name="location-outline" size={14} color={theme.onAccent} />
                <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                  Thành phố Hồ Chí Minh
                </Text>
                <Ionicons name="chevron-down" size={12} color={theme.onAccent} />
              </Pressable>
            </View>
            {/* [2026-09-11 사용자 지시] 종 아이콘을 빼고 부동산 / 투자 두 개로 바꿨다.
                종은 고정 목업 숫자에 눌러도 "준비 중"이라 알림 역할을 한 적이 없다.
                부동산 = 내가 읽지 않은 매물 상담 메시지 수 → 상담 목록으로.
                투자   = 마지막으로 본 뒤 올라온 투자상품 수 → 투자 탭으로. */}
            <View style={styles.topIcons}>
              <AlertIconButton
                icon="business-outline"
                count={unreadChats}
                badgeColor={theme.danger}
                accessibilityLabel={t("tabs.property")}
                onPress={() => router.push("/chat-inbox")}
              />
              <AlertIconButton
                icon="trending-up-outline"
                count={newInvestments}
                badgeColor={theme.danger}
                accessibilityLabel={t("tabs.invest")}
                onPress={() => router.navigate("/invest")}
              />
            </View>
          </View>

          {/* 사용자 요청(2026-09-08): 실제 입력 가능한 검색창으로 교체 — 검색 아이콘/
              돋보기를 누르거나 키보드 검색(enter)을 누르면 /property로 검색어와 함께
              이동한다(property.tsx가 search 쿼리 param을 초기값으로 읽는다). 마이크
              아이콘은 이 앱에 아직 음성 인식 기능이 없어 다른 미구현 버튼과 동일하게
              showComingSoon 토스트로 응답한다(눌렀을 때 반응은 하도록). */}
          <View
            testID="home-search-bar"
            style={[
              styles.searchBar,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
          >
            <Pressable onPress={submitHomeSearch} accessibilityRole="button" hitSlop={8}>
              <Ionicons name="search" size={18} color={theme.secondaryText} />
            </Pressable>
            <TextInput
              value={homeSearch}
              onChangeText={setHomeSearch}
              onSubmitEditing={submitHomeSearch}
              placeholder={t("home.searchPlaceholder")}
              placeholderTextColor={theme.secondaryText}
              returnKeyType="search"
              autoCorrect={false}
              // [STEP: 2026-09-08] 사용자 요청 — 검색창 내부 텍스트를 caption 크기로 축소.
              // [STEP: 2026-09-09-11] 사용자 요청 — 검색창 미리보기(placeholder)
              // 글씨 12px 고정 (공용 caption 토큰은 디바이스별로 moderateScale이
              // 적용돼 11px 근처로 흔들릴 수 있어, 이 입력창만 명시적으로 고정).
              style={[textStyles.caption, styles.searchInput, { color: theme.text, fontSize: 12 }]}
            />
            {/* [2026-09-11 사용자 지시] 음성검색 아이콘 크게(18 → 22). */}
            <Pressable onPress={showComingSoon} accessibilityRole="button" hitSlop={8}>
              <Ionicons name="mic-outline" size={22} color={theme.secondaryText} />
            </Pressable>
          </View>

          {/* [2026-09-11 사용자 지시] 검색창과 흰 콘텐츠 영역 사이에 공지 5건을
              아래에서 위로 올라가는 롤링으로 보여 준다. 이 자리는 원래 배너 색만
              보이던 빈 여백(heroBanner.paddingBottom)이라 새로 자리를 만들지 않고
              그 안에 넣었다 — 아래 레이아웃이 밀리지 않는다.
              공지가 없으면 줄 자체를 그리지 않는다(빈 줄만 떠 있게 되므로). */}
          {notices.length > 0 ? (
            <NoticeTicker
              items={notices.slice(0, 5)}
              onPress={(notice) => router.push(`/board-detail/${notice.id}`)}
            />
          ) : null}
        </View>

        {/* [STEP: 2026-09-09 재작업] 기존에는 이 아래 전체를 content의 padding/gap
            안에 그대로 두고, heroBanner에는 음수 marginHorizontal/marginTop으로
            "bleed"를, 이 View에는 음수 marginTop으로 "겹침"을 각각 계산해 상쇄하는
            방식이었다 — content의 flex gap이 margin과 별개로 항상 추가되는 RN
            동작과 겹쳐 두 번이나 어긋났다(기기별로 상단/우측 여백이 뜨거나 검색창
            아래 간격이 사라지는 형태로 재발). 그래서 계산으로 상쇄하는 구조 자체를
            없앴다: heroBanner는 이제 content의 padding 바깥(직접 자식)에 있어 화면
            가로/상단 끝까지 자동으로 채워지고, 아래 body는 그 바로 다음 형제로
            내려와 배너의 paddingBottom(30px)만큼만 자연스럽게 떨어진다 — 더 이상
            상쇄할 gap도, 겹쳐야 할 margin도 없다. 라운딩된 흰 카드 배경/좌우 padding도
            섹션마다 개별 지정하지 않고 body 하나로 통일했다. */}
        <View testID="home-body-mask" style={styles.bodyMask}>
        <View testID="home-body" style={[styles.body, { backgroundColor: theme.background }]}>
        <View testID="home-section-category-tabs" style={styles.section}>
          {/* 사용자 요청(2026-09-08): 두 탭을 하나의 라운딩 배경(테두리색은 아래
              categoryIcon과 동일한 theme.border)으로 감싼다 — 바깥 pill 컨테이너에
              옅은 padding을 둬 활성 탭이 그 안에서 다시 완전히 둥근 파란색 pill로
              떠 보이게 하고, 비활성 탭은 바깥 배경(theme.card, 연회색) 위에 텍스트만
              얹혀 보이도록 한다. */}
          <View testID="home-category-tab-row" style={[styles.categoryTabRow, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <CategoryTabButton
              label={t("home.categoryTabs.invest")}
              active={categoryTab === "invest"}
              onPress={() => setCategoryTab("invest")}
              theme={theme}
            />
            <CategoryTabButton
              label={t("home.categoryTabs.property")}
              active={categoryTab === "property"}
              onPress={() => setCategoryTab("property")}
              theme={theme}
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.bleedScroll}
            contentContainerStyle={styles.categoryRow}
          >
            {categoryTab === "property"
              ? HOME_CATEGORIES.map((category) => (
                  <CategoryIconButton
                    key={category.id}
                    icon={category.icon}
                    label={t(`categories.property.${category.id}`)}
                    onPress={() =>
                      router.push({ pathname: "/property", params: { category: category.id } })
                    }
                    theme={theme}
                  />
                ))
              : HOME_INVEST_CATEGORIES.map((category) => (
                  <CategoryIconButton
                    key={category.id}
                    icon={category.icon}
                    label={t(`categories.invest.${category.id}`)}
                    onPress={() =>
                      router.push({ pathname: "/invest", params: { category: category.id } })
                    }
                    theme={theme}
                  />
                ))}
          </ScrollView>
        </View>

        {categoryTab === "property" ? (
          <View testID="home-section-property-featured" style={styles.section}>
            <SectionHeader
              title={t("home.featuredTitle")}
              icon="business-outline"
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/property")}
            />
            <HorizontalCardCarousel
              style={styles.bleedScroll}
              contentContainerStyle={styles.featuredRow}
              step={layout.featuredCardWidth + spacing.md}
            >
              {featured.map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  variant="featured"
                  onPress={() => router.push(`/property-detail/${property.id}`)}
                />
              ))}
            </HorizontalCardCarousel>
          </View>
        ) : null}

        {categoryTab === "invest" && recommendedInvestments.length > 0 ? (
          <View testID="home-section-invest-recommended" style={styles.section}>
            <SectionHeader
              title={t("home.recommendedInvestTitle")}
              icon="trending-up-outline"
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/invest")}
            />
            <HorizontalCardCarousel
              style={styles.bleedScroll}
              contentContainerStyle={styles.featuredRow}
              step={layout.featuredCardWidth + spacing.md}
            >
              {recommendedInvestments.map((product) => (
                <InvestmentCard
                  key={product.id}
                  product={product}
                  variant="featured"
                  onPress={() => router.push(`/invest-detail/${product.id}`)}
                />
              ))}
            </HorizontalCardCarousel>
          </View>
        ) : null}

        {/* [STEP: 2026-09-08] "부동산 투자" 탭일 때 아래로 investment 페이지(invest.tsx)의
            "전체상품" 섹션과 동일한 목록을 그대로 노출한다 — 사용자 지시("전체상품
            (투자페이지 그대로)"). */}
        {categoryTab === "invest" ? (
          <View testID="home-section-invest-all" style={styles.section}>
            {/* 사용자 요청(2026-09-09): 홈화면 부동산투자 탭의 이 섹션 제목만
                invest.tsx와 별도 문구("투자 전체")로 바꾼다 — invest.tsx 자체의
                "전체 상품" 섹션(같은 t("invest.allProductsTitle") 키)은 그대로 둔다. */}
            <SectionHeader title={t("home.allInvestProductsTitle")} />
            {investAllProducts.length === 0 ? (
              <EmptyState title={t("invest.emptyTitle")} description={t("invest.emptyDescription")} />
            ) : (
              <View style={styles.stack}>
                {investAllProducts.map((product) => (
                  <InvestmentCard
                    key={product.id}
                    product={product}
                    variant="list"
                    onPress={() => router.push(`/invest-detail/${product.id}`)}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {categoryTab === "property" ? (
          <View testID="home-section-property-nearby" style={styles.section}>
            <SectionHeader
              title={t("home.nearbyTitle")}
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/property")}
            />
            {/* [STEP 04] 실DB 전환 후에는 등록된 매물이 0건일 수 있어(초기 운영
                상태), 섹션 헤더만 덩그러니 남지 않도록 EmptyState를 노출한다 —
                위 "투자 전체" 섹션과 동일한 패턴. */}
            {nearby.length === 0 ? (
              <EmptyState title={t("property.emptyTitle")} description={t("property.emptyDescription")} />
            ) : (
              <View style={styles.stack}>
                {nearby.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    variant="list"
                    onPress={() => router.push(`/property-detail/${property.id}`)}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* [2026-09-11 사용자 지시] 공지사항 / FAQ — 홈 맨 아래에 항상 둔다.
            처음에는 "매물 탭에서만, 글이 있을 때만"으로 만들었는데 두 조건 모두
            사용자 지시로 없앴다. 공지와 FAQ는 매물에만 해당하는 내용이 아니라 두
            탭 어디서나 같은 자리에 있어야 하고, 글이 없을 때 섹션째 사라지면
            "기능이 없는 것"과 "아직 글이 없는 것"이 구분되지 않는다. */}
        <View testID="home-section-notice" style={styles.section}>
          <SectionHeader
            title={t("home.noticeTitle")}
            actionLabel={t("common.seeAll")}
            onAction={() => router.push({ pathname: "/boards", params: { kind: "notice" } })}
          />
          {notices.length === 0 ? (
            <EmptyState title={t("home.noticeEmpty")} />
          ) : (
            <View style={styles.stack}>
              {/* [2026-09-11 사용자 지시] 썸네일 형식 — 좌측 이미지, 우측 제목(2줄까지),
                  제목 아래 작성일. 첨부가 없는 공지도 같은 자리를 차지해야 줄들이
                  들쭉날쭉해지지 않으므로, 이미지가 없으면 같은 크기의 자리표시를 둔다. */}
              {notices.map((notice) => (
                <Pressable
                  key={notice.id}
                  onPress={() => router.push(`/board-detail/${notice.id}`)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.noticeCard,
                    { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  {notice.images.length > 0 ? (
                    <Image
                      source={{ uri: notice.images[0] }}
                      style={styles.noticeThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.noticeThumb, styles.noticeThumbEmpty, { backgroundColor: theme.background }]}>
                      <Ionicons name="megaphone-outline" size={20} color={theme.secondaryText} />
                    </View>
                  )}
                  <View style={styles.noticeTexts}>
                    <Text style={[textStyles.bodySmall, { color: theme.text }]} numberOfLines={2}>
                      {notice.title}
                    </Text>
                    <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                      {notice.createdAt.slice(0, 10)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* FAQ — 공지보다 적게(5건) 보여 준다. 자주 묻는 질문은 훑어보는 목록이라
            홈에서 열 줄을 차지하면 공지를 밀어낸다. 전체는 게시판에서 본다. */}
        <View testID="home-section-faq" style={[styles.section, styles.lastSection]}>
          <SectionHeader
            title={t("home.faqTitle")}
            actionLabel={t("common.seeAll")}
            onAction={() => router.push({ pathname: "/boards", params: { kind: "faq" } })}
          />
          {faqs.length === 0 ? (
            <EmptyState title={t("home.faqEmpty")} />
          ) : (
            <View style={styles.stack}>
              {faqs.map((faq) => (
                <Pressable
                  key={faq.id}
                  onPress={() => router.push({ pathname: "/boards", params: { kind: "faq" } })}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.insightCard,
                    { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  <View style={[styles.insightTag, { backgroundColor: theme.background }]}>
                    <Text style={[textStyles.caption, { color: theme.accent }]}>Q</Text>
                  </View>
                  <Text style={[textStyles.bodySmall, { color: theme.text }]} numberOfLines={2}>
                    {faq.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        </View>
        </View>
      </ScrollView>
      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </View>
  );
}

/**
 * [2026-09-11 사용자 지시] 공지 롤링 — 한 줄 높이만 차지하고, 한 건씩 아래에서
 * 위로 올라오며 바뀐다.
 *
 * 목록 전체를 길게 이어 붙여 흘리는 대신 "한 건씩 교체"로 만든 이유: 높이를 글자
 * 한 줄로 제한해야 해서(사용자 지시) 어차피 한 번에 한 건만 보이고, 교체 방식이면
 * 공지 건수가 몇 건이든 애니메이션 거리가 항상 같아 속도가 들쭉날쭉하지 않는다.
 *
 * useNativeDriver를 웹에서 끄는 이유: react-native-web에는 네이티브 애니메이션
 * 모듈이 없어 켜 두면 콘솔에 경고를 남기고 JS 구동으로 되돌아간다 — 동작은 같지만
 * 경고가 쌓여 실제 문제를 가린다.
 */
const TICKER_LINE_HEIGHT = 18;
const TICKER_HOLD_MS = 3000;
const TICKER_SLIDE_MS = 400;

/**
 * [2026-09-11 사용자 지시] 알림 수가 붙는 상단 아이콘 버튼.
 *
 * 숫자가 0보다 크면 테두리가 배지 색으로 깜박인다 — "숫자가 떠 있다"는 것만으로는
 * 배너 영상 위에서 잘 안 보인다는 지적이 있었다.
 *
 * useNativeDriver를 쓰지 않는 이유: 색을 오가는 애니메이션은 네이티브 드라이버가
 * 다루지 못한다(레이아웃·투명도·변형만 가능). 테두리 하나짜리라 JS 구동으로 충분하다.
 *
 * 깜박임은 숫자가 0이 되면 즉시 멈추고 기본 테두리로 돌아간다 — 멈추지 않으면 볼
 * 것이 없는데도 계속 시선을 끈다.
 */
// [2026-09-11 사용자 지시] 알림 버튼 배경/테두리 — 흰 반투명에서 검은 반투명으로.
// 배너 영상이 밝을 때 흰 배경 위 흰 아이콘이 묻혀 보였다.
const IDLE_BORDER = "rgba(255,255,255,0.3)";
const ICON_BUTTON_BG = "rgba(0,0,0,0.3)";
/** [2026-09-11 사용자 지시] 알림 아이콘 글리프 크기 — 20의 10% 축소. */
const ALERT_ICON_SIZE = 18;

function AlertIconButton({
  icon,
  count,
  badgeColor,
  accessibilityLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  badgeColor: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (count <= 0) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [count, pulse]);

  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [IDLE_BORDER, badgeColor],
  });

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.iconButton,
            {
              backgroundColor: ICON_BUTTON_BG,
              borderWidth: count > 0 ? 1 : StyleSheet.hairlineWidth,
              borderColor: count > 0 ? borderColor : IDLE_BORDER,
              opacity: pressed ? opacity.pressed : 1,
            },
          ]}
        >
          {/* [2026-09-11 사용자 지시] 아이콘만 10% 축소(20 → 18).
              버튼 크기(styles.iconButton)와 배지는 건드리지 않는다. */}
          <Ionicons name={icon} size={ALERT_ICON_SIZE} color="#FFFFFF" />
          {count > 0 ? (
            <View style={[styles.notificationBadge, { backgroundColor: badgeColor }]}>
              <Text style={styles.notificationBadgeText} numberOfLines={1}>
                {count > 9 ? "9+" : count}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      )}
    </Pressable>
  );
}

function NoticeTicker({
  items,
  onPress,
}: {
  items: BoardPost[];
  onPress: (notice: BoardPost) => void;
}) {
  const [index, setIndex] = useState(0);
  const translateY = useRef(new Animated.Value(TICKER_LINE_HEIGHT)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const useNative = Platform.OS !== "web";

  useEffect(() => {
    if (items.length === 0) return;

    let cancelled = false;
    translateY.setValue(TICKER_LINE_HEIGHT);
    fade.setValue(0);

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: TICKER_SLIDE_MS, useNativeDriver: useNative }),
      Animated.timing(fade, { toValue: 1, duration: TICKER_SLIDE_MS, useNativeDriver: useNative }),
    ]).start();

    // 공지가 한 건뿐이면 그대로 둔다 — 같은 문장이 계속 위아래로 움직이면 읽기만 힘들다.
    if (items.length === 1) return;

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -TICKER_LINE_HEIGHT,
          duration: TICKER_SLIDE_MS,
          useNativeDriver: useNative,
        }),
        Animated.timing(fade, { toValue: 0, duration: TICKER_SLIDE_MS, useNativeDriver: useNative }),
      ]).start(() => {
        if (!cancelled) setIndex((prev) => prev + 1);
      });
    }, TICKER_HOLD_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [index, items.length, fade, translateY, useNative]);

  // index는 계속 커지므로 나머지 연산으로 되돌린다 — 공지 건수가 줄어도 범위를 벗어나지 않는다.
  const current = items[index % items.length];
  if (!current) return null;

  return (
    <Pressable
      onPress={() => onPress(current)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.ticker, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      <View style={styles.tickerViewport}>
        <Animated.Text
          numberOfLines={1}
          style={[
            textStyles.caption,
            styles.tickerText,
            // [2026-09-11 사용자 지시] 롤링 글자색 rgba(255,255,255,0.7).
            // 투명도를 color에 직접 넣는다 — style.opacity는 이미 등장/퇴장
            // 애니메이션(fade)이 쓰고 있어 거기에 0.7을 곱하면 슬라이드 중간값이
            // 흐트러진다.
            { color: "rgba(255, 255, 255, 0.7)", opacity: fade, transform: [{ translateY }] },
          ]}
        >
          {current.title}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

function CategoryTabButton({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.categoryTabButton,
        { backgroundColor: active ? theme.accent : "transparent", opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      <Text
        style={[
          textStyles.bodySmall,
          { color: active ? theme.onAccent : theme.text, fontWeight: typography.weight.medium },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryIconButton({
  icon,
  label,
  onPress,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  theme: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.categoryItem, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      <View style={styles.categoryIcon}>
        <Ionicons name={icon} size={22} color={theme.accent} />
      </View>
      <Text style={[textStyles.caption, { color: theme.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // [STEP: 2026-09-09 재작업] 더 이상 여기서 좌우/상단 padding이나 gap을 주지
  // 않는다 — heroBanner가 이 padding을 상쇄해야 화면 가장자리까지 채워지는 기존
  // 구조(음수 margin 계산)가 여러 차례 어긋난 원인이었다(§ body 주석 참고). 이제
  // padding/gap은 전부 banner 아래 body 하나가 책임진다.
  content: {},
  // [STEP: 2026-09-08] 상단 배경 이미지 배너 — content의 좌우 padding(screenPaddingX)과
  // 상단 padding(lg)을 이 영역에서만 상쇄해 이미지가 화면 가로 100%/맨 위까지 채우게
  // 하고(bleedScroll과 동일 원칙), 내부에는 다시 동일한 좌우 padding을 줘 topBar/
  // searchBar가 기존과 같은 위치에 보이도록 한다.
  // [2026-09-11 사용자 지시] 상단 우측 알림 아이콘 두 개를 나란히.
  topIcons: {
    flexDirection: "row",
    gap: spacing.sm,
  },

  // [2026-09-11 사용자 지시] 하단 공지 목록 — 썸네일 카드.
  noticeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  noticeThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
  },
  noticeThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  // minWidth:0이 없으면 긴 제목이 카드를 밀어내 썸네일이 찌그러진다.
  noticeTexts: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },

  // [2026-09-11 사용자 지시] 공지 롤링 — 높이는 글자 한 줄만, 좌우 여백 20px.
  //
  // heroBanner가 이미 좌우 10px(spacing.screenPaddingX)을 주고 있으므로 여기서는
  // 모자란 10px만 더한다 — 20을 그대로 쓰면 화면 가장자리에서 30px이 된다.
  ticker: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginHorizontal: 20 - spacing.screenPaddingX,
  },
  // 한 줄 높이로 잘라내는 창. overflow:hidden이 없으면 위/아래로 빠져나가는 글자가
  // 검색창과 흰 카드 위에 그대로 겹쳐 보인다.
  tickerViewport: {
    flex: 1,
    height: TICKER_LINE_HEIGHT,
    overflow: "hidden",
    justifyContent: "center",
  },
  tickerText: {
    // [2026-09-11 사용자 지시] 롤링 글자 12px. caption 토큰은 기기 폭에 따라
    // 11px 근처로 흔들리므로 검색창 placeholder와 같은 방식으로 여기만 고정한다.
    fontSize: 12,
    lineHeight: TICKER_LINE_HEIGHT,
  },
  heroBanner: {
    // STEP: PropertyCard.tsx/InvestmentCard.tsx와 동일한 이유로 명시적
    // position:"relative"를 준다 — react-native-web에서는 ImageBackground의
    // absolute-fill 배경 Image가 부모가 명시적으로 relative가 아니면 가로폭을
    // 100% 채우지 못하고 원본 비율대로 줄어들어 보일 수 있다.
    //
    // [STEP: 2026-09-09 재작업] ScrollView의 contentContainerStyle(content)에는
    // 더 이상 padding이 없으므로, 이 View는 RN 기본 flex 동작(alignItems:"stretch")
    // 만으로 화면 가로 폭 전체를 자동으로 채운다 — marginHorizontal/marginTop을
    // 음수로 줘서 부모 padding을 상쇄하는 계산이 더 이상 필요 없다(이전에는 이
    // 계산이 실제 화면에서 정확히 맞아떨어지지 않아 상단/우측에 여백이 남는
    // 문제가 있었다).
    position: "relative",
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.lg,
    // 검색창 하단 ~ 아래 body(라운딩된 흰 카드) 상단 사이에 정확히 보이는 배너색
    // 간격. body가 이 배너의 형제 View로 바로 이어지고 그 사이에 gap이 전혀 없기
    // 때문에(content가 gap을 주지 않음), 이 값 자체가 곧 눈에 보이는 간격이다 —
    // 예전처럼 나중에 겹칠 만큼을 미리 더해두는 보정 계산이 필요 없다.
    // [STEP: 2026-09-09-4] 사용자 피드백(실기기 스크린샷) — 고정 30px가 실기기에서
    // 의도보다 훨씬 크게 보였다(검색창 아래 배너 색상 여백이 과도함). spacing.md(16)로
    // 줄여 "약간만 보이는 여백" 수준으로 조정.
    // [STEP: 2026-09-09-10] 사용자 제보(웹 미리보기 devtools) — 라운딩이 3번의 시도
    // 이후에도 계속 안 보였던 진짜 원인을 여기서 찾았다: bodyMask/body는 배경색이
    // theme.background(#FFFFFF, 컨테이너 배경과 동일)이고, heroBanner 바로 아래
    // "형제"로 이어질 뿐 겹치지 않았다 — 즉 body의 둥근 모서리를 아무리 정확히
    // 잘라내도(overflow:hidden) 그 잘려나간 자리에 드러나는 배경이 heroBanner의
    // 배경색(영상)이 아니라 똑같은 흰색 컨테이너 배경이라 "둥글게 잘렸다는 게
    // 시각적으로 전혀 표시가 안 나는" 상태였다 — CSS/Yoga 렌더링 버그가 아니라
    // 색상 대비가 애초에 없는 구조적 문제였다(그래서 Android 네이티브에서도,
    // 지금 이 웹 미리보기에서도 동일하게 안 보였던 것 — 플랫폼 문제가 아니었다).
    // 해결: paddingBottom을 라운딩 반경(16)만큼 확보해 두고, 아래 body쪽에서
    // 그만큼 위로 겹쳐 올라가게(marginTop: -16) 해서 잘려나간 모서리 자리에
    // heroBanner의 영상 배경이 실제로 드러나도록 한다("컬러 헤더 위에 둥근 흰
    // 카드가 겹쳐 얹힌" 전형적인 패턴).
    // [STEP: 2026-09-09-12] 사용자 요청 — 검색창 아래 실제로 보이는(라운딩 겹침 이후)
    // 여백을 60px로. bodyMask가 marginTop:-16으로 겹쳐 올라가므로, 눈에 보이는 평평한
    // 여백은 (paddingBottom - 16)이 된다 — 60px를 보이게 하려면 76(=60+16)이 필요하다.
    //
    // [2026-09-11 사용자 지시] 그 여백에 공지 롤링이 들어왔으므로 60px는 더 이상
    // "검색창 아래 빈 여백"이 아니라 "공지 줄 아래 여백"이다. 10px로 줄인다.
    // 계산 규칙은 그대로다 — 보이는 여백 10px = paddingBottom 26 - 겹침 16.
    paddingBottom: 10 + 16,
    gap: spacing.lg,
    overflow: "hidden",
  },
  // STEP: 기존 ImageBackground의 imageStyle과 동일한 이유로 필요한 스타일 —
  // 기본값(StyleSheet.absoluteFill, 즉 top/right/bottom/left:0)이
  // react-native-web에서는 신뢰할 수 없어 width/height 100%로 명시해야 했다. 그런데
  // [STEP: 2026-09-09-5] 실기기(Android) 재현 결과, 반대로 네이티브에서는 이
  // width/height:100% 방식이 문제였다 — 절대 위치 자식의 %기반 width/height는
  // Android Yoga에서 부모의 padding을 뺀 content box 기준으로 계산되어
  // (top/right/bottom/left:0 방식과 달리 padding box를 채우지 못함), heroBanner의
  // paddingTop/paddingHorizontal/paddingBottom 영역만큼 배경이 덜 채워지고 그
  // 자리에 배경(흰색)이 그대로 드러났다 — 이것이 실기기에서 보고된 "상단/우측
  // 빈공간", "검색창 아래 배경 노출 안 됨" 두 증상의 실제 원인이다.
  // [STEP: 2026-09-09-10] 사용자 제보(웹 미리보기 DOM 덤프, testID로 위치 확인) —
  // ImageBackground는 내부적으로 배경 Image에 이미 position:"absolute"를 강제
  // 적용해주는 컴포넌트였다(그 위에 이 imageStyle이 width/height만 덧씌워짐). 지금은
  // <VideoView>를 heroBanner의 평범한 형제로 직접 렌더링하므로 그 자동 처리가 더 이상
  // 없다 — 웹 분기에 position:"absolute"가 빠져 있어 영상이 배경이 아니라 topBar/
  // searchBar와 나란히 배치되는 일반 flex 자식으로 렌더링되고 있었다(gap까지 적용되어
  // 검색창 아래 여백이 60px로 부풀어 보인 원인). 네이티브 분기(absoluteFillObject)는
  // 이미 position:"absolute"를 포함하고 있어 문제없었다 — 웹 분기에도 명시적으로
  // 추가한다.
  heroBannerVideo:
    Platform.OS === "web"
      ? { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }
      : StyleSheet.absoluteFillObject,
  // [STEP: 2026-09-09 재작업] heroBanner 바로 다음 형제 — 배너와 이 View 사이에
  // gap이 전혀 없으므로(content가 더 이상 gap을 주지 않음) 겹침 계산 없이 그냥
  // 붙는다. 라운딩된 모서리가 배너의 색(흰색이 아님) 위에서 시작해야 보이므로,
  // 이 View 자체가 배경색+라운딩을 갖고 이후 모든 섹션(categorySection~마지막
  // 섹션)을 감싼다 — 좌우 padding(screenPaddingX)/섹션 간 gap(lg)도 섹션마다
  // 나눠 지정하지 않고 여기 한 곳으로 통일했다.
  // [STEP S-2, 2026-09-09-2] 사용자 재확인 — 이전 시도(body 자체에 4개 코너 +
  // overflow 명시)로도 실기기 라운딩이 여전히 보이지 않아, body의 복잡한 자식
  // 구성(여러 섹션·카드·중첩 스크롤뷰)과의 상호작용 가능성을 완전히 배제하기 위해
  // 라운딩/클리핑만 전담하는 래퍼를 한 겹 추가한다 — 이 View는 borderRadius +
  // overflow 외에는 아무 속성도 갖지 않는다(가장 단순하고 확실한 형태).
  bodyMask: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    // [STEP: 2026-09-09-10] 위 heroBanner.paddingBottom(16)만큼 위로 겹쳐 올라가
    // heroBanner의 배경(영상)이 둥근 모서리 자리에 실제로 드러나게 한다 — 라운딩
    // 반경(16)과 정확히 같은 값이어야 모서리 곡선 전체가 깔끔하게 겹쳐진다.
    marginTop: -16,
  },
  body: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.md,
    // [STEP: 2026-09-09-7] 사용자 요청 — 섹션 간 상하 여백이 너무 커 보인다는
    // 피드백으로 lg(24)에서 한 차례 sm(8)까지 줄였는데, 그 값이 section 내부(제목
    // ~ 콘텐츠) 간격(styles.section.gap)과 완전히 같아져 오히려 "영역과 영역
    // 사이"가 구분되지 않는 문제가 생겼다(사용자 재확인 — "모든 영역과 영역사이에는
    // 반드시 상하 간격이 일정하게 떨어져 있어야 구분 가능"). md(16)로 다시 올려
    // section 내부 간격(sm=8)의 2배를 유지한다 — 원래 값(24)보다는 여전히 타이트하고,
    // 섹션 내부 간격과는 명확히 구분된다(탭/카테고리~추천 타이틀, 추천~전체·주변
    // 섹션 등 body의 모든 섹션 간격이 이 값 하나를 공유한다).
    // [STEP S-2-2, 2026-09-09] 사용자 요청 — 서브카테고리~추천 타이틀 등 섹션간
    // 간격 한 단계 축소(md(16)→sm(8)). 섹션 구분이 필요하다는 기존 원칙(§section 내부
    // 간격과는 구분되어야 함)은 유지하되 전체적으로 더 좁게 조정.
    // [STEP: 2026-09-09-11] 사용자 요청(스크린샷) — "추천"/"전체" 등 섹션 타이틀
    // 위 여백을 25px로 명시 지정 (이전엔 디자인 토큰 근사치였으나 이번엔 정확한
    // px 지시라 토큰 대신 리터럴 값을 그대로 쓴다).
    gap: 25,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  // [STEP: 2026-09-09-11] 사용자 제보(스크린샷) — 알림 버튼 테두리를 없앤다.
  // [2026-09-11 사용자 지시] 알림 버튼 10% 축소(40 → 36). 안쪽 아이콘도 함께
  // 20 → 18로 줄였다(ALERT_ICON_SIZE). 배지(notificationBadge, 16px)와 그 안의
  // 숫자는 그대로 둔다 — 버튼이 작아져도 알림 수는 같은 크기로 읽혀야 한다.
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    // 배지(notificationBadge)를 이 버튼 우상단에 절대 위치로 얹기 위한 기준.
    position: "relative",
  },
  // [STEP: 2026-09-09-11] 사용자 제보(스크린샷) — 배지가 버튼 전체를 둘러싸는
  // 큰 원형 테두리처럼 보이는 문제. width를 명시하지 않고 minWidth만 쓰던 것을
  // width로 고정하고(숫자 두 자리 "9+"는 maxWidth로 별도 허용), overflow:hidden으로
  // 어떤 경우에도 16px 원 밖으로 커지지 않도록 강제한다.
  notificationBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    maxWidth: 22,
    height: 16,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    overflow: "hidden",
  },
  notificationBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: typography.weight.bold,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    padding: 0,
    // RN TextInput은 웹에서 포커스 시 기본 outline을 그리는데, 이미 테두리가 있는
    // searchBar 안에 있으므로 이중 테두리로 보이지 않도록 제거한다. outlineStyle은
    // react-native-web 전용 스타일 키라 RN의 TextStyle 타입에는 없어 any로 둔다.
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as Record<string, unknown>) : null),
  },
  section: {
    // [STEP S-2-2, 2026-09-09] 사용자 요청 — 섹션 내부(예: 투자/매물 탭 ~ 서브카테고리)
    // 간격 한 단계 축소(sm(8)→xs(4)).
    gap: spacing.xs,
  },
  lastSection: {
    paddingBottom: spacing.lg,
  },
  // STEP 4-12-1 — 가로 스크롤 캐러셀 전용: 부모(content)의 좌우 padding을 상쇄해
  // 화면 끝까지 카드가 이어지도록 한다. 캐러셀이 아닌 다른 영역(Section Header/
  // 설명/필터/일반 리스트)에는 적용하지 않는다 — content의 padding은 그대로 유지.
  // content의 좌우 padding이 spacing.screenPaddingX(10px)로 바뀌었으므로 이 값도
  // 함께 맞춘다 — 값이 어긋나면 카드가 화면 밖으로 넘치거나 여백이 남는다.
  bleedScroll: {
    marginHorizontal: -spacing.screenPaddingX,
  },
  categoryTabRow: {
    flexDirection: "row",
    alignSelf: "center",
    width: "80%",
    borderWidth: 1,
    borderRadius: radius.full,
    padding: 0,
    gap: spacing.xs,
  },
  categoryTabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  categoryRow: {
    // 사용자 요청(2026-09-08): 아이콘 간 가로 간격을 lg(24)에서 sm(8)으로 좁혔다.
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  categoryItem: {
    alignItems: "center",
    // 사용자 요청: 아이콘-텍스트 간 간격을 xs(4)보다 더 좁게(2px) 줄였다.
    gap: 2,
    width: 64,
  },
  categoryIcon: {
    // 사용자 요청: 아이콘 원의 회색 배경/테두리를 삭제했다(더 이상 backgroundColor/
    // borderColor/borderWidth를 주지 않는다) — 아이콘만 남는다.
    width: 52,
    height: 52,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  // [STEP: 2026-09-09-6] paddingHorizontal(좌우 peek 여백)은 이제
  // HorizontalCardCarousel이 layout.featuredCardSidePadding으로 직접 적용한다 —
  // 여기서는 카드 사이 gap만 남긴다.
  featuredRow: {
    gap: spacing.md,
  },
  stack: {
    gap: spacing.md,
  },
  insightCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  insightTag: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
});
