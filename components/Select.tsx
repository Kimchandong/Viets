import { useState } from "react";
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Modal } from "@/components/Modal";
import { colors, opacity, radius, spacing, textStyles, typography, type ThemeColors } from "@/constants/theme";

/**
 * [2026-09-11 사용자 지시] 목록에서 하나를 고르는 공용 셀렉트.
 *
 * React Native에는 웹의 `<select>`에 해당하는 기본 컴포넌트가 없다. 선택지가 8개쯤
 * 되면 칩을 나열하는 방식은 화면을 많이 차지하고, 무엇이 선택됐는지도 한눈에 들어오지
 * 않는다 — 그래서 "현재 값 한 줄 + 눌러서 모달 목록"이라는 셀렉트 형태로 바꾼다.
 *
 * 이 컴포넌트는 도메인을 모른다 — 라벨 번역은 호출부가 끝낸 뒤 options로 넘긴다.
 */

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectProps = {
  /** 입력란 위에 붙는 항목 이름(Input의 label과 같은 역할). */
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  theme: ThemeColors;
  /** 모달 상단 제목. 없으면 label을 쓴다. */
  modalTitle?: string;
  /** 아직 아무것도 고르지 않았을 때 보여줄 문구. */
  placeholder?: string;
  /** 스크린리더용 닫기 라벨(모달 backdrop). */
  closeLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

export function Select({
  label,
  value,
  options,
  onChange,
  theme,
  modalTitle,
  placeholder,
  closeLabel,
  containerStyle,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={[styles.label, { color: theme.text }]}>{label}</Text> : null}

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label ?? modalTitle}
        accessibilityValue={{ text: selected?.label }}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: theme.border,
            backgroundColor: theme.background,
            opacity: pressed ? opacity.pressed : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.value,
            { color: selected ? theme.text : theme.secondaryText },
          ]}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder ?? ""}
        </Text>
        <Ionicons name="chevron-down" size={18} color={theme.secondaryText} />
      </Pressable>

      <Modal visible={open} onClose={() => setOpen(false)} accessibilityLabel={closeLabel}>
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {modalTitle ?? label ?? ""}
        </Text>
        {/* 선택지가 많아도 모달이 화면을 넘기지 않도록 높이를 제한하고 안에서 스크롤한다. */}
        <ScrollView style={styles.list}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.option,
                  { borderBottomColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                ]}
              >
                <Text
                  style={[
                    textStyles.body,
                    { color: active ? theme.accent : theme.text },
                    active ? styles.optionActive : null,
                  ]}
                >
                  {option.label}
                </Text>
                {active ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Modal>
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
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  value: {
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: typography.weight.regular,
  },
  list: {
    maxHeight: 320,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionActive: {
    fontWeight: typography.weight.medium,
  },
});
