import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import {
  Animated,
  Dimensions,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { buildGradientSteps, formatVndAmount, localizedText, splitYieldText } from "@/utils/format";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { InvestmentCard } from "@/components/InvestmentCard";
import { LoginPromptModal } from "@/components/LoginPromptModal";
import { SectionHeader } from "@/components/SectionHeader";
import { usePulsingColor } from "@/hooks/usePulsingColor";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography, ThemeColors } from "@/constants/theme";
import {
  findMockInvestmentProduct,
  findSimilarInvestmentsByMinAmount,
  findSimilarInvestmentsByPeriod,
  findSimilarInvestmentsByTarget,
} from "@/constants/mockData";
import { getSession, onAuthStateChange } from "@/services/auth";
import { useFavoritesStore } from "@/store/useFavoritesStore";

// [FULL-DEV] Invest 상세 화면 — app/(tabs)/invest.tsx(리스트/카드)와 app/(tabs)/home.tsx
// (추천 투자상품)의 카드 press가 여기로 연결된다. app/property-detail/[id].tsx와 동일한
// 이유(기존 파일 삭제/이동 금지)로 root Stack의 새 sibling 라우트로 추가했다.
//
// "투자 신청"은 사용자 지시 §6("실제 금융거래는 구현하지 않는다")에 따라 실제 주문/결제를
// 만들지 않는다 — Modal로 명확한 비고지(disclaimer)만 보여주는 UI-only 확인 흐름이다.

const { width: SCREEN_WIDTH } = Dimensions.get("window");
// [STEP: 2026-09-09-6] 모집률 그라데이션 색상 단계 — InvestmentCard.tsx와 동일한 팔레트.
const GRADIENT_STEPS = buildGradientSteps(colors.light.accentLight, colors.light.accent, 12);

export default function InvestDetailScreen() {
  const theme = colors.light;
  // [STEP: 2026-09-09-24] 사용자 요청 — "모집중" 배지 배경을 accent/accentLight
  // 사이에서 깜박이게(InvestmentCard.tsx와 동일 로직).
  const pulsingAccent = usePulsingColor(theme.accent, theme.accentLight);
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const product = useMemo(() => (id ? findMockInvestmentProduct(id) : undefined), [id]);

  // [STEP: 2026-09-09-8] 사용자 요청 — "연계 매물" 섹션 삭제, 대신 현재 투자상품과
  // 투자금/기간/목표액이 비슷한 다른 투자상품을 AI가 골라준 것처럼 3개 탭으로
  // 보여준다. app/property-detail/[id].tsx의 AI 매물 탭과 동일한 패턴이다.
  const [aiTab, setAiTab] = useState<"amount" | "period" | "target">("amount");
  const similarByAmount = useMemo(
    () => (product ? findSimilarInvestmentsByMinAmount(product) : []),
    [product],
  );
  const similarByPeriod = useMemo(() => (product ? findSimilarInvestmentsByPeriod(product) : []), [product]);
  const similarByTarget = useMemo(() => (product ? findSimilarInvestmentsByTarget(product) : []), [product]);
  const aiTabResults =
    aiTab === "amount" ? similarByAmount : aiTab === "period" ? similarByPeriod : similarByTarget;

  const [session, setSession] = useState<Session | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  // [STEP: 2026-09-09] 사용자 요청 — "투자 신청"을 비로그인 상태에서 누르면
  // 전체 화면 전환 대신 팝업으로 Google/Apple 로그인을 바로 띄운다.
  const [loginPromptVisible, setLoginPromptVisible] = useState(false);

  const isFavorite = useFavoritesStore((state) => (product ? state.isFavorite("investment_product", product.id) : false));
  const toggleFavorite = useFavoritesStore((state) => state.toggleFavorite);

  // [STEP: 2026-09-09-6] 사용자 요청 — "투자신청/문의하기 클릭 시 로그인이 안 되고
  // 다시 로그인창으로 돌아옴" 버그 수정. 기존에는 getSession()을 마운트 시 한 번만
  // 호출해 이 화면의 로컬 session state를 채웠는데, 이 화면 위에 LoginPromptModal로
  // 로그인해도(전체 화면 이동 없이 모달만 닫힘) 이 로컬 state는 갱신되지 않아 실제로는
  // 로그인이 됐는데도 여전히 "비로그인"으로 판단해 버튼을 다시 누르면 로그인 모달이
  // 계속 다시 떴다. app/_layout.tsx의 Auth Guard와 동일하게 onAuthStateChange 구독을
  // 추가해 로그인 성공 시 이 화면의 session state도 즉시 갱신되도록 한다.
  useEffect(() => {
    let mounted = true;

    getSession().then((initialSession) => {
      if (mounted) setSession(initialSession);
    });

    const { unsubscribe } = onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1600);
  }

  function handleFavoritePress() {
    if (!product) return;
    if (!session) {
      showToast(t("common.loginRequired"));
      router.push("/login");
      return;
    }
    const nowFavorite = toggleFavorite("investment_product", product.id);
    showToast(t(nowFavorite ? "common.favoriteAdded" : "common.favoriteRemoved"));
  }

  async function handleShare() {
    if (!product) return;
    try {
      await Share.share({ message: `${product.title} — ${product.expectedReturn} — ${product.period}` });
    } catch {
      // 사용자가 공유를 취소한 경우 등 — 별도 에러 처리를 하지 않는다.
    }
  }

  function handleGalleryScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setGalleryIndex(index);
  }

  if (!product) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header
          title={t("common.notFoundTitle")}
          leftAction={<BackButton onPress={() => router.back()} theme={theme} />}
        />
        <EmptyState title={t("common.notFoundTitle")} description={t("common.notFoundDescription")} />
      </SafeAreaView>
    );
  }

  const riskColor =
    product.riskLevel === "low" ? theme.success : product.riskLevel === "high" ? theme.danger : theme.accent;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header
        title={product.title}
        leftAction={<BackButton onPress={() => router.back()} theme={theme} />}
        rightAction={
          <Pressable
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={t("common.share")}
            style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
          >
            <Ionicons name="share-outline" size={22} color={theme.text} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.gallery}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleGalleryScroll}
          >
            {product.images.map((image, index) => (
              <Image key={index} source={image} style={styles.galleryImage} resizeMode="cover" />
            ))}
          </ScrollView>
          <View style={styles.galleryDots}>
            {product.images.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.galleryDot,
                  { backgroundColor: index === galleryIndex ? theme.onAccent : "rgba(255,255,255,0.5)" },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[textStyles.screenTitle, { color: theme.text, flex: 1 }]}>{product.title}</Text>
            <Pressable
              onPress={handleFavoritePress}
              accessibilityRole="button"
              accessibilityLabel={t(isFavorite ? "common.favoriteRemoved" : "common.favoriteAdded")}
              style={({ pressed }) => [
                styles.favoriteButton,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={20}
                color={isFavorite ? theme.danger : theme.text}
              />
            </Pressable>
          </View>

          <View style={styles.row}>
            <Ionicons name="location-outline" size={14} color={theme.secondaryText} />
            {/* [STEP: 2026-09-09-6] 사용자 요청 — 상세페이지 주소 글자크기 11px */}
            <Text style={[styles.addressText, { color: theme.secondaryText }]}>{product.propertyLocation}</Text>
          </View>

          <View style={styles.badgeRow}>
            {/* 사용자 요청(2026-09-09): "모집 중"(fundraising)만 파란 배경 + 흰 글씨 —
                InvestmentCard.tsx와 동일한 규칙. */}
            <Animated.View
              style={[
                styles.statusBadge,
                product.status === "fundraising"
                  ? { backgroundColor: pulsingAccent, borderColor: pulsingAccent }
                  : { backgroundColor: theme.card, borderColor: theme.border },
              ]}
            >
              <Text
                style={[
                  textStyles.caption,
                  { color: product.status === "fundraising" ? theme.onAccent : theme.text },
                ]}
              >
                {t(`invest.status.${product.status}`)}
              </Text>
            </Animated.View>
            <View style={[styles.statusBadge, { borderColor: riskColor }]}>
              <Text style={[textStyles.caption, { color: riskColor }]}>{t(`invest.risk.${product.riskLevel}`)}</Text>
            </View>
          </View>

          {/* 사용자 요청(2026-09-09): "/năm" 단위 접미사는 bold 없이, 숫자보다 작게 —
              InvestmentCard.tsx와 동일한 규칙(숫자:bold/큰 사이즈, 단위:regular/작은
              사이즈)을 여기(상세 페이지 hero 숫자)에도 그대로 적용해 앱 전체에서
              예상수익률 표기 방식을 통일한다. */}
          <Text style={[textStyles.heroValue, { color: theme.accent }]}>
            {splitYieldText(product.expectedReturn).rate}
            {splitYieldText(product.expectedReturn).suffix ? (
              <Text style={{ fontWeight: typography.weight.regular, fontSize: typography.size.md }}>
                {splitYieldText(product.expectedReturn).suffix}
              </Text>
            ) : null}
          </Text>

          <View style={styles.progressTrack}>
            <View style={[styles.progressTrackBg, { backgroundColor: theme.border }]}>
              {/* [STEP: 2026-09-09-6] 사용자 요청 — 모집률 그라데이션이 실기기(Android/iOS)에서
                  단색으로만 보이던 문제 수정. InvestmentCard.tsx와 동일하게, CSS
                  linear-gradient(web 전용)가 아니라 순수 View 배경색 N단계 보간
                  블록(GRADIENT_STEPS)을 나란히 이어붙이는 방식으로 바꿔 웹/네이티브
                  모두 동일하게 그라데이션이 보이도록 한다. */}
              <View style={[styles.progressFill, { width: `${Math.min(product.fundedPercent, 100)}%` }]}>
                {GRADIENT_STEPS.map((color, index) => (
                  <View key={index} style={[styles.progressFillStep, { backgroundColor: color }]} />
                ))}
              </View>
            </View>
            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("invest.progressLabel")} {product.fundedPercent}% · {formatVndAmount(product.raisedAmountVnd)} / {formatVndAmount(product.targetAmountVnd)}
            </Text>
          </View>

          <View style={styles.metricsGrid}>
            <MetricTile label={t("invest.minInvestmentLabel")} value={product.minInvestment} theme={theme} />
            <MetricTile label={t("invest.periodLabel")} value={product.period} theme={theme} />
            <MetricTile
              label={t("investDetail.targetAmountLabel")}
              value={formatVndAmount(product.targetAmountVnd)}
              splitUnit
              theme={theme}
            />
            <MetricTile
              label={t("investDetail.dividendFrequencyLabel")}
              value={t(`investDetail.dividendFrequency.${product.dividendFrequency}`)}
              theme={theme}
            />
          </View>

          <View style={styles.section}>
            <SectionHeader title={t("propertyDetail.descriptionTitle")} />
            {/* [STEP: 2026-09-09-8] 사용자 요청 — 상세설명 글자크기 한 치수 축소
                (body -> bodySmall). 다국어는 localizedText가 이미 지원한다. */}
            <Text style={[textStyles.bodySmall, { color: theme.text }]}>
              {localizedText(product.description, i18n.language)}
            </Text>
          </View>

          <View style={[styles.section, styles.lastSection]}>
            <SectionHeader title={t("investDetail.aiInvestmentsTitle")} />
            {/* [STEP: 2026-09-09-25] 사용자 요청 — 둥근 버튼형 Chip 대신 가로
                100%를 3등분해 채우는 사각 테두리 탭으로. 활성 탭만 상단 파란색
                2px 라인 + 좌우 회색 라인(하단은 비워 아래 콘텐츠와 이어지는
                느낌). Chip은 필(pill) 형태 전용이라 이 모양엔 맞지 않아 여기서만
                직접 Pressable로 구성한다(다른 화면 Chip 사용처에는 영향 없음). */}
            <View style={styles.aiTabRow}>
              <Pressable
                onPress={() => setAiTab("amount")}
                accessibilityRole="button"
                accessibilityState={{ selected: aiTab === "amount" }}
                style={[styles.aiTabButton, aiTab === "amount" ? styles.aiTabButtonActive : styles.aiTabButtonInactive]}
              >
                <Text style={[textStyles.bodySmall, { color: aiTab === "amount" ? theme.accent : theme.secondaryText, fontWeight: aiTab === "amount" ? typography.weight.semibold : typography.weight.regular }]}>
                  {t("investDetail.tabAmount")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAiTab("period")}
                accessibilityRole="button"
                accessibilityState={{ selected: aiTab === "period" }}
                style={[styles.aiTabButton, aiTab === "period" ? styles.aiTabButtonActive : styles.aiTabButtonInactive]}
              >
                <Text style={[textStyles.bodySmall, { color: aiTab === "period" ? theme.accent : theme.secondaryText, fontWeight: aiTab === "period" ? typography.weight.semibold : typography.weight.regular }]}>
                  {t("investDetail.tabPeriod")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAiTab("target")}
                accessibilityRole="button"
                accessibilityState={{ selected: aiTab === "target" }}
                style={[styles.aiTabButton, aiTab === "target" ? styles.aiTabButtonActive : styles.aiTabButtonInactive]}
              >
                <Text style={[textStyles.bodySmall, { color: aiTab === "target" ? theme.accent : theme.secondaryText, fontWeight: aiTab === "target" ? typography.weight.semibold : typography.weight.regular }]}>
                  {t("investDetail.tabTarget")}
                </Text>
              </Pressable>
            </View>
            {aiTabResults.length > 0 ? (
              <View style={styles.aiTabList}>
                {aiTabResults.map((similar) => (
                  <InvestmentCard
                    key={similar.id}
                    product={similar}
                    variant="list"
                    onPress={() => router.push(`/invest-detail/${similar.id}`)}
                  />
                ))}
              </View>
            ) : (
              <EmptyState
                title={t("common.noSimilarResultsTitle")}
                description={t("common.noSimilarResultsDescription")}
              />
            )}
          </View>
        </View>
      </ScrollView>

      {/* [STEP: 2026-09-09] 사용자 요청 — "투자 신청" 버튼을 누르면 기존의 단순
          확인 Modal 대신, 신청에 필요한 정보를 입력받는 전용 화면(app/invest-apply/
          [id].tsx)으로 이동한다. */}
      <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Button
          title={t("investDetail.applyButton")}
          onPress={() => {
            if (!session) {
              setLoginPromptVisible(true);
              return;
            }
            router.push({ pathname: "/invest-apply/[id]", params: { id: product.id } });
          }}
          style={styles.footerButton}
        />
      </View>

      <LoginPromptModal visible={loginPromptVisible} onClose={() => setLoginPromptVisible(false)} />

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function BackButton({ onPress, theme }: { onPress: () => void; theme: ThemeColors }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
    >
      <Ionicons name="chevron-back" size={24} color={theme.text} />
    </Pressable>
  );
}

// [STEP: 2026-09-09] 사용자 요청 — targetAmountLabel처럼 formatVndAmount가
// "N tỷ"를 반환할 수 있는 곳은 splitUnit={true}로 단위(tỷ)만 bold를 없앤다.
// 다른 호출부(minInvestment/period)는 이 prop을 넘기지 않아 기존과 동일하다.
function MetricTile({
  label,
  value,
  theme,
  splitUnit = false,
}: {
  label: string;
  value: string;
  theme: ThemeColors;
  splitUnit?: boolean;
}) {
  const parts = splitUnit ? splitYieldText(value) : { rate: value, suffix: "" };
  return (
    <View style={[styles.metricTile, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[textStyles.bodySmall, { color: theme.text, fontWeight: "600" }]} numberOfLines={1}>
        {parts.rate}
        {parts.suffix ? <Text style={{ fontWeight: typography.weight.regular }}>{parts.suffix}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  gallery: {
    height: 260,
  },
  galleryImage: {
    width: SCREEN_WIDTH,
    height: 260,
  },
  galleryDots: {
    position: "absolute",
    bottom: spacing.sm,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  galleryDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  body: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  favoriteButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addressText: {
    fontSize: 11,
    fontWeight: typography.weight.regular,
    flexShrink: 1,
  },
  badgeRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  progressTrack: {
    gap: 4,
    marginTop: spacing.xs,
  },
  progressTrackBg: {
    height: 6,
    borderRadius: radius.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    flexDirection: "row",
    overflow: "hidden",
  },
  progressFillStep: {
    flex: 1,
    height: "100%",
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  metricTile: {
    width: "48%",
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 2,
  },
  // [STEP: 2026-09-09-7] 사용자 재확인 — 앱 전체 "영역 간 간격" 기준을 md(16)로
  // 통일한다. body.gap(sm=8) + 이 marginTop(sm=8) = 16, home/property/invest/my/ai
  // 탭 화면의 content.gap(md=16)과 동일한 값이 된다(기존엔 8+16=24로 더 컸음).
  // [STEP: 2026-09-09-8] 사용자 요청("타이틀과 타이틀사이 간격 40px 줄것") — 디자인
  // 토큰을 한 단계 더 축소(sm -> xs). 요청한 40px과 실제 토큰 값(8px) 차이가 커서
  // 그대로 뺄 수 없어 "토큰 한 단계 축소"로 해석했다 — 빌드 후 육안 확인 필요.
  // [STEP: 2026-09-09-23] 사용자 요청 — "상세설명"/"AI 투자" 타이틀 상단 여백을
  // 정확히 30px로(body.gap 8 + 이 marginTop 22).
  section: {
    gap: spacing.xs,
    marginTop: 22,
  },
  lastSection: {
    paddingBottom: spacing.xl,
  },
  // [STEP: 2026-09-09-25] 가로 100%를 3개 탭이 정확히 3등분(gap 없음 — 사각
  // 테두리끼리 맞닿아야 좌우 라인이 자연스럽게 이어진다).
  aiTabRow: {
    flexDirection: "row",
    // [STEP: 2026-09-09-26] 사용자 요청 — 탭 하단 여백 정확히 10px.
    marginBottom: 10,
  },
  aiTabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    // [STEP: 2026-09-09-26] 사용자 요청 — 탭 사이 좌우 테두리를 hairline(기기별로
    // 0.5px 등으로 뭉개질 수 있음) 대신 명시적 1px로.
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // 비활성 탭 — 옅은 회색 테두리(라운딩 없는 사각형)만.
  aiTabButtonInactive: {
    borderColor: "#E5E5E5",
  },
  // 활성 탭 — 상단만 파란색 2px, 좌우는 회색, 하단은 없애 아래 콘텐츠(카드
  // 리스트)와 하나로 이어지는 느낌을 준다.
  aiTabButtonActive: {
    borderTopWidth: 2,
    borderTopColor: "#2F3C7E",
    borderLeftColor: "#E5E5E5",
    borderRightColor: "#E5E5E5",
    borderBottomWidth: 0,
  },
  aiTabList: {
    gap: spacing.sm,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerButton: {
    width: "100%",
  },
});
