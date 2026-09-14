/**
 * Viet's Design System — 기반 토큰
 *
 * STEP 03 (Foundation/Scaffold) 범위: 토큰 구조만 정의한다. 실제 화면 디자인은
 * 다음 단계에서 진행한다 (마스터 프롬프트 15번, ARCHITECTURE.md 참조: Simple ·
 * Elegant · Premium · Minimal, 과도한 카드/색상 지양, 큰 숫자 · 넓은 여백 ·
 * 얇은 border · 명확한 hierarchy).
 *
 * 주의: accent 색상은 DECISIONS.md D28(브랜드명/로고/Accent Color)이 아직 미정이라
 * 중립 placeholder 값을 사용한다. 브랜드 색상이 확정되면 이 값만 교체하면 되도록
 * 모든 색상은 이 파일 한 곳에서만 정의한다(하드코딩 금지).
 */
import { Dimensions, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";

export const colors = {
  light: {
    background: "#FFFFFF",
    card: "#FAFAFA",
    // [2026-09-11 사용자 지시] 홈 투자/매물 토글의 비활성 트랙 배경 — card(#FAFAFA)
    // 보다 한 단계 짙은 회색이라 활성 pill이 더 또렷하게 떠 보인다.
    surfaceMuted: "#EEEEEE",
    text: "#111111",
    secondaryText: "#6B6B6B",
    border: "#E5E5E5",
    // placeholder — D28 확정 후 교체
    accent: "#2F3C7E",
    // 사용자 요청(2026-09-09): 투자상품 모집률 progress bar 그라데이션의 밝은 쪽
    // 끝(모집률 0% 지점) 색상 — accent(진한 남색)보다 밝은 하늘색.
    accentLight: "#7FB3F0",
    danger: "#D64545",
    success: "#2E7D32",
    // [STEP: 2026-09-09-6] 사용자 요청 — 매물 카드의 예상수익률 숫자를 주황색으로.
    warning: "#F2994A",
    // accent/danger 위에 올라가는 텍스트/아이콘 색상 — accent 자체가 placeholder이므로 이 값도 D28 확정 시 함께 재검토
    onAccent: "#FFFFFF",
    // 모달 backdrop 등 스크림 — light/dark 공통으로 동일 값 사용(관례적 패턴)
    overlay: "rgba(0, 0, 0, 0.5)",
    // outline/ghost variant 등 투명 배경 — light/dark 공통 값이지만 컴포넌트에서 리터럴 "transparent"를
    // 직접 쓰지 않고 이 토큰을 통하도록 한다(색상값은 이 파일 한 곳에서만 정의 원칙, §STEP 03 주석 참조)
    surfaceTransparent: "transparent",
  },
  dark: {
    background: "#0B0B0C",
    card: "#161618",
    // light의 surfaceMuted와 같은 역할(카드보다 한 단계 눈에 띄는 중립 면).
    surfaceMuted: "#202023",
    text: "#F5F5F5",
    secondaryText: "#A0A0A0",
    border: "#2A2A2C",
    // placeholder — D28 확정 후 교체
    accent: "#6B7FE0",
    accentLight: "#9CC4F5",
    danger: "#E57373",
    success: "#66BB6A",
    warning: "#F5A962",
    onAccent: "#FFFFFF",
    overlay: "rgba(0, 0, 0, 0.5)",
    surfaceTransparent: "transparent",
  },
} as const;

// STEP 4-16 (2026-09-08) — 화면 폭 기반 반응형 Typography를 "연속 스케일"로 전면
// 교체한다. 이전 방식(STEP 4-12~4-12-2)은 폭을 NARROW(<360)/NORMAL(360~599)/
// WIDE(≥600) 3구간으로만 나눴는데, 실제 스마트폰 대부분(360~430dp)이 전부
// NORMAL 한 구간에 묶여 스케일이 항상 정확히 1이었다 — 그 결과 저가폰(360dp)과
// 대화면폰(430dp)이 완전히 동일한 글자 크기로 보였다. 사용자 피드백(2026-09-09
// 재접수, "해상도가 클 경우와 작을때 모두 동일한 글자로 노출되니 지저분해
// 보임")이 정확히 이 사각지대를 지적한 것이라, 이번에는 3개의 이산 구간이 아니라
// 화면 폭 전체 스펙트럼에서 연속적으로 변하는 함수로 바꾼다.
//
// 방향도 함께 바꿨다: STEP 4-12-1은 "넓은 화면일수록 오히려 줄인다"는 방향이었지만,
// 같은 이슈가 STEP 4-12/4-12-1/4-12-2에 걸쳐 반복 재접수됐다는 것은 그 방향이
// 사용자가 기대하는 "반응형(디바이스에 맞게 조정)"과 어긋났다는 신호로 판단했다.
// 이번 STEP부터는 업계에서 가장 흔히 쓰이는 표준 패턴(모바일 UI 라이브러리의
// moderateScale류)을 따라 "기준 폭보다 넓으면 키우고 좁으면 줄이는" 통상적인
// 비례 스케일을 쓴다 — Galaxy Fold를 접었을 때(약 280dp)는 더 작게, 펼쳤을 때
// (약 600dp 이상)는 더 크게 보이는 것이 이제 기대 동작이다.
//
// Dimensions.get("window")는 앱이 처음 로드되는 시점의 화면 폭을 기준으로 딱 한 번만
// 읽는다 — textStyles가 여러 화면(Home/Property/Invest/AI/My/Login 등)에 정적
// 객체로 import되어 쓰이는 기존 구조를 바꾸지 않기 위한 최소 변경이다. Galaxy
// Fold를 접고 펼치는 실시간 전환까지 반영하려면 useWindowDimensions 기반 hook으로
// textStyles 자체를 재구성해야 하는데, 이는 이 파일 하나가 아니라 textStyles를
// 쓰는 모든 화면/컴포넌트를 함께 고쳐야 하는 훨씬 큰 리팩터링이라 이번 STEP
// 범위 밖으로 두고 별도 항목으로 보고한다. 앱을 껐다 켜거나(폴드를 특정 상태로
// 고정한 채) 재시작하면 그 시점의 폭 기준으로 새로 계산된다.
const { width: SCREEN_WIDTH } = Dimensions.get("window");
// 375dp — iOS/Android를 통틀어 모바일 UI 목업에서 가장 흔히 쓰이는 기준 폭
// (예: iPhone 13/14 mini~SE 계열, Figma 모바일 프레임 기본값). 특정 기기 모델을
// 겨냥한 값이 아니라 "일반적인 스마트폰 디자인 기준선"으로 채택했다.
const BASELINE_WIDTH = 375;
const RAW_WIDTH_RATIO = SCREEN_WIDTH / BASELINE_WIDTH;
// 아주 좁은 화면(Fold 커버 스크린 등, ~280dp)과 아주 넓은 화면(Fold 펼친 화면·
// 태블릿급, ~600dp 이상)에서 스케일이 끝없이 작아지거나 커지지 않도록 비율 자체를
// 먼저 clamp한다. 0.75~1.4 범위는 위 두 극단(280/375≈0.75, 525/375=1.4)을 감싸는
// 값으로, 이 범위를 넘는 화면에서도 그 이상 비례하지 않고 최댓값/최솟값에서
// 멈춘다(태블릿에서 글자가 지나치게 커지는 것을 방지).
const MIN_WIDTH_RATIO = 0.75;
const MAX_WIDTH_RATIO = 1.4;

function clampRatio(raw: number): number {
  return Math.min(MAX_WIDTH_RATIO, Math.max(MIN_WIDTH_RATIO, raw));
}

/**
 * [2026-09-12 사용자 지시] 폭 비율을 **가변**으로 바꾼다.
 *
 * 예전에는 const였다 — 앱이 처음 뜰 때의 폭으로 영원히 고정되어, 폴더블을 접었다 펴도
 * 앱을 완전히 종료했다 다시 켜기 전까지 글자가 그대로였다. 이제 refreshTypography()가
 * 이 값을 바꾸고 textStyles를 제자리에서 갱신한다.
 */
let widthRatio = clampRatio(RAW_WIDTH_RATIO);

/**
 * 화면 폭 비율(CLAMPED_WIDTH_RATIO)을 `factor` 비율만큼만 크기에 반영하는 완만한
 * (moderate) 스케일 함수. 폭 차이를 그대로 곱하면(factor=1) 태블릿급 화면에서
 * 제목이 과도하게 커지고 작은 화면에서는 본문까지 읽기 힘들 만큼 작아지므로,
 * 계층별로 다른 factor로 감쇠한다:
 * - TITLE(제목·큰 숫자): factor 0.5 — 화면 크기 변화가 눈에 띄게 반영되어야 하는
 *   계층이라 상대적으로 크게 반응한다.
 * - BODY(본문·카드제목·버튼·가격): factor 0.22 — "지나치게 작아지거나 커지면
 *   안 되는" 정보 전달 핵심 텍스트라 아주 소폭만 반응한다.
 * - SMALL(caption·배지 숫자): factor 0.18 — 이미 가장 작은 계층이라 가독성 하한을
 *   지키기 위해 BODY보다도 더 소폭만 반응한다.
 */
function moderateScale(base: number, factor: number): number {
  const scaled = base * (1 + (widthRatio - 1) * factor);
  return Math.round(scaled);
}

/**
 * 계층별 감쇠 계수 — 화면 안에서 직접 크기를 정해야 할 때 쓴다(배지 숫자처럼
 * textStyles의 어느 계층에도 맞지 않는 것).
 *
 * 하드코딩한 `fontSize: 10` 대신 `scaleFont(10, FONT_FACTOR.SMALL)`을 쓰면 그 숫자도
 * 화면 폭을 따라간다. 예전에는 앱 곳곳에 28개의 맨 숫자가 흩어져 있었고, 그것들만
 * 어떤 기기에서든 같은 크기로 남아 있었다.
 */
export const FONT_FACTOR = {
  /** 제목·큰 숫자 */
  TITLE: 0.5,
  /** 본문·카드제목·버튼·가격 */
  BODY: 0.22,
  /** 캡션·배지 숫자 */
  SMALL: 0.18,
} as const;

export function scaleFont(base: number, factor: number = FONT_FACTOR.SMALL): number {
  return moderateScale(base, factor);
}

export type ColorScheme = keyof typeof colors;
/**
 * light/dark 색상 객체의 "형태(shape)"만 나타내는 타입 — 각 색상값을 `as const`가 만드는
 * literal 타입(예: "#FFFFFF") 그대로 두면 light 전용/dark 전용 타입이 서로 호환되지 않는다
 * (TS2345: dark의 "#0B0B0C"가 light의 "#FFFFFF" 타입에 대입 불가). 그래서 각 값을 일반
 * string으로 widen한 매핑 타입을 사용한다 — colors.light/colors.dark 어느 쪽이든 이 타입에
 * 대입 가능해진다. colors 객체 자체나 실제 색상값은 전혀 변경하지 않는다.
 */
export type ThemeColors = { [K in keyof typeof colors.light]: string };

export const typography = {
  fontFamily: {
    regular: undefined, // 시스템 기본 폰트 사용 (브랜드 폰트 확정 시 교체)
    bold: undefined,
  },
  /**
   * STEP 4-12: PC 화면을 그대로 축소한 듯한 크기를 실제 스마트폰 앱 UI 기준으로
   * 낮췄다(예: screenTitle 24→20, sectionTitle 20→17, body 16→15, caption 12→11).
   * 계층 간 상대적 비율은 유지하면서 전체적으로 한 단계씩 축소해 "글자가 너무 큼/
   * 화면 밖으로 나감/카드·버튼·탭 라벨 잘림" 문제를 해결했다. 이 표만 바꾸면
   * textStyles를 통해 앱 전체에 일괄 반영된다(화면별 개별 fontSize 하드코딩 없음).
   *
   * 아래 값들은 위 STEP 4-12에서 정한 크기를 "기준값(base, 375dp 화면 기준)"으로
   * 두고, moderateScale()로 실제 화면 폭에 맞춰 연속적으로 조정한 결과다(STEP
   * 4-16). 375dp 화면(대부분의 표준 스마트폰)에서는 STEP 4-12 값과 정확히
   * 동일하다.
   */
  size: {
    // caption/Bottom Tab label의 "가장 작은 계층" 기준값. Bottom Tab label(navLabel)은
    // 5개 탭 라벨이 고정폭 안에 들어가야 해서 이 tier 자체는 의도적으로 스케일을
    // 적용하지 않는다(아래 textStyles.navLabel 참고) — caption은 이 값에 SMALL
    // factor를 별도로 곱해서 쓴다(아래 textStyles.caption 참고).
    xs: 11,
    sm: moderateScale(13, 0.22),
    // STEP 4-16-2(2026-09-08) 사용자 요청 — body/cardTitle/buttonLabel/price/
    // sectionTitle 기준값을 15→14로 축소.
    md: moderateScale(14, 0.22), // body/cardTitle/buttonLabel/가격 — 정보 전달 핵심 텍스트라 소폭만 반응
    lg: moderateScale(17, 0.5),
    // STEP 4-16-2 사용자 요청 — screenTitle 기준값을 20→18로 축소.
    xl: moderateScale(18, 0.5),
    xxl: moderateScale(26, 0.5),
    // STEP 4-16-2 사용자 요청 — statValue 기준값을 34→30으로 축소.
    display: moderateScale(30, 0.5), // 큰 숫자(수익률, 자산총액 등) 강조용
    // STEP 4-16 신규 — 매물 가격/투자 예상수익률처럼 statValue(display)보다는
    // 작지만 일반 본문보다는 훨씬 강조되는 "히어로 숫자" 전용 크기. property-detail/
    // invest-detail에서 각자 다른 하드코딩 숫자(28)를 쓰던 것을 이 토큰 하나로
    // 통일한다(§ textStyles.heroValue). STEP 4-16-2 사용자 요청 — 기준값을 28→24로 축소.
    heroValue: moderateScale(24, 0.5),
    // STEP 4-16 신규 — 알림 배지처럼 아주 작은 숫자 전용 크기. home.tsx의
    // notificationBadgeText가 쓰던 하드코딩 숫자(9)를 이 토큰으로 대체한다.
    badge: moderateScale(9, 0.18),
  },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
} as const;

/**
 * 의미 기반 타이포그래피 계층 — STEP 4-9B(전체 UX/UI 레이아웃 기반).
 * 화면마다 개별적으로 fontSize/fontWeight를 고르지 않고, 모든 화면(Home/Property/
 * Invest/AI/My/Login/Register)이 이 스케일만 사용하도록 강제한다. 기존 typography
 * 토큰(size/weight)을 조합만 할 뿐 새 색상/새 크기 값은 추가하지 않는다.
 *
 * price는 PropertyCard/InvestmentCard의 가격·예상 수익률 텍스트가 기존에는
 * body + 인라인 fontWeight override로 표현되던 것을 의미가 분명한 전용 키로
 * 분리한 것이다(fontSize는 body와 동일한 md tier를 그대로 쓴다 — price만 body보다
 * 더 줄이면 이 코드베이스에서는 cardTitle/price가 body보다 작아져 위계가
 * 역전되므로, 크기는 공유하고 fontWeight만 bold로 구분하는 기존 패턴을 그대로
 * 따른다).
 */
/**
 * 각 계층의 **기준값과 감쇠 계수**. textStyles는 이 표에서 만들어지고,
 * refreshTypography()도 이 표를 다시 읽어 크기를 고쳐 쓴다.
 *
 * 예전에는 textStyles가 typography.size.*(이미 계산이 끝난 상수)를 조합해 만들어졌다.
 * 그래서 화면 폭이 바뀌어도 다시 계산할 방법이 없었다 — 기준값이 어디에도 남아 있지
 * 않았기 때문이다. 기준값을 표로 남겨 두면 몇 번이고 다시 계산할 수 있다.
 */
const TYPE_SCALE = {
  screenTitle: { base: 18, factor: FONT_FACTOR.TITLE, weight: typography.weight.bold },
  // [2026-09-12 사용자 지시] 섹션 타이틀 한 치수 축소(16 → 15).
  //
  // 그동안 이 값을 고쳐도 화면이 바뀌지 않았던 이유: components/SectionHeader.tsx가
  // `fontSize: typography.size.lg`(17)로 이 토큰을 **덮어쓰고** 있었다.
  //
  // [2026-09-14 웹 검증] 그 덮어쓰기를 없앤 뒤 실제로 재 보니 여전히 16px이었다.
  // 덮어쓰기만 걷어내고 base는 16 그대로 두었던 것이다 — base가 곧 기준폭(375dp)에서
  // 그려지는 픽셀 값이므로, 15px로 보이려면 base 자체가 15여야 한다.
  sectionTitle: { base: 15, factor: FONT_FACTOR.TITLE, weight: typography.weight.semibold },
  cardTitle: { base: 14, factor: FONT_FACTOR.BODY, weight: typography.weight.semibold },
  body: { base: 14, factor: FONT_FACTOR.BODY, weight: typography.weight.regular },
  bodySmall: { base: 13, factor: FONT_FACTOR.BODY, weight: typography.weight.regular },
  caption: { base: 11, factor: FONT_FACTOR.SMALL, weight: typography.weight.regular },
  buttonLabel: { base: 14, factor: FONT_FACTOR.BODY, weight: typography.weight.semibold },
  // 하단 탭 라벨 — 5개 라벨이 고정폭 탭 바 안에 들어가야 해서 폭에 반응시키지 않는다.
  navLabel: { base: 11, factor: 0, weight: typography.weight.medium },
  statValue: { base: 30, factor: FONT_FACTOR.TITLE, weight: typography.weight.bold },
  // price는 body와 같은 크기, bold로만 구분한다(크기까지 줄이면 위계가 역전된다).
  price: { base: 14, factor: FONT_FACTOR.BODY, weight: typography.weight.bold },
  heroValue: { base: 24, factor: FONT_FACTOR.TITLE, weight: typography.weight.bold },
} as const;

type TypeKey = keyof typeof TYPE_SCALE;

/**
 * 의미 기반 타이포그래피 계층 — 화면마다 fontSize/fontWeight를 고르지 않고 모든
 * 화면이 이 스케일만 쓴다.
 *
 * 이 객체는 **제자리에서 갱신된다**(refreshTypography). 화면들이 대부분
 * `style={[textStyles.body, { ... }]}` 처럼 인라인 배열로 읽기 때문에, 값이 바뀌고
 * 다시 그려지면 새 크기가 그대로 반영된다.
 */
export const textStyles = Object.fromEntries(
  (Object.keys(TYPE_SCALE) as TypeKey[]).map((key) => [
    key,
    {
      fontSize: moderateScale(TYPE_SCALE[key].base, TYPE_SCALE[key].factor),
      fontWeight: TYPE_SCALE[key].weight,
    },
  ]),
) as { [K in TypeKey]: { fontSize: number; fontWeight: (typeof TYPE_SCALE)[K]["weight"] } };

/**
 * 화면 폭이 바뀌었을 때 부른다(app/_layout.tsx가 useWindowDimensions로 감시한다).
 *
 * 실제로 비율이 달라졌을 때만 true를 돌려준다 — 호출한 쪽은 그때만 화면을 다시
 * 그리면 된다. 키보드가 올라오는 등의 이유로 폭이 아닌 높이만 바뀌는 일이 잦은데,
 * 그때마다 전체를 다시 그리면 입력 중인 화면이 눈에 띄게 끊긴다.
 *
 * 한계: StyleSheet.create()로 만든 스타일 안에 박아 둔 크기는 모듈이 처음 읽힐 때
 * 복사되므로 여기서 바꿀 수 없다. 그래서 화면들의 하드코딩된 fontSize를 걷어내
 * scaleFont()/textStyles로 옮겼다 — 남아 있으면 그 글자만 옛 크기로 굳는다.
 */
export function refreshTypography(width: number): boolean {
  const next = clampRatio(width / BASELINE_WIDTH);
  if (Math.abs(next - widthRatio) < 0.001) return false;

  widthRatio = next;
  for (const key of Object.keys(TYPE_SCALE) as TypeKey[]) {
    textStyles[key].fontSize = moderateScale(TYPE_SCALE[key].base, TYPE_SCALE[key].factor);
  }
  refreshLayout(width);
  rebuildScaledStyles();
  return true;
}

// ---------------------------------------------------------------------------
// 화면 스타일시트 재생성
// ---------------------------------------------------------------------------
//
// [2026-09-12 사용자 지시] 폭이 바뀌면 **화면 스타일까지** 새 크기를 쓰게 한다.
//
// 문제: StyleSheet.create()는 모듈이 처음 읽힐 때 딱 한 번 실행되고, 그때의 숫자를
// 그대로 복사해 둔다. 그래서 textStyles를 아무리 고쳐도 `const styles =
// StyleSheet.create({ rankText: { fontSize: scaleFont(12) } })` 같은 값은 앱이 처음
// 뜰 때의 폭에 영원히 묶인다 — 폴더블을 펴도 그 글자만 옛 크기로 남는다.
//
// 대안으로 화면마다 useMemo(() => StyleSheet.create(...), [폭])로 바꾸는 방법이
// 있지만, 그러려면 모든 화면의 스타일 정의를 컴포넌트 안으로 옮겨야 한다(수십 개
// 파일의 구조 변경 = 그만큼의 회귀 위험).
//
// 여기서는 **만드는 방법(팩토리)을 기억해 둔다**. 폭이 바뀌면 팩토리를 다시 돌려
// 새 숫자를 얻고, 원래 객체에 덮어쓴다. 객체의 정체(참조)는 그대로이므로 화면 쪽
// 코드는 한 글자도 몰라도 된다 — 호출부는 StyleSheet.create를 createScaledStyles로
// 바꾸는 한 줄이 전부다.
//
// 반환값에 StyleSheet.create를 씌우지 않는 이유: RN은 평범한 객체도 style로 그대로
// 받고(등록은 선택), __DEV__에서는 create()가 결과를 얼려 버려 덮어쓸 수 없게 된다.

/**
 * StyleSheet.create가 받는 것과 같은 모양.
 *
 * 이 타입을 그대로 따라가는 것이 중요하다. 처음에는 제약을 Record<string, unknown>으로
 * 뒀는데, 그러면 `flexDirection: "row"` 같은 값이 리터럴 "row"가 아니라 넓은 string으로
 * 추론되어 RN의 ViewStyle에 들어가지 못한다(같은 스타일이 StyleSheet.create에서는
 * 통과하는데 여기서는 135개 타입 오류가 났다). 제네릭을 StyleSheet.create와 똑같이
 * 쓰면 추론도 똑같아진다.
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

type MutableStyleSheet = Record<string, Record<string, unknown>>;

type Registered = { factory: () => MutableStyleSheet; target: MutableStyleSheet };

const scaledStyleRegistry: Registered[] = [];

/**
 * 폭에 반응해야 하는 화면 스타일은 StyleSheet.create 대신 이걸로 만든다.
 *
 *   const styles = createScaledStyles(() => ({ title: { fontSize: scaleFont(15) } }));
 *
 * 쓰는 쪽은 평소와 똑같이 styles.title을 넘기면 된다.
 */
// 제네릭은 react-native의 StyleSheet.create와 **글자 그대로 같아야 한다**.
// any를 never로 바꾸면 추론이 무너져 styles.xxx가 전부 "존재하지 않는 속성"이 된다.
export function createScaledStyles<T extends NamedStyles<T> | NamedStyles<any>>(
  factory: () => T & NamedStyles<any>,
): T {
  const target = factory();
  scaledStyleRegistry.push({
    factory: factory as unknown as () => MutableStyleSheet,
    target: target as unknown as MutableStyleSheet,
  });
  return target;
}

function rebuildScaledStyles(): void {
  for (const { factory, target } of scaledStyleRegistry) {
    const fresh = factory();
    for (const key of Object.keys(fresh)) {
      const current = target[key];
      if (!current) {
        target[key] = fresh[key];
        continue;
      }
      // 제자리에서 덮어쓴다 — 참조가 바뀌면 이미 그 객체를 들고 있는 화면이 옛 값을 본다.
      for (const prop of Object.keys(current)) delete current[prop];
      Object.assign(current, fresh[key]);
    }
  }
}

/**
 * STEP 4-16-2(2026-09-08) 사용자 요청 — 홈 화면 "추천 매물"/"추천 투자" 가로
 * 스크롤 캐러셀의 카드 1개 폭을 화면 폭의 95%로 맞춘다. 기존에는 PropertyCard
 * 220px / InvestmentCard 260px로 화면 폭과 무관한 고정값이었다 — 작은 화면에서는
 * 카드가 상대적으로 커 보이고 큰 화면에서는 여러 장이 어중간하게 걸쳐 보이는 등
 * 기기마다 비율이 달라 "지저분해 보임" 피드백의 또 다른 원인이었다. 화면 폭의
 * 95%로 맞추면 카드 1장이 거의 꽉 차게 보이면서 다음 카드가 살짝 걸쳐 스와이프를
 * 유도하는 표준적인 캐러셀 형태가 되고, 기기 폭이 달라져도 항상 동일한 비율을
 * 유지한다.
 */
/**
 * 화면 폭에서 직접 나오는 치수.
 *
 * [2026-09-12] 글자와 같은 이유로 **가변**이다. 카드 폭이 처음 폭에 묶여 있으면
 * 폴더블을 접었을 때 캐러셀 카드가 화면 밖으로 삐져나간다 — 글자만 줄어들고 카드가
 * 그대로면 오히려 더 어색하다.
 */
export const layout = {
  featuredCardWidth: Math.round(SCREEN_WIDTH * 0.95),
  // [STEP: 2026-09-09-6] 사용자 요청 — 캐러셀(추천매물/추천투자) 첫 카드를 화면
  // 가운데 정렬하기 위한 좌우 여백. featuredCardWidth(화면폭의 95%)를 뺀 나머지
  // 5%를 좌우 절반씩 나눈 값 — 캐러셀 contentContainerStyle의 paddingHorizontal로
  // 쓰면 스크롤 맨 앞/맨 뒤에서 카드가 가운데에 오고 옆 카드가 살짝 peek되어 보인다.
  featuredCardSidePadding: Math.round((SCREEN_WIDTH - Math.round(SCREEN_WIDTH * 0.95)) / 2),
};

function refreshLayout(width: number): void {
  layout.featuredCardWidth = Math.round(width * 0.95);
  layout.featuredCardSidePadding = Math.round((width - Math.round(width * 0.95)) / 2);
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  // 사용자 요청(2026-08-31 UI 피드백) — 각 탭 화면(Home/Property/Invest/AI/My)의
  // 최상단 콘텐츠 컨테이너와 화면 좌우 가장자리 사이 여백 전용 값. 위 일반 간격
  // 스케일(xs~xxl)과는 별개로, 좌우 여백만 10px로 지정해달라는 명시적 요청을
  // 반영한 값이라 별도 키로 둔다. 5개 탭 화면 전체에 동일 적용한다(세로 여백/
  // gap은 기존 spacing.lg 등 그대로 유지 — 요청은 "좌,우 간격"에 한정됨).
  screenPaddingX: 10,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 9999,
} as const;

export const shadow = {
  // 얇고 절제된 그림자 — "과도한 카드" 지양 원칙 반영
  card: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  // Toast/Modal처럼 다른 콘텐츠 위에 떠 있는 요소용 — card보다 살짝 강조
  raised: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

/**
 * 상태 표현용 opacity 토큰 — 색상이 아니므로 light/dark 공통.
 * disabled/loading 상태를 새 색상 추가 없이 기존 색상에 곱해 표현한다.
 */
export const opacity = {
  disabled: 0.4,
  pressed: 0.7,
} as const;
