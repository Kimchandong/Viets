import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors, radius, shadow, spacing, ThemeColors, typography } from "@/constants/theme";

export type ToastVariant = "info" | "success" | "danger";

export type ToastProps = {
  /** 표시 여부는 호출부가 로컬 state로 제어한다 — 이번 STEP에서는 전역 Toast 매니저를 만들지 않는다. */
  visible: boolean;
  message: string;
  variant?: ToastVariant;
  style?: StyleProp<ViewStyle>;
};

/**
 * 단순 presentational Toast. 전역 상태(Zustand)에 연결하지 않는다 —
 * 실제 전역 Toast 시스템(큐잉/자동 dismiss 등)은 별도 STEP에서 결정한다.
 */
export function Toast({ visible, message, variant = "info", style }: ToastProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  if (!visible) {
    return null;
  }

  const { backgroundColor, textColor } = getVariantColors(variant, theme);

  return (
    <View
      style={[styles.base, shadow.raised, { backgroundColor }, style]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.message, { color: textColor }]}>{message}</Text>
    </View>
  );
}

function getVariantColors(variant: ToastVariant, theme: ThemeColors) {
  switch (variant) {
    case "success":
      return { backgroundColor: theme.success, textColor: theme.onAccent };
    case "danger":
      return { backgroundColor: theme.danger, textColor: theme.onAccent };
    case "info":
    default:
      return { backgroundColor: theme.card, textColor: theme.text };
  }
}

const styles = StyleSheet.create({
  base: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  message: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    textAlign: "center",
  },
});
