import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useIsEmbedded } from "@/components/EmbeddedScreen";
import { createScaledStyles, colors, spacing, typography } from "@/constants/theme";

export type HeaderProps = {
  title: string;
  /**
   * [2026-10-22 사용자 지시] 제목을 **조각마다 다른 굵기**로 그려야 할 때 쓴다
   * ("Ai"는 800, "BĐS"는 600 — 홈의 섹션 제목과 같은 모양).
   *
   * 주면 title 대신 이것을 그린다. 바깥 Text의 크기·색은 상속되므로 조각에서는
   * 굵기만 지정하면 된다. title은 그대로 받는다 — 접근성 라벨로 쓰인다.
   * (components/SectionHeader.tsx의 titleNode와 같은 방식이다.)
   */
  titleNode?: React.ReactNode;
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
export function Header({ title, titleNode, subtitle, leftAction, rightAction, style, bordered = true }: HeaderProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  // [2026-10-22] 탭 화면 안에 끼워진 경우에는 그리지 않는다 — 바깥 탭 화면이
  // 이미 제목과 뒤로가기를 갖고 있어, 그리면 헤더가 두 줄로 쌓인다.
  const embedded = useIsEmbedded();
  if (embedded) return null;

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
        {/* [2026-10-22 사용자 지시] 뒤로가기 버튼은 화면 왼쪽에서 10px.
            슬롯 폭(40)은 그대로 둬야 제목이 가운데에 남으므로, 슬롯 안에서
            아이콘을 가운데가 아니라 왼쪽에 붙인다. */}
        <View style={[styles.slot, styles.leftSlot]}>{leftAction}</View>
        {/* [STEP: 2026-09-09] 사용자 요청 — 타이틀/서브타이틀을 위아래 두 줄이 아닌
            한 줄로 붙여서 보여준다("아파트 · 부동산 매물"처럼). */}
        <View style={styles.titleRow}>
          <Text
            style={[styles.title, { color: theme.text }]}
            numberOfLines={1}
            accessibilityRole="header"
            accessibilityLabel={title}
          >
            {titleNode ?? title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: theme.secondaryText }]} numberOfLines={1}>
              · {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={[styles.slot, styles.rightSlot]}>{rightAction}</View>
      </View>
    </SafeAreaView>
  );
}

// [2026-09-11] 화면 상단 제목에는 추가 여백을 두지 않는다(사용자 지정: 0px).
// SafeAreaView(edges=["top"])가 상태바만큼 비켜주는 것으로 충분하다 — 여백을 주면
// 모든 화면의 제목이 한 칸씩 내려앉아 보인다.

const styles = createScaledStyles(() => ({
  safeArea: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    // [2026-10-22 사용자 지시] 뒤로가기(좌)·공유하기(우) 모두 화면 끝에서 10px.
    // 슬롯 폭(40)은 그대로 둬야 제목이 가운데에 남으므로, 여백은 row가 만들고
    // 아이콘은 각 슬롯 안에서 바깥쪽(좌/우)에 붙인다.
    paddingLeft: 10,
    paddingRight: 10,
  },
  slot: {
    minWidth: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  leftSlot: {
    alignItems: "flex-start",
  },
  rightSlot: {
    alignItems: "flex-end",
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
}));
