import { Component, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { createScaledStyles, colors, radius, spacing, textStyles, typography } from "@/constants/theme";

/**
 * [2026-10-22 사용자 지시] "앱 실행 후 가끔 튕긴다"의 원인을 잡기 위한 그물.
 *
 * 지금까지 이 앱에는 ErrorBoundary가 한 개도 없었다. React는 렌더 중 예외를 잡아 줄
 * 경계가 없으면 **트리 전체를 언마운트**한다 — 개발 중에는 빨간 화면이지만 출시
 * 빌드에서는 화면이 그냥 사라지고, 사용자에게는 "튕겼다"로 보인다. 로그도 남지 않아
 * 어디서 깨졌는지 알 길이 없었다.
 *
 * 이 컴포넌트는 두 가지를 한다.
 *   · 튕기는 대신 오류 화면을 보여 준다(다시 시도 버튼 포함).
 *   · 메시지와 컴포넌트 스택을 console.error로 남긴다 — 기기를 USB로 연결하면
 *     `adb logcat`에서 바로 읽을 수 있고, 사용자는 화면의 글을 캡처해 보낼 수 있다.
 *
 * 번역(useTranslation)을 쓰지 않는 이유: i18n이 준비되기 전이나 i18n 자체가 깨져서
 * 들어오는 경우에도 이 화면은 떠야 한다. 여기서 번역을 부르면 오류 화면이 또 깨진다.
 */
type Props = { children: ReactNode };
type State = { error: Error | null; stack: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // 원문 그대로 남긴다 — 요약하면 정작 필요한 줄이 사라진다.
    console.error("[ErrorBoundary]", error?.message ?? error, info?.componentStack ?? "");
    this.setState({ stack: info?.componentStack ?? null });
  }

  handleRetry = () => {
    this.setState({ error: null, stack: null });
  };

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    const theme = colors.light;
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Text style={[textStyles.sectionTitle, { color: theme.danger }]}>Something went wrong</Text>
        <Text style={[textStyles.bodySmall, styles.message, { color: theme.text }]}>
          {error.message || String(error)}
        </Text>
        {stack ? (
          <ScrollView style={styles.stackBox} contentContainerStyle={styles.stackContent}>
            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{stack.trim()}</Text>
          </ScrollView>
        ) : null}
        <Pressable
          onPress={this.handleRetry}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.retry,
            { backgroundColor: theme.buttonPrimary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[textStyles.buttonLabel, { color: theme.onAccent }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  message: {
    fontWeight: typography.weight.medium,
  },
  stackBox: {
    maxHeight: 220,
  },
  stackContent: {
    paddingVertical: spacing.xs,
  },
  retry: {
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
}));
