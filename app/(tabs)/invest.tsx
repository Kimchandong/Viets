import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { HorizontalCardCarousel } from "@/components/HorizontalCardCarousel";
import { InvestmentCard } from "@/components/InvestmentCard";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { SectionHeader } from "@/components/SectionHeader";
import { StatTile } from "@/components/StatTile";
import { colors, layout, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { MOCK_INVEST_OVERVIEW, type MockInvestmentProduct } from "@/constants/mockData";
import { listInvestmentProducts } from "@/services/investments";
import { markRead } from "@/services/notifications";
import { splitYieldText } from "@/utils/format";
import type { InvestImageCategory } from "@/constants/mockImages";

// [STEP: 카테고리 재구성] 투자 서브카테고리 칩 목록.
const INVEST_CATEGORIES: InvestImageCategory[] = [
  "land",
  "building",
  "commercial",
  "residential",
  "industrial",
  "warehouse",
  "other",
];

// STEP 4-9B — Invest UI 레이아웃 기반. MOCK_INVEST_OVERVIEW/MOCK_INVESTMENT_PRODUCTS는
// constants/mockData.ts의 자리표시 값이다. 실제 투자상품 조회/주문(create-investment-order,
// investment_orders 등)은 Phase 5 범위 — 이 STEP에서는 구현하지 않는다.
//
// [FULL-DEV] 카드 press를 app/invest-detail/[id].tsx로 실제 이동하도록 연결했다
// (기존에는 showComingSoon 토스트만 떴다). 그 외 필터/레이아웃은 바꾸지 않았다.

type RiskFilter = "all" | "low" | "medium" | "high";

const RISK_OPTIONS: RiskFilter[] = ["all", "low", "medium", "high"];

export default function InvestScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지, 비로그인 공개 화면)
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  // [STEP: 홈 카테고리 2탭 전환] 홈 화면 "부동산 투자" 탭 아이콘 탭 시 이 화면으로
  // category 쿼리 param을 전달한다(app/(tabs)/home.tsx 참고) — property.tsx와
  // 동일한 패턴으로 초기 선택값에만 사용한다.
  const params = useLocalSearchParams<{ category?: string }>();
  const initialCategory =
    params.category && (INVEST_CATEGORIES as string[]).includes(params.category)
      ? (params.category as InvestImageCategory)
      : null;

  const [risk, setRisk] = useState<RiskFilter>("all");
  const [category, setCategory] = useState<InvestImageCategory | null>(initialCategory);
  // [STEP: 카테고리 재구성] 사용자 지시("낮은위험/중간위험/높은위험은 우측 선택(셀렉트)
  // 항목으로 위치변경")에 따라 위험도 필터를 가로 칩 목록 대신 우측 정렬된 select
  // 버튼 + Modal로 바꿨다 — my.tsx의 언어 선택 Modal(체크마크 목록)과 동일한 패턴.
  const [riskModalVisible, setRiskModalVisible] = useState(false);

  // [STEP 06] Mock(MOCK_INVESTMENT_PRODUCTS) → 실제 investment_products 테이블.
  // 필터 로직은 그대로 두고 데이터 소스만 교체했다.
  const [products, setProducts] = useState<MockInvestmentProduct[]>([]);
  const [loading, setLoading] = useState(true);

  // [2026-09-11 사용자 지시] 화면에 들어올 때마다 다시 조회한다.
  // 이전에는 useEffect(..., [])로 **마운트 시 1회만** 불러왔다. Expo Router는 탭
  // 화면을 언마운트하지 않고 그대로 두므로, 매물을 등록하고 목록 탭으로 돌아와도
  // 새로 등록한 매물이 보이지 않았다(앱을 껐다 켜야 반영됐다).
  // useFocusEffect는 포커스를 받을 때마다 실행되므로 이 문제가 사라진다.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      // [2026-09-11 사용자 지시] 투자 목록을 봤으므로 홈 상단의 투자 알림 숫자를 0으로
      // 되돌린다 — 다음에 등록되는 상품부터 다시 센다.
      markRead("investment_list");
      listInvestmentProducts().then((result) => {
        if (active) {
          setProducts(result);
          setLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const filtered = useMemo(
    () =>
      products.filter(
        (product) =>
          (risk === "all" || product.riskLevel === risk) && (!category || product.category === category),
      ),
    [products, risk, category],
  );
  const featured = filtered.filter((product) => product.featured);
  const others = filtered.filter((product) => !product.featured);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      {/* [STEP: 2026-09-08] 홈 화면 "부동산 투자" 카테고리 아이콘(예: 토지/부지)을
          눌러 들어온 경우, 타이틀을 그 카테고리명으로 바꾸고 원래 어느 서브메뉴에서
          왔는지를 작은 글자 서브타이틀로 함께 보여준다 — property.tsx와 동일한 패턴. */}
      <Header
        title={category ? t(`categories.invest.${category}`) : t("invest.title")}
        subtitle={category ? t("home.categoryTabs.invest") : undefined}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* [STEP: 2026-09-09] 사용자 요청 — 투자개요 숫자 34px→20px, 라벨 13px로
            축소하고, 카드 테두리를 rgb(127, 179, 240) / 2px로 강조한다. StatTile
            자체(textStyles.statValue/caption)는 My 화면과 공유하므로 여기서는
            valueStyle/labelStyle로 이 화면에서만 오버라이드한다.
            [STEP: 2026-09-09 추가] "투자개요" 라벨 자체도 13px로, 누적 모집액
            숫자는 글자색 #B6010C로, 단위(tỷ/năm)는 bold를 없앤다 —
            splitYieldText로 숫자/단위를 분리해 단위만 regular weight 중첩 Text로
            렌더링한다(단위는 부모 색상을 그대로 상속). */}
        {/* [STEP: 2026-09-09-6] 사용자 요청 — 투자개요 카드 테두리 삭제, 카드 자체는
            회색 배경, 스탯 3개는 각각 흰색 배경 라운딩 박스로 구분한다. */}
        <Card style={styles.overviewCard}>
          {/* [STEP: 2026-09-09-22] 사용자 요청(목표 디자인) — 투자개요 카드 배경을
              단색 회색(#F2F2F2) 대신, 사용자가 전달한 정확한 conic-gradient(13색,
              from 45deg, 카드 중심 기준)로. React Native는 conic-gradient를 지원하지
              않고(expo-linear-gradient도 선형만 가능) 새 네이티브 dependency를 추가할
              수 없어(디바이스 shell에 npm 레지스트리 접근 불가), 동일한 CSS 값으로
              픽셀 단위로 직접 렌더링한 PNG를 배경 이미지로 대신 쓴다. */}
          <Image
            source={require("@/assets/images/invest/overview-gradient.png")}
            style={styles.overviewGradientImage}
            resizeMode="cover"
          />
          {/* [STEP: 2026-09-09-22] 배경이 회색에서 컬러 그라데이션으로 바뀌어
              theme.secondaryText(회색)로는 대비가 부족해졌다 — 흰색으로. */}
          <Text style={[textStyles.caption, { color: "#FFFFFF", fontSize: typography.size.sm }]}>
            {t("invest.overviewTitle")}
          </Text>
          <View style={styles.overviewRow}>
            <StatTile
              label={t("invest.overview.totalRaised")}
              value={
                <>
                  {splitYieldText(MOCK_INVEST_OVERVIEW.totalRaised).rate}
                  {splitYieldText(MOCK_INVEST_OVERVIEW.totalRaised).suffix ? (
                    <Text style={styles.overviewUnit}>
                      {splitYieldText(MOCK_INVEST_OVERVIEW.totalRaised).suffix}
                    </Text>
                  ) : null}
                </>
              }
              valueStyle={[styles.overviewValue, styles.overviewValueDanger]}
              labelStyle={styles.overviewLabel}
              style={styles.overviewStatBox}
            />
            <StatTile
              label={t("invest.overview.activeProducts")}
              value={MOCK_INVEST_OVERVIEW.activeProducts}
              valueStyle={styles.overviewValue}
              labelStyle={styles.overviewLabel}
              style={styles.overviewStatBox}
            />
            <StatTile
              label={t("invest.overview.avgReturn")}
              value={
                <>
                  {splitYieldText(MOCK_INVEST_OVERVIEW.avgReturn).rate}
                  {splitYieldText(MOCK_INVEST_OVERVIEW.avgReturn).suffix ? (
                    <Text style={styles.overviewUnit}>
                      {splitYieldText(MOCK_INVEST_OVERVIEW.avgReturn).suffix}
                    </Text>
                  ) : null}
                </>
              }
              valueStyle={styles.overviewValue}
              labelStyle={styles.overviewLabel}
              style={styles.overviewStatBox}
            />
          </View>
        </Card>

        {/* [STEP: 2026-09-09] 사용자 요청 — 위험도 셀렉트의 테두리/배경을 없애고
            우측 정렬한다. 카테고리 칩 ScrollView에 flex:1을 줘서 왼쪽 메뉴 영역을
            더 넓게 차지하게 하고(칩이 몇 개든 남는 공간을 모두 갖는다), 위험도
            셀렉트는 그 오른쪽 끝에 붙는다. */}
        {/* [STEP: 2026-09-09-6] 사용자 요청 — 서브카테고리와 위험도를 2줄로 분리한다.
            1줄: 서브카테고리 칩(가로 100% 활용). 2줄: 위험도 셀렉트(우측 정렬). */}
        <View style={styles.filterSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Chip
              label={t("property.filterAll")}
              active={category === null}
              onPress={() => setCategory(null)}
              theme={theme}
              tone="accent"
            />
            {INVEST_CATEGORIES.map((item) => (
              <Chip
                key={item}
                label={t(`categories.invest.${item}`)}
                active={category === item}
                onPress={() => setCategory(item)}
                theme={theme}
                tone="accent"
              />
            ))}
          </ScrollView>
          <View style={styles.riskRow}>
            <Pressable
              onPress={() => setRiskModalVisible(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.riskSelect, { opacity: pressed ? opacity.pressed : 1 }]}
            >
              <Text style={[textStyles.bodySmall, { color: theme.text }]} numberOfLines={1}>
                {risk === "all" ? t("invest.riskSelectAll") : t(`invest.risk.${risk}`)}
              </Text>
              <Ionicons name="chevron-down" size={14} color={theme.secondaryText} />
            </Pressable>
          </View>
        </View>

        <Modal
          visible={riskModalVisible}
          onClose={() => setRiskModalVisible(false)}
          accessibilityLabel={t("common.cancel")}
        >
          <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
            {t("invest.riskLabel")}
          </Text>
          {RISK_OPTIONS.map((option) => (
            <Pressable
              key={option}
              onPress={() => {
                setRisk(option);
                setRiskModalVisible(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.riskOption,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text style={[textStyles.body, { color: theme.text }]}>
                {option === "all" ? t("invest.riskSelectAll") : t(`invest.risk.${option}`)}
              </Text>
              {option === risk ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
            </Pressable>
          ))}
        </Modal>

        {featured.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title={t("invest.featuredTitle")} />
            {/* [STEP: 2026-09-09-6] 사용자 요청 — 캐러셀 첫 카드 가운데 정렬 + 좌우
                화살표 네비게이션(HorizontalCardCarousel, home/property와 동일 패턴). */}
            <HorizontalCardCarousel
              style={styles.bleedScroll}
              contentContainerStyle={styles.featuredRow}
              step={layout.featuredCardWidth + spacing.md}
            >
              {featured.map((product) => (
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

        <View style={styles.section}>
          <SectionHeader title={t("invest.allProductsTitle")} />
          {loading ? (
            <Loading />
          ) : filtered.length === 0 ? (
            <EmptyState title={t("invest.emptyTitle")} description={t("invest.emptyDescription")} />
          ) : (
            <View style={styles.stack}>
              {others.map((product) => (
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

        <Card style={[styles.section, styles.infoCard, styles.lastSection]}>
          <SectionHeader title={t("invest.infoTitle")} />
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
            {t("invest.infoBody")}
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    // 사용자 요청: 화면 좌우 여백을 10px로 변경(세로 여백/gap은 기존 유지)
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    // [STEP: 2026-09-09-7] 사용자 재확인 — sm(8)까지 줄이니 영역 내부(styles.section.gap
    // =sm) 간격과 완전히 같아져 "영역과 영역 사이"가 구분되지 않았다. md(16)로
    // 다시 올려 section 내부 간격의 2배를 유지한다.
    gap: spacing.md,
  },
  // [STEP: 2026-09-09-6] 사용자 요청 — 투자개요 카드 테두리 삭제.
  // [STEP: 2026-09-09-22] 단색 배경 대신 overviewGradientImage(아래)가 카드 배경을
  // 채운다 — 그 이미지가 카드 라운딩 밖으로 삐져나오지 않도록 overflow:hidden,
  // absolute 이미지의 기준점이 되도록 position:relative가 필요하다.
  overviewCard: {
    gap: spacing.sm,
    borderWidth: 0,
    position: "relative",
    overflow: "hidden",
  },
  // [STEP: 2026-09-09-22] react-native-web에서는 position:absolute 자식이 명시적
  // width/height:100%가 없으면 부모를 꽉 채우지 못하고 원본 크기로 줄어들 수
  // 있다(이번 세션에서 여러 번 확인된 패턴 — 홈 배너 영상과 동일한 이유).
  overviewGradientImage:
    Platform.OS === "web"
      ? { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }
      : StyleSheet.absoluteFillObject,
  // [STEP: 2026-09-09-6] 사용자 요청 — 스탯 3개를 각각 흰색 배경 라운딩 영역으로 구분.
  overviewStatBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  // [STEP: 2026-09-09] 사용자 요청 — 투자개요 숫자 34px→20px, 라벨 13px
  overviewValue: {
    fontSize: typography.size.xl,
  },
  // [STEP: 2026-09-09] 사용자 요청 — 누적 모집액 글자색 #B6010C(단위 tỷ도 이 색을
  // 그대로 상속한다 — 아래 overviewUnit은 fontWeight만 override)
  overviewValueDanger: {
    color: "#B6010C",
  },
  // [STEP: 2026-09-09] 사용자 요청 — tỷ/năm 등 단위 접미사는 bold를 없앤다
  overviewUnit: {
    fontWeight: typography.weight.regular,
  },
  // [STEP: 2026-09-09-6] 사용자 요청 — 누적모집/진행중/평균수 라벨 글자크기 11px
  overviewLabel: {
    fontSize: 11,
  },
  overviewRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  chipRow: {
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  // [STEP: 2026-09-09-6] 사용자 요청 — 서브카테고리(1줄)와 위험도(2줄)를 분리한다.
  filterSection: {
    gap: spacing.sm,
  },
  // [STEP: 2026-09-09-6] 사용자 요청 — 위험도 셀렉트를 우측 정렬.
  riskRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  // [STEP: 2026-09-09] 사용자 요청 — 위험도 셀렉트 테두리/배경 삭제(투명), 우측 정렬
  riskSelect: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  riskOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  section: {
    gap: spacing.sm,
  },
  lastSection: {
    marginBottom: spacing.lg,
  },
  // STEP 4-12-1 — 가로 스크롤 캐러셀(추천 투자상품) 전용: 부모(content)의 좌우
  // padding을 상쇄해 화면 끝까지 카드가 이어지도록 한다. 위험도 필터(chipRow)
  // 에는 적용하지 않는다 — 필터는 기존 여백을 그대로 유지한다. content의 좌우
  // padding이 spacing.screenPaddingX(10px)로 바뀌었으므로 이 값도 함께 맞춘다.
  bleedScroll: {
    marginHorizontal: -spacing.screenPaddingX,
  },
  featuredRow: {
    gap: spacing.md,
  },
  stack: {
    gap: spacing.md,
  },
  infoCard: {
    borderRadius: radius.md,
  },
});
