import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Image, StyleProp, Text, View, ViewStyle } from "react-native";

import { Card } from "@/components/Card";
import { createScaledStyles, colors, layout, radius, spacing, textStyles, typography, scaleFont } from "@/constants/theme";
import type { MockProperty } from "@/constants/mockData";
import { splitYieldText } from "@/utils/format";

export type PropertyCardProps = {
  property: MockProperty;
  onPress?: () => void;
  /** "featured": 가로 스크롤용 고정폭 카드, "list": 세로 리스트용 전체폭 카드 */
  variant?: "featured" | "list";
  style?: StyleProp<ViewStyle>;
};

/**
 * STEP 4-9B — Home(추천/최근)과 Property(리스트) 화면이 공유하는 매물 카드.
 * property는 constants/mockData.ts의 mock 값 — 실제 DB 연동 시 이 컴포넌트의 props
 * shape(MockProperty)만 실제 타입으로 교체하면 되도록 필드를 구성했다.
 *
 * [FULL-DEV] property.images(카테고리별 mock 썸네일)의 첫 번째 이미지를 카드 썸네일로
 * 표시한다 — 기존 아이콘 placeholder(Ionicons "image-outline")를 대체한다. 그 외
 * props/필드/레이아웃 구조는 전혀 바꾸지 않았다(기존 기능 보존 원칙).
 */
export function PropertyCard({ property, onPress, variant = "list", style }: PropertyCardProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();

  const isFeatured = variant === "featured";
  const thumbnail = property.images?.[0];
  // [STEP: 2026-09-09] 사용자 요청 — "4.2 tỷ"/"18,000k/tháng"처럼 가격 뒤에 붙는
  // 단위(tỷ, tháng)는 bold를 없앤다 — 숫자만 bold 유지, 단위는 regular weight로
  // 중첩 Text 렌더링(색상은 부모를 그대로 상속).
  const priceParts = splitYieldText(property.price);

  return (
    <Card
      testID="property-card"
      onPress={onPress}
      style={[styles.card, isFeatured && styles.cardFeatured, style]}
    >
      <View style={[styles.image, { backgroundColor: theme.border }]}>
        {thumbnail ? (
          <Image source={thumbnail} style={styles.imagePhoto} resizeMode="cover" />
        ) : null}
        <View style={[styles.statusTag, { backgroundColor: theme.background }]}>
          <Text style={[textStyles.caption, { color: theme.text }]}>
            {t(`property.status.${property.status}`)}
          </Text>
        </View>
      </View>

      {/* [STEP: 2026-09-09-3] 사용자 요청 — 매물명 글자 한 단계 축소(cardTitle의
          공용 md(14) 대신 이 카드 전용 sm 크기), 한 줄 고정은 기존 numberOfLines=1
          그대로 유지(디바이스 폭에 따라 RN이 자동으로 말줄임 처리). */}
      <Text testID="property-card-title" style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
        {property.title}
      </Text>

      {/* [STEP: 2026-09-09-3] 사용자 요청 — 주소(좌측)·거리(우측 정렬, "거리" 문구
          삭제하고 위치 마커 아이콘만 앞에 표시)를 한 줄에 배치. */}
      <View testID="property-card-address-row" style={styles.row}>
        <Ionicons name="location-outline" size={13} color={theme.secondaryText} />
        <Text style={[styles.addressText, { color: theme.secondaryText }]} numberOfLines={1}>
          {property.location}
        </Text>
        {property.distanceKm !== undefined ? (
          <View style={styles.distanceRight}>
            <Ionicons name="navigate-outline" size={11} color={theme.secondaryText} />
            <Text style={[styles.addressText, { color: theme.secondaryText }]} numberOfLines={1}>
              {property.distanceKm}km
            </Text>
          </View>
        ) : null}
      </View>

      {/* [STEP: 2026-09-09-3] 가격 줄.
          [2026-09-11 사용자 지시] 수익률 표시를 없앴다 — 매물 카드는 가격만 강조한다.
          (수익률 값 자체는 properties.rental_yield에 남아 있고 상세 화면에서 쓴다.) */}
      <View testID="property-card-price-row" style={styles.priceRow}>
        {/* STEP 4-12-2: 가격은 body보다 중요도가 높은 핵심 강조 정보라 전용 price 스타일을 쓴다
            (좁은 화면에서 body보다 덜 줄어든다 — theme.ts textStyles.price 주석 참조) */}
        <Text style={[textStyles.price, styles.priceText, { color: theme.accent }]} numberOfLines={1}>
          {priceParts.rate}
          {priceParts.suffix ? <Text style={[styles.priceUnit, { color: theme.secondaryText }]}>{priceParts.suffix}</Text> : null}
        </Text>

        {/* [2026-09-11 사용자 지시] 면적/침실수/욕실수를 가격 아래 줄이 아니라
            가격과 같은 줄 우측에 둔다(가격 좌 / 스펙 우). */}
        <View testID="property-card-meta-row" style={styles.metaRow}>
          <Text style={[textStyles.caption, styles.metaText, { color: theme.secondaryText }]} numberOfLines={1}>
            {property.area}
          </Text>
          {/* [STEP: 2026-09-09-16] 사용자 제보 — 아이콘 size를 리터럴로 고정하면
              웹 미리보기(스케일 팩터가 거의 1)에서는 우연히 글자크기와 비슷해 보이지만,
              textStyles.caption.fontSize는 moderateScale()로 화면폭에 따라 달라지므로
              실기기(빌드한 앱)에서는 아이콘이 글자보다 작아 보였다.
              [2026-09-11 사용자 지시] 글자·아이콘 모두 12px로 고정한다 — 한 상수를
              양쪽에 쓰므로 기기마다 어긋날 일이 없다. */}
          {property.bedrooms !== undefined ? (
            <View style={styles.metaItem}>
              <Ionicons name="bed-outline" size={META_SIZE} color={theme.secondaryText} />
              <Text style={[textStyles.caption, styles.metaText, { color: theme.secondaryText }]} numberOfLines={1}>
                {property.bedrooms}
              </Text>
            </View>
          ) : null}
          {property.bathrooms !== undefined ? (
            <View style={styles.metaItem}>
              <Ionicons name="water-outline" size={META_SIZE} color={theme.secondaryText} />
              <Text style={[textStyles.caption, styles.metaText, { color: theme.secondaryText }]} numberOfLines={1}>
                {property.bathrooms}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

/** [2026-09-11 사용자 지시] 면적/침실/욕실 행의 글자·아이콘 크기(px). */
const META_SIZE = scaleFont(12);

/**
 * 썸네일 높이. 캐러셀 화살표를 "이미지 상하 가운데"에 놓으려면 바깥(화면)에서도
 * 이 값을 알아야 해서 내보낸다 — 화면이 180을 다시 적어 두면 한쪽만 바뀐다.
 */
export const PROPERTY_CARD_IMAGE_HEIGHT = 180;

const styles = createScaledStyles(() => ({
  card: {
    gap: spacing.xs,
    width: "100%",
  },
  cardFeatured: {
    // [STEP: 2026-09-08] 사용자 요청 — 캐러셀 카드 1장이 화면 폭의 95%를 차지하도록
    // (기존 고정 220px는 기기 폭과 무관해 작은/큰 화면에서 비율이 들쭉날쭉했음).
    width: layout.featuredCardWidth,
  },
  image: {
    // [STEP: 2026-09-09-6] 사용자 요청 — 썸네일 이미지 높이 50% 증가(120 → 180).
    height: PROPERTY_CARD_IMAGE_HEIGHT,
    // [STEP: 2026-09-09] 사용자 요청 — 썸네일 이미지는 카드 상/좌/우 여백 없이
    // 카드 테두리에 딱 맞닿게 하고(내용 영역은 기존 padding 그대로 유지), 이미지는
    // 첫 번째 자식이라 flex gap이 marginTop보다 앞서 적용되지 않아 안전하다(위
    // home.tsx 배너 리팩터링과 동일한 원칙 — 상세: STEP4-16-4 참조). borderRadius는
    // 카드 바깥 라운드(radius.md)와 맞물리는 위쪽만 키우고 아래쪽은 기존 radius.sm
    // 유지(이미지 하단은 bleed하지 않으므로).
    marginTop: -spacing.md,
    marginHorizontal: -spacing.md,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    // [STEP: 2026-09-09-6] 사용자 요청 — 썸네일 하단 좌우 라운딩 삭제.
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: "hidden",
    // STEP: react-native-web에서는 absoluteFillObject로 채우는 imagePhoto가 부모의
    // position이 명시적으로 relative가 아니면 채워지지 않고 원본 크기로 줄어들어
    // 보일 수 있다 — 명시적으로 position:relative를 줘서 항상 카드 폭에 꽉 차게 한다.
    // (이전에 Ionicons placeholder를 가운데 정렬하던 alignItems/justifyContent는
    // 이제 실제 사진 썸네일로 대체되어 더 이상 필요하지 않아 제거했다.)
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
  statusTag: {
    position: "absolute",
    top: spacing.xs,
    left: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addressText: {
    fontSize: scaleFont(9),
    fontWeight: typography.weight.regular,
    flexShrink: 1,
  },
  // [STEP: 2026-09-09-3] 사용자 요청 — 거리를 주소 행 우측 끝에 정렬.
  distanceRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: "auto",
  },
  // [STEP: 2026-09-09-3] 사용자 요청 — 가격(좌)/수익률(우) 한 줄 배치.
  priceRow: {
    flexDirection: "row",
    // [2026-09-11 사용자 지시] 가격(좌)과 면적/방수/화장실(우)이 한 줄에 들어간다.
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    // [2026-09-11] 수익률 스택을 없앤 뒤로는 이 행에 가격 한 줄만 남는다.
    // position:relative는 그 스택의 절대배치 기준이었으므로 함께 정리했다.
  },
  metaRow: {
    flexDirection: "row",
    // [STEP: 2026-09-09-6] 사용자 요청 — 면적/수익률/거리 한 줄 정렬(더 이상 줄바꿈 안 함).
    // [STEP: 2026-09-09-3] 이제 면적/침실수/욕실수를 담는 행으로 용도 변경.
    flexWrap: "nowrap",
    gap: spacing.sm,
    // 가격이 길어도 우측 스펙이 밀리거나 줄바꿈되지 않게 한다.
    flexShrink: 0,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  // [2026-09-11 사용자 지시] 평수/방수/화장실 글자 12px. 위 아이콘과 같은 상수를 쓴다.
  metaText: {
    fontSize: META_SIZE,
  },
  // [STEP: 2026-09-09] 사용자 요청 — 가격 단위(tỷ/tháng) bold 없앰.
  // [2026-09-11 사용자 지시] 단위 글자 크기를 앞의 금액과 같게 — fontSize override를
  // 없애면 바깥 Text(textStyles.price)의 크기를 그대로 상속한다. 굵기만 다르게 둔다.
  priceUnit: {
    fontWeight: typography.weight.regular,
  },
  // 좁은 화면에서는 가격 쪽이 먼저 줄어든다(우측 스펙은 고정).
  priceText: {
    flexShrink: 1,
  },
}));
