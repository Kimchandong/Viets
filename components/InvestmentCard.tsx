import { useTranslation } from "react-i18next";
import { Animated, Image, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { Card } from "@/components/Card";
import { createScaledStyles, colors, layout, radius, spacing, textStyles, typography, scaleFont } from "@/constants/theme";
import type { MockInvestmentProduct } from "@/constants/mockData";
import { buildGradientSteps, splitYieldText } from "@/utils/format";
import { usePulsingColor } from "@/hooks/usePulsingColor";

export type InvestmentCardProps = {
  product: MockInvestmentProduct;
  onPress?: () => void;
  /** "featured": 가로 스크롤용 고정폭 카드, "list": 세로 리스트용 전체폭 카드 */
  variant?: "featured" | "list";
  style?: StyleProp<ViewStyle>;
};

/**
 * STEP 4-9B — Invest 화면 전용 투자상품 카드. 금융 서비스다운 절제된 스타일을 위해
 * 진행률(fundedPercent)은 얇은 progress bar 하나로만 표시한다(과도한 색상/장식 지양).
 * product는 constants/mockData.ts의 mock 값 — 실제 연동 시 investment_products
 * 조회 결과로 이 shape을 교체하는 것을 전제로 필드를 구성했다.
 *
 * [FULL-DEV] product.images(카테고리별 mock 썸네일)의 첫 번째 이미지를 카드 상단에
 * 썸네일로 추가했다 — 기존에는 이미지 영역 자체가 없었다(PropertyCard와의 시각적
 * 일관성 확보). 그 외 기존 필드/레이아웃(headerRow/metricsRow/progressTrack)은
 * 전혀 바꾸지 않았다(기존 기능 보존 원칙).
 */
// [STEP: 2026-09-09-6] 그라데이션 근사용 색상 단계 — 컴포넌트 렌더마다 다시 계산할
// 필요가 없으므로(accentLight/accent는 light 테마 고정값) 모듈 스코프에서 한 번만
// 계산한다.
const GRADIENT_STEPS = buildGradientSteps(colors.light.accentLight, colors.light.accent, 12);

export function InvestmentCard({ product, onPress, variant = "list", style }: InvestmentCardProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();
  const thumbnail = product.images?.[0];
  // [STEP: 2026-09-09-24] 사용자 요청 — "모집중" 배지 배경을 accent(현재 파란색)와
  // accentLight(더 밝은 파란색) 사이에서 깜박이게.
  const pulsingAccent = usePulsingColor(theme.accent, theme.accentLight);
  // 사용자 요청(2026-09-09): "9.2%/năm" 중 "/năm" 단위 접미사는 bold를 없애고
  // 숫자보다 작게 표시한다 — splitYieldText로 숫자(rate)와 접미사(suffix)를 분리.
  const expectedReturnParts = splitYieldText(product.expectedReturn);

  return (
    <Card onPress={onPress} style={[styles.card, variant === "featured" && styles.cardFeatured, style]}>
      {thumbnail ? (
        <View style={[styles.image, { backgroundColor: theme.border }]}>
          <Image source={thumbnail} style={styles.imagePhoto} resizeMode="cover" />
          {/* [STEP: 2026-09-09-6] 사용자 요청 — 모집중/마감/완료 상태 배지를 카드
              제목 옆이 아니라 썸네일 이미지 우측 상단(상/우측에서 살짝 떨어진
              위치)으로 이동. "모집 중"만 파란 배경+흰 글씨 강조, 나머지는 중립. */}
          <Animated.View
            style={[
              styles.statusTag,
              product.status === "fundraising"
                ? { backgroundColor: pulsingAccent, borderColor: pulsingAccent }
                : { backgroundColor: theme.background, borderColor: theme.border },
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
        </View>
      ) : null}

      <View style={styles.headerRow}>
        {/* [2026-09-11 사용자 지시] 상품명 글자 한 치수 크게 — cardTitle(md) 위 단계인 lg. */}
        <Text style={[textStyles.cardTitle, { color: theme.text, flex: 1 }]} numberOfLines={2}>
          {product.title}
        </Text>
      </View>

      {/* [STEP: 2026-09-09-6] 사용자 요청 — 주소 글자 11px 고정 */}
      <Text style={styles.addressText} numberOfLines={1}>
        {product.propertyLocation}
      </Text>

      {/* 사용자 요청(2026-08-31): 이 3열 행에 폭 제약이 없어 라벨/값 텍스트가 카드
          경계 밖으로 이탈하는 문제가 있었다 — metric 열에 flex:1을 줘 카드 폭 안에서
          균등하게 나눠 갖게 하고, 각 텍스트에 numberOfLines={2}를 둬 한 줄에 다
          들어가지 않을 때 카드 밖으로 튀어나오는 대신 2줄로 감싸이도록 한다. */}
      {/* [STEP: 2026-09-09-6] 사용자 요청 — 라벨(예상수익/최소투자/투자기간) +
          값 글자 크기를 모두 11px로 통일. */}
      <View style={styles.metricsRow}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel} numberOfLines={2}>
            {t("invest.expectedReturnLabel")}
          </Text>
          <Text style={[styles.metricValue, { color: theme.accent, fontWeight: typography.weight.bold }]} numberOfLines={2}>
            {expectedReturnParts.rate}
            {expectedReturnParts.suffix ? (
              <Text style={{ fontWeight: typography.weight.regular }}>{expectedReturnParts.suffix}</Text>
            ) : null}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel} numberOfLines={2}>
            {t("invest.minInvestmentLabel")}
          </Text>
          {/* [2026-09-11 사용자 지시] 금액 단위 k는 bold 없이, 앞에 한 칸 띄우고,
              금액과 같은 크기로. splitYieldText가 "5,000k"를 "5,000" + " k"로 나눈다 —
              매물 카드·상세가 이미 쓰는 방식과 같게 맞춘다. fontSize를 따로 주지
              않으므로 바깥 metricValue 크기를 그대로 상속한다. */}
          <Text style={[styles.metricValue, { color: theme.text }]} numberOfLines={2}>
            {splitYieldText(product.minInvestment).rate}
            {splitYieldText(product.minInvestment).suffix ? (
              <Text style={{ fontWeight: typography.weight.regular }}>
                {splitYieldText(product.minInvestment).suffix}
              </Text>
            ) : null}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricLabel} numberOfLines={2}>
            {t("invest.periodLabel")}
          </Text>
          <Text style={[styles.metricValue, { color: theme.text }]} numberOfLines={2}>
            {product.period}
          </Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressTrackBg,
            { backgroundColor: theme.border },
          ]}
        >
          {/* [STEP: 2026-09-09-6] 사용자 요청 — "그라데이션 효과가 빌드한
              스마트폰에서는 미적용되고 단색으로 나옴" 버그 수정. 기존엔 web
              전용 CSS linear-gradient만 쓰고 네이티브는 단색 폴백이었다(RN
              표준 gradient API가 없고, expo-linear-gradient 같은 네이티브
              패키지는 이 환경에서 설치할 수 없음). 이제 모든 플랫폼에서
              동일하게, accentLight→accent를 N단계로 보간한 얇은 세로 블록들을
              나란히 이어붙여 그라데이션처럼 보이게 한다(순수 View 배경색이라
              네이티브/웹 모두 100% 동일 렌더링). */}
          <View style={[styles.progressFill, { width: `${Math.min(product.fundedPercent, 100)}%` }]}>
            {GRADIENT_STEPS.map((color, index) => (
              <View key={index} style={[styles.progressFillStep, { backgroundColor: color }]} />
            ))}
          </View>
        </View>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
          {t("invest.progressLabel")} {product.fundedPercent}%
        </Text>
      </View>
    </Card>
  );
}

/**
 * 썸네일 높이. 캐러셀 화살표를 "이미지 상하 가운데"에 놓으려면 바깥(화면)에서도
 * 이 값을 알아야 해서 내보낸다.
 */
export const INVESTMENT_CARD_IMAGE_HEIGHT = 165;

const styles = createScaledStyles(() => ({
  card: {
    gap: spacing.xs,
    width: "100%",
  },
  cardFeatured: {
    // [STEP: 2026-09-08] 사용자 요청 — 캐러셀 카드 1장이 화면 폭의 95%를 차지하도록
    // (기존 고정 260px는 기기 폭과 무관해 작은/큰 화면에서 비율이 들쭉날쭉했음).
    width: layout.featuredCardWidth,
  },
  image: {
    // [STEP: 2026-09-09-6] 사용자 요청 — 썸네일 이미지 높이 50% 증가(110 → 165).
    height: INVESTMENT_CARD_IMAGE_HEIGHT,
    // [STEP: 2026-09-09] 사용자 요청 — 썸네일 이미지는 카드 상/좌/우 여백 없이
    // 카드 테두리에 딱 맞닿게 하고(내용 영역은 기존 padding 그대로 유지), 이미지는
    // 첫 번째 자식이라 flex gap이 marginTop보다 앞서 적용되지 않아 안전하다(위
    // home.tsx 배너 리팩터링과 동일한 원칙 — 상세: STEP4-16-4 참조).
    marginTop: -spacing.md,
    marginHorizontal: -spacing.md,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    // [STEP: 2026-09-09-6] 사용자 요청 — 썸네일 하단 좌우 라운딩 삭제.
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: "hidden",
    // STEP: PropertyCard.tsx와 동일한 이유 — react-native-web에서 absoluteFillObject로
    // 채우는 imagePhoto/mockTag가 부모 position이 명시적 relative가 아니면 제대로
    // 채워지지 않을 수 있어 명시적으로 지정한다.
    position: "relative",
    marginBottom: spacing.xs,
  },
  imagePhoto: {
    // STEP: absoluteFillObject(position:absolute + top/right/bottom/left:0)로 채우던
    // 방식이 react-native-web에서는 부모 박스에 꽉 차지 않고 작게 줄어들어 가운데
    // 정렬되는 문제가 있었다 — statusTag/mockTag 같은 작은 배지는 absolute로 잘
    // 동작하지만, 이미지 전체를 채우는 용도로는 신뢰할 수 없어 일반 flow의
    // width/height 100%로 바꿨다(부모 .image는 overflow:hidden이라 cover 크롭은
    // 그대로 유지된다).
    width: "100%",
    height: "100%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  // [STEP: 2026-09-09-6] 사용자 요청 — 상태 배지를 카드 제목 옆에서 썸네일 이미지
  // 우측 상단(상/우측에서 살짝 띄워서)으로 이동.
  statusTag: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addressText: {
    fontSize: scaleFont(11),
    fontWeight: typography.weight.regular,
    color: colors.light.secondaryText,
  },
  metricLabel: {
    fontSize: scaleFont(11),
    fontWeight: typography.weight.regular,
    color: colors.light.secondaryText,
  },
  metricValue: {
    fontSize: scaleFont(11),
    fontWeight: typography.weight.semibold,
  },
  metricsRow: {
    flexDirection: "row",
    // 3개 metric 열이 flex:1로 카드 폭을 균등하게 나눠 갖게 되어 space-between이
    // 실질적으로 하는 일은 없어지지만, gap 미지원 RN 구버전 대비 안전망으로 유지한다.
    justifyContent: "space-between",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metric: {
    // 사용자 요청: 라벨/값 텍스트가 카드 밖으로 이탈하지 않도록 각 열이 카드 폭을
    // 균등하게 나눠 갖고(flex:1), 그 안에서 텍스트가 줄어들도록 한다(flexShrink: 1).
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  progressTrack: {
    marginTop: spacing.xs,
    gap: 4,
  },
  progressTrackBg: {
    height: 4,
    borderRadius: radius.full,
    overflow: "hidden",
  },
  // [STEP: 2026-09-09-6] 그라데이션 블록들을 가로로 나란히 배치하는 컨테이너.
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
}));
