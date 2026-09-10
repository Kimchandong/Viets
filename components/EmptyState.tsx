import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors, spacing, typography } from "@/constants/theme";

export type EmptyStateProps = {
  title: string;
  description?: string;
  /** 예: 재시도/이동 버튼 등 — 호출부가 <Button> 등을 넣어 조합한다. */
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * 도메인 독립적인 빈 상태 표시. 어떤 리스트/도메인에서든 재사용한다.
 */
export function EmptyState({ title, description, action, style }: EmptyStateProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { color: theme.secondaryText }]}>{description}</Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
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
  description: {
    fontSize: typography.size.sm,
    textAlign: "center",
  },
  action: {
    marginTop: spacing.md,
  },
});
