import { useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

import { colors, layout, opacity, radius, shadow, spacing } from "@/constants/theme";

export type HorizontalCardCarouselProps = {
  children: React.ReactNode;
  /** ScrollView 자체 스타일(예: 화면 좌우 bleed용 marginHorizontal) */
  style?: StyleProp<ViewStyle>;
  /** contentContainerStyle(예: 카드 간 gap) — paddingHorizontal은 이 컴포넌트가 직접 관리한다 */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** 화살표를 한 번 눌렀을 때 스크롤할 거리(대략 카드 1장 폭 + gap) */
  step: number;
};

/**
 * [STEP: 2026-09-09-6] 사용자 요청 — 홈/부동산/투자 화면의 "추천 매물"/"추천 투자상품"
 * 가로 슬라이드 캐러셀 공통 컴포넌트로 분리했다: (1) 첫 카드가 화면 가운데 오도록
 * 좌우 peek 여백(layout.featuredCardSidePadding)을 이 컴포넌트가 직접 적용하고,
 * (2) 스크롤 위치에 따라 우측/좌측에 원형 화살표 버튼을 오버레이해 클릭으로도
 * 다음/이전 카드로 이동할 수 있게 한다(스와이프도 기존처럼 그대로 동작).
 * 화살표는 더 이상 스크롤할 방향이 없을 때는 숨긴다(맨 끝에서 좌/우 각각).
 */
export function HorizontalCardCarousel({ children, style, contentContainerStyle, step }: HorizontalCardCarouselProps) {
  const theme = colors.light;
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setScrollX(event.nativeEvent.contentOffset.x);
  }

  function scrollByStep(direction: 1 | -1) {
    const maxScrollX = Math.max(0, contentWidth - containerWidth);
    const next = Math.min(maxScrollX, Math.max(0, scrollX + direction * step));
    scrollRef.current?.scrollTo({ x: next, animated: true });
  }

  const maxScrollX = Math.max(0, contentWidth - containerWidth);
  const canScrollLeft = scrollX > 4;
  const canScrollRight = scrollX < maxScrollX - 4;

  return (
    <View style={styles.wrap} onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={[
          { paddingHorizontal: layout.featuredCardSidePadding },
          contentContainerStyle,
        ]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(width) => setContentWidth(width)}
      >
        {children}
      </ScrollView>
      {canScrollLeft ? (
        <Pressable
          onPress={() => scrollByStep(-1)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.arrowButton,
            styles.arrowLeft,
            shadow.raised,
            { backgroundColor: theme.background, opacity: pressed ? opacity.pressed : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
      ) : null}
      {canScrollRight ? (
        <Pressable
          onPress={() => scrollByStep(1)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.arrowButton,
            styles.arrowRight,
            shadow.raised,
            { backgroundColor: theme.background, opacity: pressed ? opacity.pressed : 1 },
          ]}
        >
          <Ionicons name="chevron-forward" size={18} color={theme.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  arrowButton: {
    position: "absolute",
    top: "50%",
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowLeft: {
    left: spacing.xs,
  },
  arrowRight: {
    right: spacing.xs,
  },
});
