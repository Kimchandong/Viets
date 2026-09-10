import { useEffect, useRef } from "react";
import { Animated, StyleProp, Text, TextStyle } from "react-native";

export type FadeInTextSegment = {
  text: string;
  style?: StyleProp<TextStyle>;
};

export type FadeInTextProps = {
  /** 서로 다른 스타일(예: bold/regular)을 가진 구간들 — 이어 붙여 한 문구를 구성한다. */
  segments: FadeInTextSegment[];
  /** 글자마다 시작 시점을 얼마나 늦출지(ms) — 왼쪽 글자부터 순서대로 노출되는 효과. */
  perLetterDelayMs?: number;
  /** 글자 한 개가 완전히 나타나는 데 걸리는 시간(ms). */
  durationMs?: number;
  /** 전체 문구에 공통으로 적용할 스타일(폰트크기/색상 등) — 각 구간 style이 이 위에 덧씌워진다. */
  style?: StyleProp<TextStyle>;
};

/**
 * [STEP: 2026-09-10-2] 사용자 요청 — 홈 화면 로고("REIT VIET") 글자가 왼쪽부터
 * 한 글자씩 순서대로 페이드인되는 인트로 애니메이션. 글자별로 opacity Animated.Value를
 * 하나씩 두고 Animated.stagger로 순서대로 시작시킨다(opacity는 useNativeDriver
 * 지원 — usePulsingColor의 backgroundColor 보간과 달리 네이티브 드라이버로 돌려
 * 성능 영향이 없다). 다른 화면에서도 같은 효과가 필요하면 재사용할 수 있도록
 * 도메인 독립적인 공용 컴포넌트로 뺐다(hooks/usePulsingColor.ts와 동일한 원칙).
 */
export function FadeInText({ segments, perLetterDelayMs = 45, durationMs = 220, style }: FadeInTextProps) {
  const chars = segments.flatMap((segment) =>
    segment.text.split("").map((char) => ({ char, segmentStyle: segment.style })),
  );

  // 문구(segments)는 이 화면에서 고정 텍스트라 글자 수가 마운트 후 바뀌지 않는다는
  // 전제로, Animated.Value 배열을 최초 1회만 만든다.
  const animsRef = useRef(chars.map(() => new Animated.Value(0)));

  useEffect(() => {
    const animations = animsRef.current.map((anim) =>
      Animated.timing(anim, { toValue: 1, duration: durationMs, useNativeDriver: true }),
    );
    const stagger = Animated.stagger(perLetterDelayMs, animations);
    stagger.start();
    return () => stagger.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Text style={style}>
      {chars.map((item, index) => (
        <Animated.Text key={index} style={[item.segmentStyle, { opacity: animsRef.current[index] }]}>
          {item.char}
        </Animated.Text>
      ))}
    </Text>
  );
}
