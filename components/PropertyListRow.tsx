import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import type { MockProperty } from "@/constants/mockData";
import { splitYieldText } from "@/utils/format";

/**
 * [2026-09-11 사용자 지시] 매물 섹션 가로형 행 — 홈("최신매물")과 부동산 탭
 * ("최신 매물")이 같은 디자인을 써야 해서 home.tsx 안에 있던 NearbyPropertyRow를
 * 공용 컴포넌트로 꺼냈다. 두 화면이 각자 복사본을 들고 있으면 다음 디자인 수정
 * 때 한쪽만 바뀐다.
 *
 * 배경색/테두리는 없다(사용자 지시) — 행 구분은 위쪽 회색 dashed 선으로 한다.
 */
export type PropertyListRowProps = {
  property: MockProperty;
  /** 거리 문구. 기준 위치가 없으면 빈 문자열을 넘겨 숨긴다. */
  distance?: string;
  /**
   * 행 위에 구분선을 그린다. 목록의 첫 행은 false로 넘긴다 — 섹션 제목 바로 아래에
   * 선이 하나 더 생기면 헤더와 붙어 보인다.
   */
  showDivider?: boolean;
  onPress: () => void;
};

/** 썸네일 높이. 가로는 사용자 지시로 1.5배(=THUMB_WIDTH). */
const THUMB_HEIGHT = 88;
/** [2026-09-11 사용자 지시] 매물 이미지 가로 50% 확대. */
const THUMB_WIDTH = Math.round(THUMB_HEIGHT * 1.5);
/** 면적/방수/화장실/거리 행의 글자·아이콘 크기(components/PropertyCard.tsx와 동일). */
const META_SIZE = 12;

export function PropertyListRow({
  property,
  distance = "",
  showDivider = false,
  onPress,
}: PropertyListRowProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();

  const thumbnail = property.images?.[0];
  const priceParts = splitYieldText(property.price);
  // [2026-09-11 사용자 지시] 매매=파랑(accent), 임대=주황(warning) 배경에 흰 글씨.
  const badgeColor = property.status === "forSale" ? theme.accent : theme.warning;

  return (
    <View>
      {/* [2026-09-11 사용자 지시] 매물 사이 회색 dashed 1px 구분선.
          Android는 한 변에만 준 borderStyle:"dashed"를 실선으로 그려 버려서,
          네 변 모두 dashed인 상자를 높이 1px 창으로 잘라 윗변만 보이게 한다. */}
      {showDivider ? (
        <View style={styles.dividerClip}>
          <View style={[styles.dividerLine, { borderColor: theme.border }]} />
        </View>
      ) : null}

      <Pressable
        testID="property-list-row"
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, { opacity: pressed ? opacity.pressed : 1 }]}
      >
        {/* 배지를 이미지 위에 얹어야 해서 썸네일을 relative 컨테이너로 감싼다. */}
        <View style={styles.thumbBox}>
          {thumbnail ? (
            <Image source={thumbnail} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: theme.background }]}>
              <Ionicons name="image-outline" size={22} color={theme.secondaryText} />
            </View>
          )}
          {/* [2026-09-11 사용자 지시] 임대/매매 배지는 사진 좌측 상단에. 색상은 그대로. */}
          <View style={[styles.badge, { backgroundColor: badgeColor }]}>
            <Text style={[styles.badgeText, { color: theme.onAccent }]} numberOfLines={1}>
              {t(`property.status.${property.status}`)}
            </Text>
          </View>
        </View>

        <View style={styles.texts}>
          {/* [2026-09-11 사용자 지시] 매물명은 두 줄까지 보여 준다. */}
          <Text style={[textStyles.body, styles.title, { color: theme.text }]} numberOfLines={2}>
            {property.title}
          </Text>
          <Text style={[textStyles.price, { color: theme.accent }]} numberOfLines={1}>
            {priceParts.rate}
            {priceParts.suffix ? (
              <Text style={{ fontWeight: typography.weight.regular }}>{priceParts.suffix}</Text>
            ) : null}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[textStyles.caption, styles.meta, { color: theme.secondaryText }]} numberOfLines={1}>
              {property.area}
            </Text>
            {property.bedrooms !== undefined ? (
              <View style={styles.metaItem}>
                <Ionicons name="bed-outline" size={META_SIZE} color={theme.secondaryText} />
                <Text style={[textStyles.caption, styles.meta, { color: theme.secondaryText }]}>
                  {property.bedrooms}
                </Text>
              </View>
            ) : null}
            {property.bathrooms !== undefined ? (
              <View style={styles.metaItem}>
                <Ionicons name="water-outline" size={META_SIZE} color={theme.secondaryText} />
                <Text style={[textStyles.caption, styles.meta, { color: theme.secondaryText }]}>
                  {property.bathrooms}
                </Text>
              </View>
            ) : null}
            {/* [2026-09-11 사용자 지시] 거리는 이 줄(행의 맨 아랫줄) 우측 끝에
                정렬한다. 기준 위치가 있을 때만 붙는다. */}
            {distance ? (
              <View style={[styles.metaItem, styles.metaDistance]}>
                <Ionicons name="location-outline" size={META_SIZE} color={theme.secondaryText} />
                <Text style={[textStyles.caption, styles.meta, { color: theme.secondaryText }]}>
                  {distance}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // [2026-09-11 사용자 지시] 카드 배경색/테두리 없음 — 행 구분은 여백과 dashed 선으로.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  dividerClip: {
    height: 1,
    overflow: "hidden",
    // [2026-09-11 사용자 지시] 매물 사이 간격을 좁힌다. 목록 쪽 gap을 0으로 두고
    // (home.tsx/property.tsx의 propertyList) 이 컴포넌트의 위아래 padding만으로
    // 간격을 만들므로, 선은 별도 margin 없이 정확히 가운데(8/8)에 놓인다.
  },
  dividerLine: {
    // 높이 2 + 사방 1px dashed → 위 1px만 창(dividerClip) 안에 남는다.
    height: 2,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  thumbBox: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    // 배지(absolute)의 기준점. react-native-web에서는 명시하지 않으면 어긋난다.
    position: "relative",
  },
  thumb: {
    width: "100%",
    height: "100%",
    borderRadius: radius.sm,
  },
  thumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  // minWidth:0이 없으면 긴 제목이 행을 밀어내 썸네일이 찌그러진다.
  texts: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 4,
  },
  // 사진 좌측 상단 임대/매매 배지.
  badge: {
    position: "absolute",
    top: spacing.xs,
    left: spacing.xs,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: typography.weight.semibold,
  },
  // [2026-09-11 사용자 지시] 매물명 굵기 600, 크기는 한 단계 위(bodySmall → body).
  title: {
    fontWeight: typography.weight.semibold,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  // 남는 폭을 전부 왼쪽 여백으로 밀어 거리 항목만 우측 끝에 붙인다.
  metaDistance: {
    marginLeft: "auto",
  },
  meta: {
    fontSize: META_SIZE,
  },
});
