/**
 * 숫자/단위 텍스트 포맷 관련 순수 유틸.
 *
 * [STEP: 2026-09-09] "9.2%/năm"처럼 숫자(수익률)와 단위 접미사("/năm")가 하나의
 * 문자열로 합쳐져 mockData에 들어있는 값을, 화면에서 서로 다른 굵기/크기로
 * 나눠 그리기 위해 두 부분으로 쪼갠다 — 사용자 요청: "/năm" 부분은 bold를
 * 없애고 숫자보다 작게 표시해 단위 접미사처럼 보이게 한다(InvestmentCard.tsx,
 * app/invest-detail/[id].tsx 두 곳에서 공용으로 사용).
 *
 * [STEP: 2026-09-09 추가] 사용자 요청 — "tỷ/năm/tháng 글자는 전부 bold 없앰".
 * "/년"(투자 수익률, 임대료 "/tháng")처럼 "/"로 붙는 단위뿐 아니라, "4.2 tỷ"처럼
 * 공백 뒤에 "tỷ"가 붙는 매매가 표기(슬래시 없음)도 같은 함수로 분리할 수 있도록
 * " tỷ" 케이스를 추가했다 — 기존 호출부(InvestmentCard.tsx 등, "/"만 있는 문자열)의
 * 동작은 전혀 바뀌지 않는다(그 문자열들엔 " tỷ"가 없으므로 slashIndex 분기가 먼저
 * 걸린다).
 */
export function splitYieldText(text: string): { rate: string; suffix: string } {
  const slashIndex = text.indexOf("/");
  if (slashIndex !== -1) {
    // [STEP: 2026-09-09-6] 사용자 요청 — "18,000k/tháng"처럼 붙어있던 표기를
    // "18,000k / tháng"으로, 금액과 "/" 사이 · "/"와 단위 사이 각각 한 칸씩 띄운다.
    return { rate: text.slice(0, slashIndex), suffix: ` / ${text.slice(slashIndex + 1)}` };
  }
  const tyIndex = text.indexOf(" tỷ");
  if (tyIndex !== -1) {
    return { rate: text.slice(0, tyIndex), suffix: text.slice(tyIndex) };
  }
  return { rate: text, suffix: "" };
}


/**
 * 사용자 요청(2026-09-09): 베트남 금액 표기를 "N triệu VNĐ" 같은 단어식 표기 대신
 * "N,000k"(천 단위 + k) 형태로 통일한다. 억 단위(tỷ)는 "N tỷ"로 유지하기로
 * 확정(사용자 확인) — 1억(1,000,000,000) 이상 값에는 k 표기를 적용하지 않는다.
 * 이후 추가 요청(2026-09-09): 'VNĐ' 단위 문자열 자체를 전체 금액 표기에서 삭제.
 * app/invest-detail/[id].tsx의 raisedAmountVnd/targetAmountVnd(원시 VND 숫자)를
 * 표시할 때 사용한다.
 */
export function formatVndAmount(amountVnd: number): string {
  // 사용자 요청(2026-09-09): 금액 표기에서 "VNĐ" 단위 문자열 자체를 없앤다
  // (tỷ/k 접미사만으로 통화 단위를 표현 — VNĐ 화면 전체 표기 정책).
  if (amountVnd >= 1_000_000_000) {
    const value = amountVnd / 1_000_000_000;
    return `${trimTrailingZero(value)} tỷ`;
  }
  if (amountVnd >= 1_000_000) {
    const thousands = Math.round(amountVnd / 1000);
    return `${thousands.toLocaleString("en-US")}k`;
  }
  return amountVnd.toLocaleString("vi-VN");
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}


/**
 * [STEP: 2026-09-09-6] 사용자 요청 — 모집률 progress bar 그라데이션이 웹에서는
 * CSS linear-gradient로 보였지만, 네이티브(Android/iOS)에는 RN 표준 gradient API가
 * 없고 expo-linear-gradient 같은 네이티브 그라데이션 패키지는 이 프로젝트 환경에서
 * 설치할 수 없어(네트워크 제약, STEP4-14 등 기존 기록 참고) 실기기에서는 단색으로만
 * 보였다. 순수 JS/View만으로 그라데이션처럼 보이게 하기 위해, 두 색상 사이를 N단계
 * 색상으로 보간해 인접한 얇은 세로 블록들을 나란히 이어붙인다(각 블록은 flex:1인
 * 일반 View 배경색일 뿐이라 네이티브/웹 모두 100% 동일하게 렌더링된다).
 */
export function interpolateHexColor(fromHex: string, toHex: string, t: number): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r, g, b };
}

/** fromHex→toHex를 steps단계로 균등 보간한 색상 배열 — 그라데이션 블록 렌더링용. */
export function buildGradientSteps(fromHex: string, toHex: string, steps: number): string[] {
  return Array.from({ length: steps }, (_, i) => interpolateHexColor(fromHex, toHex, steps === 1 ? 0 : i / (steps - 1)));
}

/**
 * [STEP: 2026-09-09-6] 사용자 요청 — 매물/투자상품 상세설명(Content)에 다국어
 * 변환을 적용해 노출한다. i18n/index.ts 주석대로 UI Translation(i18n/locales/*.json)과
 * Content Translation은 섞지 않으므로, mockData.ts의 각 설명 필드 자체를
 * "언어코드 → 번역문" 맵으로 두고(예: property.description.ko), 이 함수가 현재
 * 앱 언어에 맞는 문자열을 골라준다. 맵에 현재 언어가 없으면 vi(원문) → 맵의 첫
 * 값 순서로 안전하게 폴백한다.
 */
export function localizedText(map: Partial<Record<string, string>>, lang: string): string {
  return map[lang] ?? map.vi ?? Object.values(map)[0] ?? "";
}

