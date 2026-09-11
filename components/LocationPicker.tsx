import { StyleSheet, Text, View } from "react-native";

import { radius, spacing, textStyles, type ThemeColors } from "@/constants/theme";

/**
 * [STEP 04-위치선택] 매물 등록 화면의 지도 위치 지정 — 웹/기본 구현.
 *
 * react-native-maps는 웹을 지원하지 않으므로 웹에서는 지도를 그리지 않고, 아래의
 * 위도/경도 입력란을 직접 쓰라는 안내만 표시한다(PropertyMap과 동일한 방침 —
 * 지도가 없는 환경에서 가짜 지도를 흉내 내지 않는다).
 * Metro는 네이티브에서 LocationPicker.native.tsx를, 웹에서는 이 파일을 고른다.
 */

export type LocationPickerProps = {
  latitude?: number;
  longitude?: number;
  onChange: (coordinate: { latitude: number; longitude: number }) => void;
  theme: ThemeColors;
  /** 네이티브 구현에서만 쓰인다. */
  hintLabel: string;
  unavailableLabel: string;
  height?: number;
};

export function LocationPicker({ theme, unavailableLabel }: LocationPickerProps) {
  return (
    <View style={[styles.placeholder, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[textStyles.bodySmall, { color: theme.secondaryText, textAlign: "center" }]}>
        {unavailableLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: 160,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
});
