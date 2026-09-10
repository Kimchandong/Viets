import { useEffect, useRef } from "react";
import { Animated } from "react-native";

/**
 * [STEP: 2026-09-09-24] 사용자 요청 — "모집중" 배지 배경을 현재 파란색(accent)과
 * 조금 더 밝은 파란색(accentLight) 사이에서 깜박이는(pulsing) 애니메이션으로.
 * 두 곳(InvestmentCard.tsx 썸네일 배지 / invest-detail 상세 배지)에서 동일한
 * 로직을 쓰므로 공용 hook으로 뺀다. backgroundColor는 useNativeDriver를 지원하지
 * 않아(색상 보간은 JS 드라이버 전용) false로 둔다 — 값 하나짜리 배지 배경이라
 * 성능에 영향은 없다.
 */
export function usePulsingColor(colorA: string, colorB: string, durationMs = 900) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: durationMs, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: durationMs, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, durationMs]);

  return anim.interpolate({ inputRange: [0, 1], outputRange: [colorA, colorB] });
}
