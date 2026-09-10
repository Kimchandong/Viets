import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing, typography } from "@/constants/theme";

type Props = {
  title: string;
};

/**
 * STEP 03 (Foundation/Scaffold) 전용 placeholder.
 * 각 탭의 실제 화면이 구현되면 이 컴포넌트를 대체한다.
 */
export function PlaceholderScreen({ title }: Props) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.secondaryText }]}>
          STEP 03 · Foundation / Scaffold
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
  },
  subtitle: {
    fontSize: typography.size.sm,
  },
});
