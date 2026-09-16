/**
 * 사용자가 선택한 통화(화면 표시 단위)의 전역 상태 (Zustand).
 *
 * [2026-09-16 버그 수정 — 확정-결정사항 1] 이 스토어는 **메모리만** 쓰고 있었다.
 * MY에서 VND로 바꿔도 앱을 껐다 켜면 USD로 돌아갔다(불일치-목록 3①). 2026-09-09
 * 주석에 "영구 저장은 별도 Phase"라고 적힌 뒤 그 Phase가 오지 않았다.
 *
 * 두 곳에 저장한다 — 언어(useLocaleStore)와 같은 구조다:
 *   기기(AsyncStorage) : 비로그인에서도 유지된다. 이것이 항상 쓰이는 값이다.
 *   서버(profiles)     : 로그인 사용자만. 기기를 바꿔도 따라온다.
 *
 * 기본값을 USD → **VND**로 바꿨다(사용자 결정). 베트남 시장 앱이다.
 *
 * 서버 값이 NULL이면 "아직 고르지 않음"이므로 기기 값을 유지한다 — 열 기본값이었던
 * 'USD'를 사용자의 선택으로 착각하지 않기 위해 20260921000000에서 NULL로 비웠다.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { getMyPreferences, saveMyPreferences } from "@/services/profile";

export const SUPPORTED_CURRENCIES = ["VND", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** [2026-09-16 사용자 결정] 베트남 시장 앱이므로 VND가 기본이다. */
export const DEFAULT_CURRENCY: Currency = "VND";

const CURRENCY_STORAGE_KEY = "viets.currency";

function isSupported(value: string): value is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

type CurrencyState = {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  /** 앱 시작 시 기기 저장값을 읽어 온다(app/_layout.tsx에서 호출). */
  hydrateFromDevice: () => Promise<void>;
  /**
   * 로그인 뒤 서버 값을 반영한다(app/_layout.tsx에서 호출).
   * 서버가 비어 있으면 지금 기기 값을 서버에 올린다 — 다음 기기에서 따라오도록.
   */
  syncWithServer: () => Promise<void>;
};

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  currency: DEFAULT_CURRENCY,

  setCurrency: (currency) => {
    set({ currency });
    // 저장 실패가 전환 자체를 막지는 않는다 — 이번 실행에서는 이미 바뀌었다.
    void AsyncStorage.setItem(CURRENCY_STORAGE_KEY, currency).catch((err) => {
      const message = err instanceof Error ? err.message : "unknown-error";
      console.warn("[useCurrencyStore] 통화 저장 실패:", message);
    });
    void saveMyPreferences({ currency });
  },

  hydrateFromDevice: async () => {
    try {
      const stored = await AsyncStorage.getItem(CURRENCY_STORAGE_KEY);
      if (stored && isSupported(stored)) {
        set({ currency: stored });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown-error";
      console.warn("[useCurrencyStore] 저장된 통화 읽기 실패:", message);
    }
  },

  syncWithServer: async () => {
    const { currency } = await getMyPreferences();
    if (currency && isSupported(currency)) {
      set({ currency });
      // 서버 값을 기기에도 남긴다 — 다음 실행은 로그인 전에도 이 값으로 뜬다.
      void AsyncStorage.setItem(CURRENCY_STORAGE_KEY, currency).catch(() => undefined);
      return;
    }
    // 서버가 비어 있다 = 아직 고르지 않았다. 지금 기기 값을 올려 둔다.
    void saveMyPreferences({ currency: get().currency });
  },
}));
