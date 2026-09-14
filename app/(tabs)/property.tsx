import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { HorizontalCardCarousel } from "@/components/HorizontalCardCarousel";
import { Header } from "@/components/Header";
import { Modal } from "@/components/Modal";
import { PROPERTY_CARD_IMAGE_HEIGHT, PropertyCard } from "@/components/PropertyCard";
import { PropertyListRow } from "@/components/PropertyListRow";
import { PropertyMap } from "@/components/PropertyMap";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, layout, opacity, radius, spacing, textStyles, ThemeColors } from "@/constants/theme";
import { MOCK_REGIONS, type MockProperty, type MockPropertyStatus } from "@/constants/mockData";
import type { PropertyImageCategory } from "@/constants/mockImages";
import { listProperties } from "@/services/properties";
import { chargeAdClick, listActiveAdSlots } from "@/services/ads";
import {
  applyPropertySort,
  DEFAULT_PROPERTY_SORT,
  PropertySortControls,
  type PropertySortState,
} from "@/components/PropertySortControls";
import {
  distanceKm,
  formatDistance,
  getCurrentLocation,
  type UserLocation,
} from "@/services/location";

// [STEP: 카테고리 재구성] 홈 화면 카테고리 아이콘 탭 시 이 화면으로 category 쿼리
// param을 전달한다(app/(tabs)/home.tsx 참고) — 이 화면에서는 그 값을 서브카테고리
// 칩의 초기 선택값으로만 사용한다(그 외 필터 상태/구조는 바꾸지 않음).
const PROPERTY_CATEGORIES: PropertyImageCategory[] = [
  "apartment",
  "residential",
  "building",
  "factory",
  "land",
  "other",
];

/** [2026-09-12 사용자 지시] TOP10은 유료 광고 자리 열 칸. 빈 칸은 채우지 않는다. */
const TOP10_LIMIT = 10;

/** [2026-09-12 사용자 지시] 일반 매물은 5개씩 끊어서 내려갈 때마다 붙인다. */
const LISTINGS_PAGE_SIZE = 5;

/** [2026-09-11 사용자 지시] 지역 칩 내부 여백 — 4px → 6px → 상하 6 / 좌우 8. */
const REGION_CHIP_PADDING_Y = 6;
const REGION_CHIP_PADDING_X = 10;

// STEP 4-9B — Property UI 레이아웃 기반. 지역/상태 필터는 mock 데이터(constants/mockData.ts)에
// 대한 순수 클라이언트 필터일 뿐 실제 Supabase 쿼리는 아니다. Map 연동(Google Maps SDK)은
// Phase 4 범위 — 이 STEP은 새 dependency를 추가하지 않으므로 Map 전환은 자리표시만 제공한다.
//
// [FULL-DEV] 검색(Input)이 실제로 매물 title/location에 대해 동작하도록 연결했고,
// 정렬(최신순/가격/면적) 칩을 추가했다. 검색어가 있을 때는 featured 캐러셀(큐레이션 성격)
// 대신 매칭된 매물을 하나의 목록으로만 보여준다 — 검색 결과와 "추천"을 섞지 않기 위함이다.
// 카드 press는 이제 showComingSoon 대신 app/property-detail/[id].tsx로 실제 이동한다.

type StatusFilter = "all" | MockPropertyStatus;
type ViewMode = "list" | "map";
type SortOption = "newest" | "priceLow" | "priceHigh" | "areaLarge";

// [STEP: 2026-09-09] 사용자 요청 — 전체/매매/임대, 정렬 칩 목록을 셀렉트(Modal)로
// 전환하면서 옵션 목록을 invest.tsx의 RISK_OPTIONS와 동일한 패턴으로 뺀다.
const STATUS_OPTIONS: StatusFilter[] = ["all", "forSale", "forRent"];
const SORT_OPTIONS: SortOption[] = ["newest", "priceLow", "priceHigh", "areaLarge"];

function sortProperties(properties: MockProperty[], sort: SortOption): MockProperty[] {
  const copy = [...properties];
  switch (sort) {
    case "priceLow":
      return copy.sort((a, b) => a.priceValueVnd - b.priceValueVnd);
    case "priceHigh":
      return copy.sort((a, b) => b.priceValueVnd - a.priceValueVnd);
    case "areaLarge":
      return copy.sort((a, b) => b.areaValueM2 - a.areaValueM2);
    case "newest":
    default:
      return copy;
  }
}

export default function PropertyScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지, 비로그인 공개 화면)
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  // [STEP: 2026-09-08] home.tsx의 검색창에서 검색어를 입력하고 넘어오면(search
  // 쿼리 param) 이 화면의 검색 state 초기값으로 사용한다 — category param과 동일한
  // 패턴.
  const params = useLocalSearchParams<{ category?: string; search?: string }>();
  const initialCategory =
    params.category && (PROPERTY_CATEGORIES as string[]).includes(params.category)
      ? (params.category as PropertyImageCategory)
      : null;

  const [region, setRegion] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<PropertyImageCategory | null>(initialCategory);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState(params.search ?? "");
  const [sort, setSort] = useState<SortOption>("newest");
  const [toast, setToast] = useState<string | null>(null);
  // [STEP: 2026-09-09] 매매/임대, 정렬 셀렉트 모달 표시 상태 — invest.tsx의
  // riskModalVisible과 동일한 패턴.
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [sortModalVisible, setSortModalVisible] = useState(false);

  // [STEP 04] Mock(MOCK_PROPERTIES) → 실제 Supabase properties 연동. 아래 filtered의
  // 필터/정렬 로직 자체는 바뀌지 않는다 — 데이터 소스만 이 state로 교체했다.
  const [properties, setProperties] = useState<MockProperty[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * [2026-09-12 감사] 추천 캐러셀은 홈과 같은 광고 자리다. 여기서도 같은 기준
   * (잔액이 남은 상위 5개)으로 뽑고, 누르면 같은 방식으로 과금해야 한다 —
   * 화면마다 다르면 광고주는 "어디서 눌렀느냐"에 따라 돈이 나가거나 안 나간다.
   */
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);
  /**
   * [2026-09-12 사용자 결정] 부동산 탭에도 TOP10 자리를 노출한다.
   *
   * 예전에는 TOP10이 홈 전용이었다 — 그래서 TOP10 광고를 산 매물이 부동산 탭
   * 어디에도 보이지 않았다. 돈을 낸 자리는 매물을 찾는 화면에 있어야 한다.
   */
  const [top10Ids, setTop10Ids] = useState<string[]>([]);

  /**
   * [2026-09-12 사용자 지시] 일반 매물 목록의 정렬·조건 — 홈에서 옮겨 왔다.
   *
   * 홈의 TOP10이 유료 광고 10칸 고정이 되면서 그쪽에서는 칩이 의미를 잃었고,
   * 고르는 행위가 실제로 필요한 곳은 광고가 아닌 이 목록이다.
   */
  const [sortState, setSortState] = useState<PropertySortState>(DEFAULT_PROPERTY_SORT);

  /**
   * 일반 매물은 5개만 먼저 보여 주고, 바닥에 닿으면 5개씩 더 붙인다(사용자 지시).
   *
   * 목록 전체를 한 번에 그리면 매물이 늘어날수록 탭을 열 때마다 수백 개의 행을 만든다.
   * 화면 아래로 내려가는 사람만 그만큼 더 그리게 한다. 필터·정렬을 바꾸면 "다른 목록"이
   * 되므로 다시 5개로 돌아간다 — 그러지 않으면 조건을 좁혔는데도 스크롤이 그대로 남아
   * 엉뚱한 위치에서 시작한다.
   */
  const [visibleCount, setVisibleCount] = useState(LISTINGS_PAGE_SIZE);

  /**
   * [2026-09-11 사용자 지시] 매물 행 우측 하단에 현위치로부터의 거리를 표시한다.
   *
   * 권한을 여기서 새로 요청하지는 않는다(requestPermission: false) — 목록 탭에
   * 들어오자마자 권한 창이 뜨면 무슨 기능인지 모른 채 거부하기 쉽다. 홈에서
   * 위치를 허용했다면 그 권한을 그대로 쓰고, 없으면 거리를 숨긴다.
   */
  const [userLocation, setUserLocation] = useState<UserLocation>({
    origin: "none",
    label: "",
    coords: null,
  });

  useEffect(() => {
    let active = true;
    getCurrentLocation({ requestPermission: false }).then((result) => {
      if (active) setUserLocation(result);
    });
    return () => {
      active = false;
    };
  }, []);

  /** 매물까지의 거리 문구 — 기준점과 좌표가 다 있을 때만(없으면 빈 문자열). */
  function distanceLabel(property: MockProperty): string {
    if (!userLocation.coords || property.latitude === undefined || property.longitude === undefined) {
      return "";
    }
    return formatDistance(
      distanceKm(userLocation.coords, {
        latitude: property.latitude,
        longitude: property.longitude,
      }),
    );
  }

  // [2026-09-11 사용자 지시] 화면에 들어올 때마다 다시 조회한다.
  // 이전에는 useEffect(..., [])로 **마운트 시 1회만** 불러왔다. Expo Router는 탭
  // 화면을 언마운트하지 않고 그대로 두므로, 매물을 등록하고 목록 탭으로 돌아와도
  // 새로 등록한 매물이 보이지 않았다(앱을 껐다 켜야 반영됐다).
  // useFocusEffect는 포커스를 받을 때마다 실행되므로 이 문제가 사라진다.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      listProperties().then((result) => {
        if (active) {
          setProperties(result);
          setLoading(false);
        }
      });
      listActiveAdSlots("featured").then((ids) => {
        if (active) setFeaturedIds(ids);
      });
      listActiveAdSlots("top10").then((ids) => {
        if (active) setTop10Ids(ids);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  /**
   * 거리순을 골랐는데 기준 위치가 없을 때 — 권한을 한 번 물어본다.
   *
   * 목록 탭에 들어오자마자 묻지 않는 것과 같은 이유로(무슨 기능인지 모른 채 거부하기
   * 쉽다) 여기서만 묻는다: 사용자가 "거리순"을 직접 누른 순간이라 무엇에 쓰는지가 분명하다.
   * 거부하면 안내만 남기고 목록은 원래 순서로 둔다.
   */
  async function showLocationHint() {
    const result = await getCurrentLocation({ requestPermission: true });
    setUserLocation(result);
    if (!result.coords) {
      setToast(t("property.locationNeeded"));
      setTimeout(() => setToast(null), 2400);
    }
  }

  /**
   * [2026-09-14] 돋보기 버튼과 키보드의 검색 키.
   *
   * 예전에는 둘 다 `() => {}` 빈 함수였다. 이 화면의 목록은 입력할 때마다 이미
   * 걸러지므로(아래 normalizedSearch → filtered) "검색을 실행"할 것이 남아 있지
   * 않은데, 그렇다고 아무 반응이 없으면 사용자는 버튼이 고장 난 줄 안다.
   *
   * 실제로 필요한 동작은 **키보드를 내리는 것**이다. 입력 중에는 키보드가 화면
   * 절반을 덮고 있어 걸러진 결과가 보이지 않는다.
   */
  function submitSearch() {
    Keyboard.dismiss();
  }

  const normalizedSearch = search.trim().toLowerCase();
  const isSearching = normalizedSearch.length > 0;

  const filtered = useMemo(() => {
    const base = properties.filter((property) => {
      const matchesRegion = !region || property.province === region || property.location.includes(region);
      const matchesStatus = status === "all" || property.status === status;
      const matchesCategory = !category || property.category === category;
      const matchesSearch =
        !isSearching ||
        property.title.toLowerCase().includes(normalizedSearch) ||
        property.location.toLowerCase().includes(normalizedSearch);
      return matchesRegion && matchesStatus && matchesCategory && matchesSearch;
    });
    return sortProperties(base, sort);
  }, [properties, region, status, category, normalizedSearch, isSearching, sort]);

  // 광고 자리를 산 매물만, DB가 준 순위 그대로. 광고가 하나도 없을 때만 예전처럼
  // featured 플래그(관리자 수동 큐레이션)를 쓴다.
  const featured = useMemo(() => {
    if (isSearching) return [];
    if (featuredIds.length === 0) return filtered.filter((property) => property.featured);
    return featuredIds
      .map((id) => filtered.find((property) => property.id === id))
      .filter((property): property is MockProperty => !!property);
  }, [isSearching, featuredIds, filtered]);

  const featuredSet = useMemo(() => new Set(featured.map((property) => property.id)), [featured]);

  /**
   * [2026-09-12 사용자 결정] TOP10 = **유료 광고 자리 10칸**. 순위는 DB가 정한 그대로다.
   *
   * 두 가지를 고쳤다.
   *
   * 하나, 목록을 filtered가 아니라 properties에서 뽑는다. 지역·카테고리 칩을 고르면
   * filtered에서 빠지는 광고가 생기는데, 그러면 광고주가 산 자리가 사용자의 필터에 따라
   * 사라진다 — 돈을 낸 자리는 이 화면에 있어야 한다.
   *
   * 둘, 추천 캐러셀에 이미 있는 매물을 빼지 않는다. 추천과 TOP10은 **따로 사는 자리**라
   * 한 매물이 둘 다 살 수 있고, 그때 한쪽에서 지우면 산 것이 노출되지 않는다.
   * (2026-09-12 실기기 테스트에서 TOP10 광고 매물이 어디에도 안 보인 원인이 이것이었다.)
   *
   * 검색 중에는 광고를 얹지 않는다 — 검색은 찾는 행위라 광고가 끼어들면 결과를 못 믿게 된다.
   */
  const top10 = useMemo(() => {
    if (isSearching) return [];
    const byId = new Map(properties.map((property) => [property.id, property]));
    return top10Ids
      .map((id) => byId.get(id))
      .filter((property): property is MockProperty => !!property)
      .slice(0, TOP10_LIMIT);
  }, [properties, top10Ids, isSearching]);

  const adSet = useMemo(
    () => new Set([...featuredSet, ...top10.map((property) => property.id)]),
    [featuredSet, top10],
  );

  /**
   * 일반 매물 — 광고 자리를 뺀 나머지에 정렬·조건을 적용한다.
   *
   * 정렬은 필터(filtered)가 끝난 뒤에 건다. 순서가 반대면 "조건별"로 걸러 낸 결과에
   * 다시 지역 칩이 적용되어, 사용자가 고른 두 조건 중 하나가 먼저 무시된다.
   */
  const listings = useMemo(() => {
    const base = isSearching ? filtered : filtered.filter((property) => !adSet.has(property.id));
    if (isSearching) return base;
    return applyPropertySort(base, sortState, userLocation.coords);
  }, [filtered, isSearching, sortState, userLocation.coords, adSet]);

  /** 지금 화면에 그릴 일반 매물. 바닥에 닿을 때마다 5개씩 늘어난다. */
  const visibleListings = isSearching ? listings : listings.slice(0, visibleCount);

  // 목록의 성격이 바뀌면(필터·정렬·검색) 다시 5개부터 — 아래 참고.
  useEffect(() => {
    setVisibleCount(LISTINGS_PAGE_SIZE);
  }, [region, status, category, sort, normalizedSearch, sortState]);

  /**
   * 바닥 근처에 닿으면 5개 더. `onEndReached`가 없는 ScrollView라 직접 잰다.
   *
   * 여유(360px)를 두는 이유: 정확히 바닥에 닿은 뒤에 붙이면 사용자가 잠깐 빈 끝을 보고
   * 나서야 다음 항목이 나타난다. 스크롤이 끝에 가까워질 때 미리 붙이면 이어서 읽힌다.
   */
  function handleScroll(event: {
    nativeEvent: {
      layoutMeasurement: { height: number };
      contentOffset: { y: number };
      contentSize: { height: number };
    };
  }) {
    if (isSearching) return;
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceToEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (distanceToEnd > 360) return;
    setVisibleCount((current) =>
      current >= listings.length ? current : current + LISTINGS_PAGE_SIZE,
    );
  }

  function goToDetail(property: MockProperty) {
    router.push(`/property-detail/${property.id}`);
  }

  /**
   * 추천 캐러셀에서 누른 경우 — 광고 클릭이므로 과금한다. 결과를 기다리지 않는다:
   * 과금은 광고주와 플랫폼 사이의 일이고, 그 때문에 고객의 화면 전환이 늦어지면 안 된다.
   */
  /** TOP10 자리에서 누른 경우 — 추천과 같은 이유로 과금한다. */
  function goToTop10Detail(property: MockProperty) {
    if (top10Ids.includes(property.id)) {
      void chargeAdClick(property.id, "top10");
    }
    goToDetail(property);
  }

  function goToFeaturedDetail(property: MockProperty) {
    if (featuredIds.includes(property.id)) {
      void chargeAdClick(property.id, "featured");
    }
    goToDetail(property);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      {/* [STEP: 2026-09-08] 홈 화면 "부동산 매물" 카테고리 아이콘(예: 아파트)을 눌러
          들어온 경우, 타이틀을 그 카테고리명으로 바꾸고 원래 어느 서브메뉴에서
          왔는지를 작은 글자 서브타이틀로 함께 보여준다 — 카테고리 선택이 없으면
          (직접 탭에서 진입) 기존과 동일하게 "부동산" 타이틀만 보여준다. */}
      {/* [STEP: 2026-09-09-17] 사용자 요청(목표 디자인) — 이 화면만 타이틀 아래
          테두리 삭제. */}
      <Header
        title={category ? t(`categories.property.${category}`) : t("property.title")}
        subtitle={category ? t("home.categoryTabs.property") : undefined}
        bordered={false}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={200}
      >
        {/* [STEP: 2026-09-09-6] 사용자 요청 — 검색창 우측에 검색 버튼 추가,
            내부 placeholder(미리보기) 텍스트는 삭제(아이콘으로 대체). */}
        <View style={[styles.searchBar, { borderColor: theme.border, backgroundColor: theme.background }]}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
            autoCorrect={false}
            // [STEP: 2026-09-09-15] 사용자 제보(목표 디자인 이미지) — placeholder
            // 텍스트가 실제로는 있어야 하는데(입력 전 빈 검색창에서도 무엇을 검색하는
            // 곳인지 안내) 빠져 있었다. 값을 입력하면 기존처럼 placeholder는 자동으로
            // 사라진다(TextInput 기본 동작) — 그 외 로직/스타일은 변경 없음.
            placeholder={t("property.searchPlaceholder")}
            // [STEP: 2026-09-09-17] 사용자 요청 — placeholder 글자를 theme.secondaryText
            // (#6B6B6B, 본문 회색)보다 더 흐리게.
            placeholderTextColor="#B0B0B0"
            style={[textStyles.body, styles.searchInput, { color: theme.text }]}
          />
          <Pressable
            onPress={submitSearch}
            accessibilityRole="button"
            accessibilityLabel={t("property.searchPlaceholder")}
            hitSlop={8}
            // [STEP: 2026-09-09-15] 사용자 제보(목표 디자인 이미지) — 채워진 파란
            // 원형 버튼이 아니라 배경 없이 아이콘만 회색으로 노출되어야 한다.
            style={({ pressed }) => [styles.searchButton, { opacity: pressed ? opacity.pressed : 1 }]}
          >
            <Ionicons name="search" size={16} color={theme.secondaryText} />
          </Pressable>
        </View>

        {/* [STEP: 2026-09-09] 사용자 요청 — "전체지역" 메뉴바를 화면 가로 100% 폭 +
            상하 테두리가 있는 바 형태로 바꾸고, 개별 칩 버튼의 테두리는 없앤다
            (Chip bordered={false}) — 카테고리 칩(chipRow) 등 다른 칩 스타일에는
            영향 없음. 활성(선택) 상태는 사각형 배경(#444444)으로 채운다(squared +
            activeColor). 바로 아래 카테고리 메뉴와의 상하 간격도 좀 더 좁혔다
            (regionBar의 음수 marginBottom, content의 기본 gap을 상쇄). */}
        <View style={[styles.regionBar, { borderColor: theme.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionChipRow}>
            {/* [STEP: 2026-09-09-6] 사용자 요청 — 지역탭은 배경색 없이(투명),
                비활성은 회색 글자, 활성(선택)은 검은색 글자로만 구분한다. */}
            <Chip
              label={t("property.allRegions")}
              active={region === null}
              onPress={() => setRegion(null)}
              theme={theme}
              bordered={false}
              squared
              activeColor="transparent"
              activeTextColor="#111111"
              inactiveTextColor={theme.secondaryText}
              // [STEP: 2026-09-09-19] 사용자 요청 — 지역 메뉴 좌우 간격을 좀 더 좁게
              // (칩 기본 내부 padding spacing.md=16 대신 spacing.xs=4).
              // [2026-09-11 사용자 지시] 여백 상하 6 / 좌우 10, 선택 시 파란 테두리 +
              // 아래 카테고리 칩(아파트/주택…)과 같은 라운딩(radius.full).
              paddingHorizontal={REGION_CHIP_PADDING_X}
              paddingVertical={REGION_CHIP_PADDING_Y}
              activeBorderColor={theme.accent}
              borderRadius={radius.full}
            />
            {MOCK_REGIONS.map((item) => (
              <Chip
                key={item}
                label={item}
                active={region === item}
                onPress={() => setRegion(item)}
                theme={theme}
                bordered={false}
                squared
                activeColor="transparent"
                activeTextColor="#111111"
                inactiveTextColor={theme.secondaryText}
                paddingHorizontal={REGION_CHIP_PADDING_X}
                paddingVertical={REGION_CHIP_PADDING_Y}
                activeBorderColor={theme.accent}
                borderRadius={radius.full}
              />
            ))}
          </ScrollView>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip
            label={t("property.filterAll")}
            active={category === null}
            onPress={() => setCategory(null)}
            theme={theme}
            tone="accent"
          />
          {PROPERTY_CATEGORIES.map((item) => (
            <Chip
              key={item}
              label={t(`categories.property.${item}`)}
              active={category === item}
              onPress={() => setCategory(item)}
              theme={theme}
              tone="accent"
            />
          ))}
        </ScrollView>

        {/* [STEP: 2026-09-09] 사용자 요청 — 전체/매매/임대, 정렬(최신순 등) 칩 목록을
            각각 셀렉트(버튼+Modal, invest.tsx의 위험도 셀렉트와 동일 패턴)로 바꾸고,
            상시 노출되던 "정렬" 라벨 텍스트는 없앤다(선택 시 열리는 Modal 제목으로만
            남는다). 매매/임대 셀렉트 + 정렬 셀렉트 + 보기방식(리스트/지도) 토글을
            한 줄에 배치한다. */}
        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setStatusModalVisible(true)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.selectButton,
              { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text style={[textStyles.bodySmall, { color: theme.text }]} numberOfLines={1}>
              {status === "all" ? t("property.filterAll") : t(`property.status.${status}`)}
            </Text>
            <Ionicons name="chevron-down" size={14} color={theme.secondaryText} />
          </Pressable>
          <Pressable
            onPress={() => setSortModalVisible(true)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.selectButton,
              { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text style={[textStyles.bodySmall, { color: theme.text }]} numberOfLines={1}>
              {t(`property.sort.${sort}`)}
            </Text>
            <Ionicons name="chevron-down" size={14} color={theme.secondaryText} />
          </Pressable>
          <View style={styles.filterSpacer} />
          <View style={[styles.viewToggle, { borderColor: theme.border }]}>
            <ViewToggleButton
              icon="list-outline"
              active={viewMode === "list"}
              onPress={() => setViewMode("list")}
              theme={theme}
            />
            <ViewToggleButton
              icon="map-outline"
              active={viewMode === "map"}
              onPress={() => setViewMode("map")}
              theme={theme}
            />
          </View>
        </View>

        <Modal
          visible={statusModalVisible}
          onClose={() => setStatusModalVisible(false)}
          accessibilityLabel={t("common.cancel")}
        >
          <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
            {t("property.statusLabel")}
          </Text>
          {STATUS_OPTIONS.map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                setStatus(option);
                setStatusModalVisible(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.selectOption,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text style={[textStyles.body, { color: theme.text }]}>
                {option === "all" ? t("property.filterAll") : t(`property.status.${option}`)}
              </Text>
              {option === status ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
            </Pressable>
          ))}
        </Modal>

        <Modal
          visible={sortModalVisible}
          onClose={() => setSortModalVisible(false)}
          accessibilityLabel={t("common.cancel")}
        >
          <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
            {t("property.sortLabel")}
          </Text>
          {SORT_OPTIONS.map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                setSort(option);
                setSortModalVisible(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.selectOption,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text style={[textStyles.body, { color: theme.text }]}>{t(`property.sort.${option}`)}</Text>
              {option === sort ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
            </Pressable>
          ))}
        </Modal>

        {viewMode === "map" ? (
          /* [STEP 04-지도] 자리표시 → 실제 Google 지도(react-native-maps). 웹에서는
             react-native-maps가 동작하지 않아 components/PropertyMap.web.tsx가
             자동으로 대체 렌더된다(안내 문구만 표시). 마커 대상은 현재 필터가
             적용된 목록(filtered) 그대로다 — 목록/지도 뷰가 같은 결과를 본다. */
          <PropertyMap
            properties={filtered}
            onSelectProperty={goToDetail}
            theme={theme}
            emptyLabel={t("property.mapNoCoords")}
            missingCoordsLabel={(count: number) => t("property.mapMissingCoords", { count })}
          />
        ) : loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={theme.accent} />
          </View>
        ) : (
          <>
            {featured.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t("property.featuredTitle")} icon="business-outline" />
                <HorizontalCardCarousel
                  style={styles.bleedScroll}
                  contentContainerStyle={styles.featuredRow}
                  step={layout.featuredCardWidth + spacing.md}
                  arrowCenterY={PROPERTY_CARD_IMAGE_HEIGHT / 2}
                  autoPlayMs={3000}
                >
                  {featured.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      variant="featured"
                      onPress={() => goToFeaturedDetail(property)}
                    />
                  ))}
                </HorizontalCardCarousel>
              </View>
            ) : null}

            {top10.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t("property.top10Title")} />
                <View style={styles.propertyList}>
                  {top10.map((property, index) => (
                    <PropertyListRow
                      key={property.id}
                      property={property}
                      distance={distanceLabel(property)}
                      showDivider={index > 0}
                      onPress={() => goToTop10Detail(property)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={[styles.section, styles.lastSection]}>
              {/* [2026-09-12 사용자 지시] 타이틀 우측에 정렬 칩(거리순/조건별/금액별).
                  홈에서 옮겨 온 것이다 — 홈 TOP10은 유료 광고 고정이라 정렬이 무의미해졌고,
                  고르는 행위가 실제로 필요한 곳은 광고가 아닌 이 목록이다. */}
              <View style={styles.listingsHeader}>
                <View style={styles.listingsHeaderTitle}>
                  <SectionHeader title={t("property.listingsTitle")} />
                </View>
                {isSearching ? null : (
                  <PropertySortControls
                    value={sortState}
                    onChange={setSortState}
                    theme={theme}
                    hasLocation={!!userLocation.coords}
                    onNeedLocation={showLocationHint}
                  />
                )}
              </View>

              {listings.length === 0 && featured.length === 0 && top10.length === 0 ? (
                <EmptyState
                  title={t("property.emptyTitle")}
                  description={t("property.emptyDescription")}
                />
              ) : (
                <View style={styles.propertyList}>
                  {/* [2026-09-11 사용자 지시] 일반 매물은 홈과 같은 가로형 행 디자인을 쓴다.
                      (추천 매물 캐러셀은 기존 PropertyCard 그대로.) */}
                  {visibleListings.map((property, index) => (
                    <PropertyListRow
                      key={property.id}
                      property={property}
                      distance={distanceLabel(property)}
                      showDivider={index > 0}
                      onPress={() => goToDetail(property)}
                    />
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function ViewToggleButton({
  icon,
  active,
  onPress,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
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
        styles.viewToggleButton,
        // [STEP: 2026-09-09-15] 사용자 제보(목표 디자인 이미지) — 선택된 보기방식
        // 버튼 배경이 accent(네이비)가 아니라 중립 회색이어야 한다.
        { backgroundColor: active ? "#CCCCCC" : "transparent", opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      <Ionicons name={icon} size={16} color={active ? theme.onAccent : theme.secondaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    // 사용자 요청: 화면 좌우 여백을 10px로 변경(세로 여백/gap은 기존 유지)
    paddingHorizontal: spacing.screenPaddingX,
    // [STEP: 2026-09-09-17] 사용자 요청(목표 디자인) — 검색창을 헤더에 20px 더
    // 가깝게(위로 20px). paddingVertical(상하 동일)이던 것을 분리해 위쪽만 줄이고
    // 아래쪽(lastSection과 맞물리는 스크롤 하단 여백)은 그대로 lg 유지.
    paddingTop: spacing.lg - 20,
    paddingBottom: spacing.lg,
    // [STEP: 2026-09-09-7] 사용자 재확인 — sm(8)까지 줄이니 영역 내부(styles.section.gap
    // =sm) 간격과 완전히 같아져 "영역과 영역 사이"가 구분되지 않았다. md(16)로
    // 다시 올려 section 내부 간격의 2배를 유지한다(원래 lg=24보다는 여전히
    // 타이트함) — 이 gap 하나가 content의 모든 최상위 섹션 사이 간격을 공유한다.
    gap: spacing.md,
  },
  // [STEP: 2026-09-09-6] 사용자 요청 — 검색창에 우측 검색 버튼, placeholder 삭제.
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  searchInput: {
    flex: 1,
    padding: 0,
  },
  searchButton: {
    width: 32,
    height: 32,
    // [STEP: 2026-09-09-15] 사용자 제보(목표 디자인 이미지) — 채워진 원형 버튼이
    // 아니라 배경 없이 아이콘만 노출되는 형태였다(이전 STEP 2026-09-09-13의
    // radius.full 시도는 방향이 틀렸다 — 애초에 배경 자체가 없어야 했다).
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  // [STEP: 2026-09-09] 사용자 요청 — "전체지역" 메뉴바: 화면 가로 100%(bleedScroll과
  // 동일한 negative margin 방식) + 상하 테두리만 남긴다. content의 기본 세로 gap
  // (spacing.md=16px)이 바로 아래 카테고리 메뉴와의 간격에도 그대로 적용되는데,
  // 사용자 요청으로 이 간격만 spacing.xs(4px) 수준으로 좁힌다 — 음수 marginBottom으로
  // 기본 gap을 상쇄한다(다른 섹션 간 간격에는 영향 없음).
  regionBar: {
    marginHorizontal: -spacing.screenPaddingX,
    // [STEP: 2026-09-09-18] 사용자 재요청 — 검색창 바로 아래 여백을 정확히 20px로
    // (content.gap 16 + 이 영역 자체 paddingVertical 4 = 20). 이전 STEP의
    // marginTop:-20("위로 20px")은 결과적으로 여백이 거의 0이 되어버려 되돌린다.
    //
    // [2026-09-11 사용자 지시] 검색창과 지역 메뉴 사이만 padding-top: 0.
    // 아래쪽(카테고리 칩과의 간격)은 그대로 둬야 하므로 paddingVertical을
    // 위/아래로 나눈다.
    paddingTop: 0,
    paddingBottom: spacing.xs,
    marginBottom: -(spacing.md - spacing.xs),
  },
  regionChipRow: {
    // [STEP: 2026-09-09-21] 사용자 요청 — 정확히 20px로 고정.
    gap: 20,
    paddingHorizontal: spacing.screenPaddingX,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // [STEP: 2026-09-09] 매매/임대·정렬 셀렉트 버튼 — invest.tsx의 riskSelect와 동일 패턴
  selectButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  selectOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // 매매/임대·정렬 셀렉트와 보기방식 토글 사이 여백을 채워 토글을 오른쪽 끝으로 밀어준다
  filterSpacer: {
    flex: 1,
  },
  viewToggle: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  viewToggleButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  mapPlaceholder: {
    height: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  loadingBox: {
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    gap: spacing.sm,
    // [STEP: 2026-09-09-21] 사용자 요청 — 정확히 30px로(content.gap 16 + 이 값 14).
    marginTop: 14,
  },
  lastSection: {
    paddingBottom: spacing.lg,
  },
  // STEP 4-12-1 — 가로 스크롤 캐러셀(추천 매물) 전용: 부모(content)의 좌우
  // padding을 상쇄해 화면 끝까지 카드가 이어지도록 한다. 지역/상태 필터(chipRow)
  // 에는 적용하지 않는다 — 필터는 기존 여백을 그대로 유지한다. content의 좌우
  // padding이 spacing.screenPaddingX(10px)로 바뀌었으므로 이 값도 함께 맞춘다.
  bleedScroll: {
    marginHorizontal: -spacing.screenPaddingX,
  },
  // paddingHorizontal(좌우 peek 여백)은 HorizontalCardCarousel이 직접 적용한다.
  // [2026-09-12] 일반 매물 제목과 정렬 칩을 한 줄에. 칩이 길어지면 제목이 먼저 줄어든다.
  listingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  listingsHeaderTitle: {
    flexShrink: 1,
  },
  featuredRow: {
    gap: spacing.md,
  },
  // [2026-09-11 사용자 지시] 매물 목록은 행 사이 간격을 좁힌다 — 간격은
  // PropertyListRow의 paddingVertical이 만들고, 그 가운데에 구분선이 놓인다.
  propertyList: {
    gap: 0,
  },
});
