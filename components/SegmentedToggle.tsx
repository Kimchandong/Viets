import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { opacity, radius, spacing, textStyles, typography, type ThemeColors } from "@/constants/theme";

/**
 * [2026-09-11 사용자 지시] 홈 화면의 "부동산 투자 / 부동산 매물" 탭과 같은 모양의
 * 2지 선다 토글.
 *
 * 홈에서만 쓰던 pill 토글(app/(tabs)/home.tsx의 CategoryTabButton + categoryTabRow)을
 * 공용 컴포넌트로 뽑았다. 켜짐/꺼짐을 아이콘 하나로 보여주는 방식과 달리 **두 선택지가
 * 모두 화면에 보이므로**, 지금 무엇이 선택됐는지와 다른 선택지가 무엇인지가 함께 읽힌다
 * (예: "노출 / 미노출").
 *
 * 이 컴포넌트는 도메인을 모른다 — 라벨 번역은 호출부가 끝낸 뒤 넘긴다.
 */

export type SegmentOption = {
  value: string;
  label: string;
};

export type SegmentedToggleProps = {
  /** 토글 위에 붙는 항목 이름. 없으면 토글만 그린다. */
  label?: string;
  value: string;
  options: SegmentOption[];
  onChange: (value: string) => void;
  theme: ThemeColors;
  /** 토글 아래 보조 설명. */
  description?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export function SegmentedToggle({
  label,
  value,
  options,
  onChange,
  theme,
  description,
  containerStyle,
}: SegmentedToggleProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={[styles.label, { color: theme.text }]}>{label}</Text> : null}

      <View style={[styles.row, { borderColor: theme.border, backgroundColor: theme.card }]}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: active ? theme.accent : "transparent",
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Text
                style={[
                  textStyles.bodySmall,
                  { color: active ? theme.onAccent : theme.text, fontWeight: typography.weight.medium },
                ]}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {description ? (
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{description}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  // 홈 화면 categoryTabRow와 같은 모양 — 다만 폼에서는 화면 폭을 다 쓴다
  // (홈은 가운데 80%로 좁혀 두었다).
  row: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  button: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
});
