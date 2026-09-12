import { useEffect, useRef, useState } from "react";
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

import { colors, layout, opacity, radius, shadow } from "@/constants/theme";

export type HorizontalCardCarouselProps = {
  children: React.ReactNode;
  /** ScrollView 자체 스타일(예: 화면 좌우 bleed용 marginHorizontal) */
  style?: StyleProp<ViewStyle>;
  /** contentContainerStyle(예: 카드 간 gap) — paddingHorizontal은 이 컴포넌트가 직접 관리한다 */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** 화살표를 한 번 눌렀을 때 스크롤할 거리(대략 카드 1장 폭 + gap) */
  step: number;
  /**
   * [2026-09-11 사용자 지시] 화살표의 세로 중심(캐러셀 상단에서 px).
   *
   * 기본값(미지정)은 캐러셀 전체 높이의 50%인데, 카드가 이미지 + 제목 + 수치
   * 줄로 이뤄져 있어 그 가운데는 이미지 아래쪽에 걸린다. 화면에서 카드
   * 이미지 높이의 절반을 넘겨 "이미지 상하 가운데"에 맞춘다.
   */
  arrowCenterY?: number;
  /**
   * [2026-09-12 사용자 지시] 자동 슬라이드 간격(ms). 주면 그 간격마다 한 장씩
   * 넘어가고, 끝에 닿으면 처음으로 돌아온다. 사용자가 직접 스와이프하거나 화살표를
   * 누르면 잠시 멈춘다 — 읽는 도중에 화면이 넘어가면 불쾌하다.
   */
  autoPlayMs?: number;
};

/**
 * [STEP: 2026-09-09-6] 사용자 요청 — 홈/부동산/투자 화면의 "추천 매물"/"추천 투자상품"
 * 가로 슬라이드 캐러셀 공통 컴포넌트로 분리했다: (1) 첫 카드가 화면 가운데 오도록
 * 좌우 peek 여백(layout.featuredCardSidePadding)을 이 컴포넌트가 직접 적용하고,
 * (2) 스크롤 위치에 따라 우측/좌측에 원형 화살표 버튼을 오버레이해 클릭으로도
 * 다음/이전 카드로 이동할 수 있게 한다(스와이프도 기존처럼 그대로 동작).
 * 화살표는 더 이상 스크롤할 방향이 없을 때는 숨긴다(맨 끝에서 좌/우 각각).
 */
export function HorizontalCardCarousel({
  children,
  style,
  contentContainerStyle,
  step,
  arrowCenterY,
  autoPlayMs,
}: HorizontalCardCarouselProps) {
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

  /** 사람이 손을 댄 시각 — 이 뒤 한 주기 동안은 자동 슬라이드를 쉰다. */
  const touchedAt = useRef(0);
  function markTouched() {
    touchedAt.current = Date.now();
  }

  useEffect(() => {
    if (!autoPlayMs || autoPlayMs <= 0) return;
    // 넘길 곳이 없으면(카드 한 장) 타이머를 돌릴 이유가 없다.
    if (contentWidth <= containerWidth) return;

    const timer = setInterval(() => {
      if (Date.now() - touchedAt.current < autoPlayMs) return;

      const limit = Math.max(0, contentWidth - containerWidth);
      // 끝에 닿았으면 처음으로 — 되돌아가는 방향으로 한 장씩 물러나면 어지럽다.
      const next = scrollX >= limit - 4 ? 0 : Math.min(limit, scrollX + step);
      scrollRef.current?.scrollTo({ x: next, animated: true });
    }, autoPlayMs);

    return () => clearInterval(timer);
  }, [autoPlayMs, contentWidth, containerWidth, scrollX, step]);

  const maxScrollX = Math.max(0, contentWidth - containerWidth);
  const canScrollLeft = scrollX > 4;
  const canScrollRight = scrollX < maxScrollX - 4;

  // 지정이 없으면 기존대로 캐러셀 높이의 절반. 지정하면 그 지점이 버튼의 중심이
  // 되도록 버튼 높이의 절반만큼 끌어올린다(styles.arrowButton의 marginTop과 동일 역할).
  const arrowPosition: ViewStyle =
    arrowCenterY === undefined ? {} : { top: arrowCenterY - ARROW_SIZE / 2, marginTop: 0 };

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
        onScrollBeginDrag={markTouched}
        scrollEventThrottle={16}
        onContentSizeChange={(width) => setContentWidth(width)}
      >
        {children}
      </ScrollView>
      {canScrollLeft ? (
        <Pressable
          onPress={() => {
            markTouched();
            scrollByStep(-1);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.arrowButton,
            styles.arrowLeft,
            arrowPosition,
            shadow.raised,
            { backgroundColor: theme.background, opacity: pressed ? opacity.pressed : 1 },
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={theme.text} />
        </Pressable>
      ) : null}
      {canScrollRight ? (
        <Pressable
          onPress={() => {
            markTouched();
            scrollByStep(1);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.arrowButton,
            styles.arrowRight,
            arrowPosition,
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

/** 화살표 버튼의 지름(px). 세로 중심 계산에 쓰므로 상수로 둔다. */
const ARROW_SIZE = 36;
/**
 * [2026-09-11 사용자 지시] 화살표를 컨테이너 바깥으로 내보내는 양(px).
 *
 * 10이면 화면 가장자리에 정확히 맞닿고, 20은 그보다 10px 더 나가 버튼 일부가
 * 화면 밖으로 잘린다 — 잘리는 것을 알고 선택한 값이다.
 */
const ARROW_OUTSET = 20;

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  arrowButton: {
    position: "absolute",
    top: "50%",
    marginTop: -ARROW_SIZE / 2,
    width: ARROW_SIZE,
    height: ARROW_SIZE,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  // [2026-09-11 사용자 지시] 화살표를 좌우 바깥쪽으로 이동(총 20px).
  // 이 컨테이너는 화면 좌우 padding(spacing.screenPaddingX 10) 안쪽에 있다.
  arrowLeft: {
    left: -ARROW_OUTSET,
  },
  arrowRight: {
    right: -ARROW_OUTSET,
  },
});
