/**
 * 사용자가 선택한 통화(화면 표시 단위)의 전역 상태 (Zustand).
 *
 * [STEP: 2026-09-09] 사용자 요청 — MY > 통화 설정을 "준비 중" 토스트 대신 실제로
 * 베트남 동(VND)/미국 달러(USD) 중 선택할 수 있게 한다. store/useLocaleStore.ts와
 * 동일한 패턴(메모리 상태만 관리, 영구 저장은 별도 Phase) — 아직 이 값을 실제
 * 금액 표시(mock 가격 문자열 변환 등)에 연결하지는 않는다. 그 부분은 실제 환율
 * 데이터/백엔드 연동이 필요한 범위라 이번 STEP에서는 설정값 저장까지만 다룬다.
 */
import { create } from "zustand";

export const SUPPORTED_CURRENCIES = ["VND", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

type CurrencyState = {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
};

export const useCurrencyStore = create<CurrencyState>((set) => ({
  currency: "USD",
  setCurrency: (currency) => set({ currency }),
}));
