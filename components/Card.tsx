import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { colors, opacity, radius, shadow, spacing } from "@/constants/theme";

export type CardProps = {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  // [STEP: 2026-09-09-10] 사용자 요청 — 웹 미리보기(브라우저 개발자도구)에서 이
  // 카드가 어떤 컴포넌트인지 쉽게 식별할 수 있도록 testID를 받아 그대로 전달한다.
  // react-native-web에서 testID는 DOM의 data-testid 속성으로 렌더링된다. 생략 시
  // 기존과 완전히 동일하게 동작한다.
  testID?: string;
};

/**
 * 도메인 독립적인 Card 컨테이너. Property/Investment 등 특정 도메인에 종속시키지 않는다 —
 * 각 feature는 이 Card를 감싸 자신만의 콘텐츠(이미지/가격/뱃지 등)를 배치한다.
 */
export function Card({ children, onPress, disabled = false, style, testID }: CardProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  const content = (
    <View
      testID={onPress ? undefined : testID}
      style={[
        styles.base,
        { backgroundColor: theme.card, borderColor: theme.border },
        shadow.card,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({ opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
});
