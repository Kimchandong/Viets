import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  ViewStyle,
} from "react-native";

import { colors, opacity, radius, spacing, ThemeColors, typography } from "@/constants/theme";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "small" | "medium" | "large";

export type ButtonProps = Omit<PressableProps, "style" | "children"> & {
  /** 버튼 내부에 표시할 텍스트. children이 있으면 children이 우선한다. */
  title?: string;
  /** 커스텀 콘텐츠(예: 아이콘+텍스트 조합)가 필요할 때 title 대신 사용한다. */
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const SIZE_STYLES: Record<ButtonSize, { paddingVertical: number; paddingHorizontal: number; fontSize: number }> = {
  small: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, fontSize: typography.size.sm },
  medium: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, fontSize: typography.size.md },
  large: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, fontSize: typography.size.lg },
};

/**
 * 도메인 독립적인 공통 Button.
 * 사용자 노출 문자열은 항상 호출부에서 title/children으로 전달한다(내부에 하드코딩하지 않음).
 */
export function Button({
  title,
  children,
  variant = "primary",
  size = "medium",
  disabled = false,
  loading = false,
  style,
  textStyle,
  onPress,
  ...rest
}: ButtonProps) {
  // STEP 4-12: 시스템 다크모드를 따라가지 않고 앱 전체를 항상 light 테마로 고정한다
  // (검은색 배경 금지 요구사항, colors.dark는 이후 재사용 가능성을 위해 삭제하지 않고 유지).
  const theme = colors.light;
  const isDisabled = disabled || loading;
  const sizeStyle = SIZE_STYLES[size];

  const variantStyle = getVariantStyle(variant, theme);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: variantStyle.backgroundColor,
          borderColor: variantStyle.borderColor,
          borderWidth: variantStyle.borderWidth,
          paddingVertical: sizeStyle.paddingVertical,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          opacity: isDisabled ? opacity.disabled : pressed ? opacity.pressed : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyle.textColor} />
      ) : children ? (
        children
      ) : (
        <Text
          style={[
            styles.text,
            { color: variantStyle.textColor, fontSize: sizeStyle.fontSize },
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

function getVariantStyle(variant: ButtonVariant, theme: ThemeColors) {
  switch (variant) {
    case "primary":
      return { backgroundColor: theme.accent, borderColor: theme.accent, borderWidth: 0, textColor: theme.onAccent };
    case "secondary":
      return { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, textColor: theme.text };
    case "outline":
      return { backgroundColor: theme.surfaceTransparent, borderColor: theme.accent, borderWidth: 1, textColor: theme.accent };
    case "ghost":
      return { backgroundColor: theme.surfaceTransparent, borderColor: theme.surfaceTransparent, borderWidth: 0, textColor: theme.accent };
    case "danger":
      return { backgroundColor: theme.danger, borderColor: theme.danger, borderWidth: 0, textColor: theme.onAccent };
  }
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  text: {
    fontWeight: typography.weight.semibold,
  },
});
