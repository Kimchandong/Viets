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

export const colors = {
  light: {
    background: "#FFFFFF",
    card: "#FAFAFA",
    text: "#111111",
    secondaryText: "#6B6B6B",
    border: "#E5E5E5",
    // placeholder — D28 확정 후 교체
    accent: "#2F3C7E",
    danger: "#D64545",
    success: "#2E7D32",
  },
  dark: {
    background: "#0B0B0C",
    card: "#161618",
    text: "#F5F5F5",
    secondaryText: "#A0A0A0",
    border: "#2A2A2C",
    // placeholder — D28 확정 후 교체
    accent: "#6B7FE0",
    danger: "#E57373",
    success: "#66BB6A",
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ThemeColors = typeof colors.light;

export const typography = {
  fontFamily: {
    regular: undefined, // 시스템 기본 폰트 사용 (브랜드 폰트 확정 시 교체)
    bold: undefined,
  },
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
    display: 44, // 큰 숫자(수익률, 자산총액 등) 강조용
  },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
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
} as const;
