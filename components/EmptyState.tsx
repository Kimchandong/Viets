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
  // [2026-09-11 사용자 지시] 내용이 없을 때 나오는 문구는 앱 전체에서 굵기 없이
  // 11px로 통일한다. 기존에는 제목이 17px semibold라 "없다"는 안내가 실제 콘텐츠의
  // 제목보다 크고 굵게 보였다 — 비어 있다는 사실이 화면에서 가장 눈에 띄는 요소가
  // 될 이유가 없다. 이 컴포넌트를 쓰는 모든 화면에 함께 적용된다.
  //
  // typography.size.xs가 정확히 11이다 — 숫자를 직접 박지 않는 이유는 폰트 스케일
  // 기준이 바뀔 때 이 값만 따로 남지 않게 하기 위해서다.
  title: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.regular,
    textAlign: "center",
  },
  description: {
    fontSize: typography.size.xs,
    textAlign: "center",
  },
  action: {
    marginTop: spacing.md,
  },
});
