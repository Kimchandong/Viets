import { useTranslation } from "react-i18next";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { Button } from "@/components/Button";
import { colors, spacing, typography } from "@/constants/theme";

export type ErrorStateProps = {
  title: string;
  message?: string;
  /** 제공하면 재시도 버튼이 표시된다. 실제 API/Supabase 재호출 로직은 호출부의 책임. */
  onRetry?: () => void;
  /** 생략하면 기존 i18n의 common.retry 문구를 사용한다. */
  retryLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * 도메인 독립적인 에러 표시. 특정 API/Supabase 호출을 내부에서 실행하지 않는다 —
 * onRetry는 호출부가 넘겨준 콜백을 그대로 호출할 뿐이다.
 */
export function ErrorState({ title, message, onRetry, retryLabel, style }: ErrorStateProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();

  return (
    <View style={[styles.container, style]} accessibilityRole="alert">
      <Text style={[styles.title, { color: theme.danger }]}>{title}</Text>
      {message ? <Text style={[styles.message, { color: theme.secondaryText }]}>{message}</Text> : null}
      {onRetry ? (
        <View style={styles.action}>
          <Button title={retryLabel ?? t("common.retry")} variant="outline" size="small" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    textAlign: "center",
  },
  message: {
    fontSize: typography.size.sm,
    textAlign: "center",
  },
  action: {
    marginTop: spacing.md,
  },
});
