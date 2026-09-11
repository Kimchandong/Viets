import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors, opacity, spacing, textStyles } from "@/constants/theme";

export type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * STEP 4-9B — 여러 화면(Home/Property/Invest/My)이 공유하는 섹션 제목 + "전체보기" 링크.
 * 화면마다 제목 스타일이 조금씩 달라지는 것을 막기 위한 최소 공유 컴포넌트 — 도메인 로직은 없다.
 */
export function SectionHeader({ title, actionLabel, onAction, style }: SectionHeaderProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  return (
    <View style={[styles.row, style]}>
      <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
        >
          {/* 사용자 요청(2026-09-09): "전체보기" → "더보기"로 문구 변경(i18n
              common.seeAll 값 수정)과 함께 bold 제거. [STEP: 2026-09-09-6] 사용자
              요청 — 글자 크기를 화면 전체에서 11px로 통일(caption 크기). */}
          <Text
            style={[textStyles.caption, { color: theme.accent }]}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // [2026-09-11 사용자 지시] 섹션 제목 위 여백이 0이라 앞 섹션의 카드와 붙어
    // 보였다. 아래(marginBottom)만 있고 위가 없어 제목이 자기 섹션보다 앞
    // 섹션에 딸린 것처럼 읽혔다.
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
});
