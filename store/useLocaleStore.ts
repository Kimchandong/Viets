/**
 * 현재 선택된 언어의 전역 상태 (Zustand).
 *
 * STEP 03 범위: 메모리 상태만 관리한다. 로그인 사용자의 영구 저장(user_preferences
 * 테이블 동기화)과 비로그인 사용자의 로컬 영구 저장(AsyncStorage/SecureStore)은
 * 별도 Phase(3/10)에서 연동한다 — 아직 관련 패키지를 추가하지 않았다(I18N.md §2.4).
 */
import { create } from "zustand";
import i18n, { DEFAULT_LANGUAGE, SupportedLanguage } from "@/i18n";

type LocaleState = {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
};

export const useLocaleStore = create<LocaleState>((set) => ({
  language: DEFAULT_LANGUAGE,
  setLanguage: (language) => {
    i18n.changeLanguage(language);
    set({ language });
  },
}));
