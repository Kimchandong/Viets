import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing, typography } from "@/constants/theme";

export type HeaderProps = {
  title: string;
  // [STEP: 2026-09-08] 홈 화면 카테고리(서브메뉴) 아이콘을 탭해 부동산/투자 화면으로
  // 이동했을 때, 상단 타이틀 자리에 어떤 서브메뉴(예: "아파트")에서 왔는지 제목
  // 아래 작은 글자로 함께 보여주기 위한 선택적 prop. 없으면 기존과 동일하게
  // 타이틀 한 줄만 렌더링한다(다른 화면은 전혀 영향받지 않음).
  subtitle?: string;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // [STEP: 2026-09-09-17] 사용자 요청(부동산 화면 목표 디자인) — 타이틀 아래
  // 하단 테두리를 없애고 싶은 화면을 위한 선택적 prop. 기본값 true라 다른 모든
  // 호출부(부동산 화면 제외)는 기존과 완전히 동일하게 보인다.
  bordered?: boolean;
};

/**
 * 특정 화면에 종속되지 않는 공통 Header. Safe Area(top)를 고려한다.
 * 뒤로가기/닫기 등 실제 동작은 호출부가 leftAction/rightAction으로 주입한다.
 */
export function Header({ title, subtitle, leftAction, rightAction, style, bordered = true }: HeaderProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;

  return (
    <SafeAreaView
      edges={["top"]}
      style={[
        { backgroundColor: theme.background, borderBottomColor: theme.border },
        styles.safeArea,
        { borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0 },
      ]}
    >
      <View style={[styles.row, style]}>
        <View style={styles.slot}>{leftAction}</View>
        {/* [STEP: 2026-09-09] 사용자 요청 — 타이틀/서브타이틀을 위아래 두 줄이 아닌
            한 줄로 붙여서 보여준다("아파트 · 부동산 매물"처럼). */}
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, { color: theme.text }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.secondaryText }]} numberOfLines={1}>
              · {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.slot}>{rightAction}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  slot: {
    minWidth: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  // [STEP: 2026-09-09] 타이틀+서브타이틀을 한 줄에 나란히 배치(가로 방향) —
  // 이전 STEP(2026-09-08)의 세로 2줄(titleColumn) 레이아웃을 대체한다.
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
  },
  title: {
    textAlign: "center",
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
  // [STEP: 2026-09-08] 서브메뉴명(예: "부동산 투자") 표시용 — 제목(17px)보다 작게
  // [STEP: 2026-09-09] 사용자 요청 — 타이틀과의 간격을 좀 더 넓게(marginLeft 추가)
  subtitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.regular,
    marginLeft: spacing.sm,
  },
});
