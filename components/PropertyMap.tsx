import { StyleSheet, Text, View } from "react-native";

import type { MockProperty } from "@/constants/mockData";
import { radius, spacing, textStyles, type ThemeColors } from "@/constants/theme";

/**
 * [STEP 04-지도] 매물 지도 뷰 — 웹/기본 구현.
 *
 * react-native-maps는 웹을 지원하지 않는다(네이티브 모듈). Metro는 네이티브에서
 * PropertyMap.native.tsx를, 웹에서는 확장자 없는 이 파일을 자동으로 고른다.
 * (`.web.tsx`가 아니라 확장자 없는 이름을 쓰는 이유: tsc는 플랫폼 확장자를
 * 해석하지 못해 `.web.tsx`만 있으면 import 자체가 타입 에러가 난다.)
 * 웹에서는 지도 대신 "네이티브 앱에서 확인 가능"하다는 안내만 정직하게 표시한다.
 * 웹에서도 지도를 띄우려면 Maps JavaScript API 키(HTTP 리퍼러 제한)를 별도로
 * 발급해 @vis.gl/react-google-maps 등 웹 전용 라이브러리를 추가해야 한다 —
 * 현재 범위 밖.
 */

type Props = {
  properties: MockProperty[];
  onSelectProperty: (property: MockProperty) => void;
  theme: ThemeColors;
  emptyLabel: string;
  missingCoordsLabel: (count: number) => string;
  /** 네이티브 구현(PropertyMap.native.tsx)에서만 의미가 있다 — 웹은 안내 문구만 그린다. */
  height?: number;
};

export function PropertyMap({ theme, emptyLabel }: Props) {
  return (
    <View style={[styles.placeholder, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[textStyles.bodySmall, { color: theme.secondaryText, textAlign: "center" }]}>{emptyLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
});
