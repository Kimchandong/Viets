import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Image, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { Card } from "@/components/Card";
import { colors, layout, radius, spacing, textStyles, typography } from "@/constants/theme";
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
      <Text testID="property-card-title" style={[textStyles.cardTitle, styles.titleText, { color: theme.text }]} numberOfLines={1}>
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

      {/* [STEP: 2026-09-09-3] 사용자 요청 — 가격(좌측)·수익률(우측 정렬)을 한 줄에 배치. */}
      <View testID="property-card-price-row" style={styles.priceRow}>
        {/* STEP 4-12-2: 가격은 body보다 중요도가 높은 핵심 강조 정보라 전용 price 스타일을 쓴다
            (좁은 화면에서 body보다 덜 줄어든다 — theme.ts textStyles.price 주석 참조) */}
        <Text style={[textStyles.price, { color: theme.accent }]}>
          {priceParts.rate}
          {priceParts.suffix ? <Text style={[styles.priceUnit, { color: theme.secondaryText }]}>{priceParts.suffix}</Text> : null}
        </Text>
        {/* [STEP: 2026-09-09-14] 사용자 제보(스크린샷) — 수익률을 캡션 크기 한 줄
            ("6.5%/năm")로 작게 보여주던 것을, 실제 목표 디자인처럼 큰 강조 숫자
            ("6.5%")와 그 아래 작은 단위("năm")로 나눠 2줄 스택으로 바꾼다.
            yieldRate는 항상 "<수치>/<단위>" 형식(mockData.ts)이라 "/"로 분리한다. */}
        {/* [STEP: 2026-09-09-18] 사용자 요청(목표 디자인) — "%"는 bold 없이, "6.5"
            보다 작게. yieldRate는 "<수치>%/<단위>" 형식이라 "%"를 한 번 더 분리한다. */}
        {property.yieldRate ? (
          <View style={styles.yieldStack}>
            <Text style={[styles.yieldValue, { color: theme.warning }]} numberOfLines={1}>
              {property.yieldRate.split("/")[0].replace("%", "")}
              {property.yieldRate.split("/")[0].includes("%") ? (
                <Text style={[styles.yieldPercent, { color: theme.warning }]}>%</Text>
              ) : null}
            </Text>
            {property.yieldRate.includes("/") ? (
              <Text style={[styles.yieldUnit, { color: theme.warning }]} numberOfLines={1}>
                {property.yieldRate.split("/")[1]}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* [STEP: 2026-09-09-3] 사용자 요청 — 가격란 아래에 면적/침실수/욕실수 표시
          (기존 수익률/거리는 위 두 줄로 이동). */}
      <View testID="property-card-meta-row" style={styles.metaRow}>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
          {property.area}
        </Text>
        {/* [STEP: 2026-09-09-16] 사용자 제보 — 아이콘 size를 리터럴 11로 고정하면
            웹 미리보기(스케일 팩터가 거의 1)에서는 우연히 글자크기와 비슷해 보이지만,
            textStyles.caption.fontSize는 moderateScale()로 화면폭에 따라 달라지므로
            실기기(빌드한 앱)에서는 아이콘이 글자보다 작아 보였다. 아이콘 size를
            textStyles.caption.fontSize로 직접 지정해 항상 같은 값을 쓰게 한다. */}
        {property.bedrooms !== undefined ? (
          <View style={styles.metaItem}>
            <Ionicons name="bed-outline" size={textStyles.caption.fontSize} color={theme.secondaryText} />
            <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
              {property.bedrooms}
            </Text>
          </View>
        ) : null}
        {property.bathrooms !== undefined ? (
          <View style={styles.metaItem}>
            <Ionicons name="water-outline" size={textStyles.caption.fontSize} color={theme.secondaryText} />
            <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
              {property.bathrooms}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
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
    height: 180,
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
  // [STEP: 2026-09-09-3] 사용자 요청 — 매물명 카드 전용 폰트 크기(공용 cardTitle
  // 토큰은 InvestmentCard 등 다른 곳에서도 쓰므로 여기서만 override).
  titleText: {
    fontSize: typography.size.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addressText: {
    fontSize: 9,
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    // [STEP: 2026-09-09-16] 사용자 제보(빌드 확인) — yieldStack(6.5%/năm 2줄
    // 스택)이 커지면서 이 행 전체의 flex 높이가 늘어나, 아래 metaRow(면적/침실/
    // 욕실)가 통째로 밀려 내려갔다. yieldStack을 절대배치로 빼서 이 행의 높이가
    // 다시 왼쪽 가격 텍스트 한 줄 높이만으로 결정되도록 한다 — metaRow는 이제
    // 예전처럼 가격 바로 아래에 붙는다. position:relative는 그 절대배치 기준점.
    position: "relative",
  },
  metaRow: {
    flexDirection: "row",
    // [STEP: 2026-09-09-6] 사용자 요청 — 면적/수익률/거리 한 줄 정렬(더 이상 줄바꿈 안 함).
    // [STEP: 2026-09-09-3] 이제 면적/침실수/욕실수를 담는 행으로 용도 변경.
    flexWrap: "nowrap",
    gap: spacing.sm,
    marginTop: 2,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  // [STEP: 2026-09-09] 사용자 요청 — 가격 단위(tỷ/tháng) bold 없앰.
  // [STEP: 2026-09-09-6] 사용자 요청 — 이 단위 글자 크기 11px.
  priceUnit: {
    fontWeight: typography.weight.regular,
    fontSize: 11,
  },
  // [STEP: 2026-09-09-14] 수익률 강조 스택(큰 수치 + 작은 단위, 우측 정렬).
  yieldStack: {
    alignItems: "flex-end",
    // [STEP: 2026-09-09-16] priceRow의 flex 흐름에서 완전히 빼서(절대배치) 행
    // 높이에 영향을 주지 않게 한다 — 오른쪽 위 모서리에 고정.
    position: "absolute",
    top: 0,
    right: 0,
  },
  yieldValue: {
    fontSize: typography.size.heroValue,
    fontWeight: typography.weight.bold,
    lineHeight: typography.size.heroValue,
  },
  // [STEP: 2026-09-09-18] "%" 전용 — bold 없이, 본문 숫자(heroValue)보다 작게.
  yieldPercent: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.regular,
  },
  yieldUnit: {
    fontWeight: typography.weight.regular,
    fontSize: 11,
    marginTop: -2,
  },
});
