import { forwardRef } from "react";
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";

import { colors, opacity, radius, spacing, typography } from "@/constants/theme";

export type InputProps = Omit<TextInputProps, "style"> & {
  label?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<TextStyle>;
  // [STEP: 2026-09-09-32] 사용자 제보(스크린샷) — invest-apply 투자금액 입력의
  // "최소 투자금 N" 안내 문구만 강조(파란색+semibold)로 보여야 하는 등, 화면별로
  // helperText 색상/굵기를 다르게 줄 수 있도록 선택적 스타일 오버라이드를 추가한다.
  helperTextStyle?: StyleProp<TextStyle>;
};

/**
 * 도메인 독립적인 공통 Input. label/error/helperText는 모두 호출부에서 전달한다
 * (특정 feature의 검증 로직을 이 컴포넌트 내부에 넣지 않는다).
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, helperText, disabled = false, containerStyle, style, editable, placeholder, helperTextStyle, ...rest },
  ref,
) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const isDisabled = disabled || editable === false;
  const borderColor = error ? theme.danger : theme.border;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={[styles.label, { color: theme.text }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        editable={!isDisabled}
        placeholder={placeholder}
        placeholderTextColor={theme.secondaryText}
        // [STEP: 2026-09-09-6] 사용자 요청 — 타이틀(label) 없이 placeholder만 쓰는
        // 입력창(app/invest-apply/[id].tsx)에서도 스크린리더가 필드 목적을 읽을 수
        // 있도록, label이 없으면 placeholder를 접근성 라벨로 대신 쓴다.
        accessibilityLabel={label ?? placeholder}
        accessibilityState={{ disabled: isDisabled }}
        style={[
          styles.input,
          {
            borderColor,
            color: theme.text,
            backgroundColor: theme.background,
            opacity: isDisabled ? opacity.disabled : 1,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[styles.helper, { color: theme.danger }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[styles.helper, { color: theme.secondaryText }, helperTextStyle]}>{helperText}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: typography.size.md,
    // [2026-09-11 사용자 지시] 앱의 모든 입력 placeholder에 bold를 쓰지 않는다.
    // RN은 placeholder에만 별도 굵기를 줄 수 없고 TextInput의 굵기를 그대로 따르므로,
    // 기본값에 기대지 않고 여기서 regular(400)를 명시한다.
    fontWeight: typography.weight.regular,
  },
  helper: {
    fontSize: typography.size.xs,
  },
});
