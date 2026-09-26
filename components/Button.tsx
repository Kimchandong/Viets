import { ActivityIndicator, Pressable, PressableProps, StyleProp, Text, TextStyle, ViewStyle } from "react-native";

import { createScaledStyles, colors, opacity, radius, spacing, ThemeColors, typography } from "@/constants/theme";

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

/**
 * [2026-09-26] 버튼 크기 표를 **모듈 상수에서 함수로** 바꿨다.
 *
 * 예전에는 이 표가 모듈이 처음 읽힐 때 한 번 계산됐다. typography.size.*는 그 시점의
 * 화면 폭으로 이미 계산이 끝난 숫자라, 앱을 켠 뒤 폭이 바뀌어도(폴더블을 펴거나
 * 화면을 돌려도) 버튼 글자만 옛 크기로 굳어 있었다 — 앱에서 가장 많이 쓰이는
 * 컴포넌트라 그 하나로 화면 전체가 어긋나 보였다.
 *
 * 렌더할 때마다 부르면 그 순간의 typography.size를 읽는다.
 */
function sizeStyleFor(size: ButtonSize): { paddingVertical: number; paddingHorizontal: number; fontSize: number } {
  switch (size) {
    case "small":
      return { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, fontSize: typography.size.sm };
    case "large":
      return { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, fontSize: typography.size.lg };
    case "medium":
    default:
      return { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, fontSize: typography.size.md };
  }
}

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
  const sizeStyle = sizeStyleFor(size);

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

const styles = createScaledStyles(() => ({
  base: {
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  text: {
    fontWeight: typography.weight.semibold,
  },
}));
