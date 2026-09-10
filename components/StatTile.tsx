import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";

import { colors, opacity, spacing, textStyles } from "@/constants/theme";

export type StatTileProps = {
  label: string;
  // [STEP: 2026-09-09] 사용자 요청 — "1,240 tỷ"처럼 값에 단위(tỷ/năm/tháng)가
  // 붙는 경우, 숫자는 bold 그대로 두고 단위만 bold를 없앤 채 다른 글자색을
  // 줄 수 있도록 string 대신 ReactNode도 받는다(utils/format.ts splitYieldText +
  // 중첩 <Text>로 조합). 기존처럼 순수 문자열만 넘기는 호출부는 그대로 동작한다.
  value: string | React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  // [STEP: 2026-09-09] 사용자 요청 — Invest 화면의 "투자개요" 숫자/라벨만 크기를
  // 줄이기 위한 선택적 오버라이드. My 화면의 활동 요약 StatTile은 이 prop을
  // 넘기지 않으므로 기존 크기(statValue/caption) 그대로 유지된다.
  valueStyle?: StyleProp<TextStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

/**
 * STEP 4-9B — Invest 개요 / My 활동 요약이 공유하는 큰 숫자 강조 타일.
 * 값 계산 로직은 갖지 않는다 — 호출부가 이미 계산/mock한 문자열을 그대로 넘긴다.
 */
export function StatTile({ label, value, onPress, style, valueStyle, labelStyle }: StatTileProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  const content = (
    <View style={[styles.container, style]}>
      <Text
        style={[textStyles.statValue, { color: theme.text }, valueStyle]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={[textStyles.caption, { color: theme.secondaryText }, labelStyle]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? opacity.pressed : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs / 2,
  },
});
