import { Pressable, StyleProp, StyleSheet, Text, TextStyle } from "react-native";

import { opacity, radius, spacing, textStyles, ThemeColors, typography } from "@/constants/theme";

export type ChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: ThemeColors;
  /** "accent": 선택 시 accent 색상 배경, "neutral": 선택 시 text 색상 배경(예: 지역 필터) */
  tone?: "neutral" | "accent";
  // [STEP: 2026-09-09] 사용자 요청 — 부동산 화면 "전체지역" 메뉴바처럼 칩 하나하나의
  // 테두리를 없애고(바깥 가로줄만 남기고) 싶은 곳을 위한 선택적 prop. 기본값 true라
  // 기존 모든 호출부(카테고리 칩 등)는 지금과 완전히 동일하게 보인다.
  bordered?: boolean;
  // [STEP: 2026-09-09] 사용자 요청 — 선택(active) 시 배경색을 tone 기반 기본값 대신
  // 임의 색상으로 지정(예: "전체지역" 메뉴바는 #444444). 미지정 시 기존 동작 그대로.
  activeColor?: string;
  // [STEP: 2026-09-09] 사용자 요청 — "전체지역" 메뉴바는 둥근 pill이 아니라 사각형
  // 배경이어야 한다. 기본값 false(기존 pill 모양 유지).
  squared?: boolean;
  // [STEP: 2026-09-09-6] 사용자 요청 — "지역탭 클릭 비활성화시 회색, 클릭활성화시
  // 검은색으로" — 배경색과 별개로 텍스트 색상만 직접 지정하고 싶은 곳을 위한
  // 선택적 override. 미지정 시 기존 동작(active: onAccent, inactive: theme.text)
  // 그대로 유지된다.
  activeTextColor?: string;
  inactiveTextColor?: string;
  // [STEP: 2026-09-09] 사용자 요청 — 투자신청 페이지 금액 빠른선택 칩처럼 라벨
  // 글자크기(11px)를 이 칩 하나만 다르게 쓰고 싶은 곳을 위한 선택적 override.
  // 미지정 시 기존 textStyles.bodySmall 그대로 유지되어 다른 호출부(카테고리
  // 필터 칩 등)는 전혀 영향받지 않는다.
  textStyle?: StyleProp<TextStyle>;
  // [STEP: 2026-09-09-19] 사용자 제보 — 지역 메뉴(전체지역/...)의 "좌우 간격"을
  // 체감상 좌우하는 건 ScrollView의 gap보다 칩 자기 자신의 내부 paddingHorizontal
  // (기본 spacing.md=16, 칩 2개 사이 실제 여백은 padding+gap+padding)이 더 크다.
  // 이 칩 하나만 더 좁게 쓰고 싶은 곳을 위한 선택적 override — 미지정 시 기존
  // spacing.md 그대로(다른 모든 호출부는 전혀 영향받지 않음).
  paddingHorizontal?: number;
  // [2026-09-11 사용자 지시] 지역 칩 내부 여백을 상하까지 6px로. paddingHorizontal과
  // 같은 이유로 이 칩에만 적용되는 선택적 override다.
  paddingVertical?: number;
  // [2026-09-11 사용자 지시] "지역명 클릭 활성화 시 검은색 테두리".
  // bordered={false}인 칩(지역 메뉴)에도 **선택됐을 때만** 테두리를 주기 위한 prop.
  // 값을 주면 비활성 상태에서도 같은 두께의 투명 테두리를 그려 둔다 — 선택할 때만
  // 테두리가 생기면 칩 크기가 1px씩 늘었다 줄었다 해서 줄 전체가 흔들린다.
  activeBorderColor?: string;
  // [2026-09-11 사용자 지시] 지역 칩은 사각(squared)이지만 모서리를 살짝 굴린다.
  // squared/pill 두 가지로는 표현할 수 없어 값을 직접 받는다 — 주면 squared보다 우선한다.
  borderRadius?: number;
};

/**
 * STEP 4-9B — Property/Invest 필터 칩. 도메인 로직은 갖지 않는다 —
 * 호출부가 active 상태와 onPress만 넘기면 시각적 선택 상태만 표현한다.
 */
export function Chip({
  label,
  active,
  onPress,
  theme,
  tone = "neutral",
  bordered = true,
  activeColor,
  squared = false,
  activeTextColor,
  inactiveTextColor,
  textStyle,
  paddingHorizontal,
  paddingVertical,
  activeBorderColor,
  borderRadius,
}: ChipProps) {
  const resolvedActiveColor = activeColor ?? (tone === "accent" ? theme.accent : theme.text);
  const hasActiveBorder = activeBorderColor !== undefined;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? resolvedActiveColor : theme.card,
          borderColor: hasActiveBorder
            ? active
              ? activeBorderColor
              : "transparent"
            : active
              ? resolvedActiveColor
              : theme.border,
          borderWidth: bordered || hasActiveBorder ? 1 : 0,
          borderRadius: borderRadius ?? (squared ? 0 : radius.full),
          opacity: pressed ? opacity.pressed : 1,
        },
        paddingHorizontal !== undefined ? { paddingHorizontal } : null,
        paddingVertical !== undefined ? { paddingVertical } : null,
      ]}
    >
      <Text
        style={[
          textStyles.bodySmall,
          {
            color: active
              ? activeTextColor ?? theme.onAccent
              : inactiveTextColor ?? theme.text,
            fontWeight: typography.weight.medium,
          },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
