import { useEffect, useRef } from "react";
import { Animated, Platform, StyleProp, StyleSheet, Text, TextStyle, View } from "react-native";

export type FadeInTextSegment = {
  text: string;
  style?: StyleProp<TextStyle>;
  /**
   * [2026-09-26 사용자 지시] 이 구간의 **첫 글자** 좌측 상단 모서리에 넣을 삼각형 색.
   *
   * 로고 "BĐS & REIT"의 B는 파랑, R은 빨강을 넣는 용도다. 구간 전체가 아니라 첫
   * 글자에만 붙인다 — 구간을 한 글자("B")로 잘라 넘기면 그 글자에만 들어간다.
   *
   * 이 값을 쓰는 구간이 하나라도 있으면 cornerFontSize를 함께 넘겨야 한다.
   */
  cornerColor?: string;
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
  /**
   * cornerColor를 쓰는 글자의 **글자 크기(px)**. 삼각형의 크기와 위치를 이 값에서 계산한다.
   * 왜 스타일에서 읽지 않고 따로 받나: style은 배열·등록된 ID일 수 있어 컴포넌트가
   * 확정된 fontSize를 알아낼 방법이 없다.
   */
  cornerFontSize?: number;
};

/**
 * 글자 상자 안에서 **대문자 윗선(cap top)이 어디쯤인지**의 비율.
 *
 * 아래에서 lineHeight를 글자 크기와 같게(1em) 고정하므로 글자 상자 높이 = 글자 크기다.
 * 그 상자 안에서 대문자 윗선의 위치는 **폰트마다 다르다.** 기본 서체가 플랫폼마다
 * 다르므로(웹 Segoe UI / iOS SF / 안드로이드 Roboto) 플랫폼별로 값을 나눈다.
 *
 * 계산식: baseline = (1em - (ascent+descent))/2 + ascent, capTop = baseline - capHeight.
 *   · web     ascent 1.077 / descent 0.269 / cap 0.692 → 0.212  ← 웹 미리보기에서 실측 확인
 *   · ios     ascent 0.960 / descent 0.240 / cap 0.700 → 0.160
 *   · android ascent 0.927 / descent 0.244 / cap 0.711 → 0.132
 *
 * web 값만 실제로 재서 맞췄다. iOS·안드로이드 값은 각 기본 서체의 공개 메트릭으로
 * 계산한 것이라 **실기기 빌드에서 한 번 눈으로 확인해야 한다**(오차가 나도 1px 수준).
 *
 * 이 비율을 쓰지 않고 lineHeight를 놔두면 같은 값이 0.13~0.38em까지 벌어진다 —
 * 처음 구현에서 **삼각형이 글자 위 빈 공간에 떠 있던** 원인이 이것이었다.
 */
const CAP_TOP_RATIO = Platform.select({ web: 0.212, ios: 0.16, default: 0.132 });

/**
 * 삼각형 한 변 = 글자 크기의 이만큼.
 *
 * [2026-09-26 사용자 지시] "조금 줄여줘" — 대문자 높이(약 0.7em)의 절반(0.35em)이면
 * 글자 윗부분을 너무 많이 덮는다. 1/3 수준으로 낮춰 모서리에만 얹히게 한다.
 */
const CORNER_LEG_RATIO = 0.24;

/**
 * 삼각형을 글자 모서리에서 안쪽으로 얼마나 들일지(px).
 *
 * [2026-09-26] 사용자 지시가 두 번 바뀐 자리다: 1px 들였다가 → **다시 0으로.**
 * 글자 윗선·왼쪽 획에 딱 맞춰 붙인다. 값만 바꾸면 되도록 상수로 남겨 둔다.
 */
const CORNER_INSET = 0;

/**
 * 글자 상자의 왼쪽 끝과 **글자 획이 실제로 시작되는 지점** 사이의 여백(좌측 사이드
 * 베어링)을 글자 크기 대비 비율로 잡은 값.
 *
 * 왜 필요한가: 상자의 left=0 은 글자의 왼쪽 끝이 아니다. 웹 미리보기 실측에서
 * 26px 볼드 B·R 모두 획이 상자에서 **1px 안쪽**(≈0.04em)부터 시작했다. 이걸 빼고
 * left=1 을 주면 "글자 안으로 1px"이 아니라 "글자 왼쪽 끝에 딱 붙음"이 된다.
 *
 * 볼드 대문자 기준 근사값이다 — 글자와 서체마다 조금씩 다르지만 26px에서 1px 수준이라
 * 눈에 띄지 않는다.
 */
const LEFT_BEARING_RATIO = 0.04;

/**
 * [STEP: 2026-09-10-2] 사용자 요청 — 홈 화면 로고 글자가 왼쪽부터 한 글자씩 순서대로
 * 페이드인되는 인트로 애니메이션. 글자별로 opacity Animated.Value를 하나씩 두고
 * Animated.stagger로 순서대로 시작시킨다(opacity는 useNativeDriver 지원).
 *
 * [2026-09-26] 바깥을 <Text>에서 **가로 flex View**로 바꿨다.
 *
 * 왜: 특정 글자 모서리에 삼각형을 얹으려면 그 글자가 **자기 상자를 가져야** 한다.
 * 예전처럼 모든 글자가 한 <Text> 안의 인라인 조각이면 글자 하나의 위치·크기를 알 수
 * 없어 그 위에 무언가를 겹칠 자리가 없다. 이제 글자마다 View 한 칸을 차지한다.
 *
 * 맞바꾼 것: 글자가 각각 배치되므로 **커닝(글자쌍 간격 보정)이 사라진다.** 대문자
 * 워드마크라 눈에 띄는 차이는 거의 없지만, 본문처럼 긴 문장에 쓰면 자간이 헐거워
 * 보일 수 있다 — 이 컴포넌트는 로고 전용으로 두는 편이 좋다.
 *
 * 크기가 다른 구간("in VIETNAM")이 섞이므로 alignItems는 baseline이다 — 안 그러면
 * 작은 글자가 큰 글자의 위쪽에 붙어 뜬다. 삼각형이 붙는 글자만 lineHeight를 줄이는데,
 * baseline 정렬은 상자 높이가 아니라 밑선을 맞추므로 줄 모양은 그대로다.
 */
export function FadeInText({
  segments,
  perLetterDelayMs = 45,
  durationMs = 220,
  style,
  cornerFontSize,
}: FadeInTextProps) {
  const chars = segments.flatMap((segment) =>
    segment.text.split("").map((char, indexInSegment) => ({
      char,
      segmentStyle: segment.style,
      // 구간의 첫 글자에만 삼각형을 붙인다.
      cornerColor: indexInSegment === 0 ? segment.cornerColor : undefined,
    })),
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

  const fontSize = cornerFontSize ?? 0;
  const cornerLeg = Math.round(fontSize * CORNER_LEG_RATIO);
  // top은 반올림하지 않는다 — 0.5px 차이가 "딱 맞게"와 "살짝 뜬"을 가른다.
  const cornerTop = fontSize * (CAP_TOP_RATIO ?? 0.132) + CORNER_INSET;
  const cornerLeft = fontSize * LEFT_BEARING_RATIO + CORNER_INSET;

  return (
    <View style={styles.row}>
      {chars.map((item, index) => {
        const canDrawCorner = Boolean(item.cornerColor) && fontSize > 0;

        const letter = (
          <Animated.Text
            style={[
              style,
              item.segmentStyle,
              // 삼각형이 붙는 글자만 줄높이를 글자 크기에 맞춰 조인다.
              // 그래야 상자 = 글자가 되어 삼각형 위치를 폰트와 무관하게 계산할 수 있다.
              canDrawCorner ? { lineHeight: fontSize } : null,
              { opacity: animsRef.current[index] },
            ]}
          >
            {item.char}
          </Animated.Text>
        );

        if (!canDrawCorner) {
          return <Text key={index}>{letter}</Text>;
        }

        return (
          // overflow:"hidden"이 "글자를 벗어나지 않는다"를 보장한다 — 삼각형이 이
          // 글자 상자 밖으로 나가지 못한다.
          <View key={index} style={styles.letterBox}>
            {letter}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.corner,
                {
                  top: cornerTop,
                  left: cornerLeft,
                  opacity: animsRef.current[index],
                  borderTopWidth: cornerLeg,
                  borderRightWidth: cornerLeg,
                  borderTopColor: item.cornerColor,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    // 크기가 다른 구간이 섞이므로 밑선을 맞춘다.
    alignItems: "baseline",
  },
  letterBox: {
    position: "relative",
    overflow: "hidden",
  },
  /**
   * 좌측 상단 직각삼각형.
   *
   * width/height를 0으로 두고 테두리 두 변만 쓰는 방식이다 — 위 테두리에만 색을
   * 주고 오른쪽 테두리를 투명하게 두면, 직각이 왼쪽 위에 오고 빗변이 오른쪽 위에서
   * 왼쪽 아래로 내려오는 삼각형이 남는다. RN에 도형 그리기가 없어 쓰는 표준 방법이고
   * 별도 라이브러리가 필요 없다.
   *
   */
  corner: {
    position: "absolute",
    // top·left는 인라인으로 준다 — 글자 크기에 따라 달라지는 값이라 여기서 고정할 수 없다.
    width: 0,
    height: 0,
    borderRightColor: "transparent",
  },
});
