import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors, spacing, typography } from "@/constants/theme";

export type LoadingProps = {
  /** 화면 전체를 채우는 로딩(예: 초기 화면 진입) vs 인라인 로딩(예: 리스트 하단) */
  fullscreen?: boolean;
  /** 생략하면 기존 i18n의 common.loading 문구를 사용한다. */
  message?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * 공통 로딩 UI. Supabase/React Query 호출은 이 컴포넌트 내부에 넣지 않는다 —
 * 호출부가 로딩 상태를 판단해 이 컴포넌트를 렌더링만 한다.
 */
export function Loading({ fullscreen = false, message, style }: LoadingProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();
  const text = message ?? t("common.loading");

  return (
    <View
      style={[
        styles.base,
        fullscreen && [styles.fullscreen, { backgroundColor: theme.background }],
        style,
      ]}
      accessibilityRole="progressbar"
    >
      <ActivityIndicator size={fullscreen ? "large" : "small"} color={theme.accent} />
      {text ? <Text style={[styles.message, { color: theme.secondaryText }]}>{text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  fullscreen: {
    flex: 1,
  },
  message: {
    fontSize: typography.size.sm,
  },
});
