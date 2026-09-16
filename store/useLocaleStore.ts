/**
 * 현재 선택된 언어의 전역 상태 (Zustand).
 *
 * [2026-09-11 버그 수정] 이전에는 초기값이 무조건 DEFAULT_LANGUAGE("en")였다.
 * i18next 자체는 디바이스 언어(예: ko)로 정상 초기화되므로, **화면은 한국어로
 * 나오는데 설정 화면의 "언어" 항목만 English로 표시되는** 불일치가 생겼다
 * (2026-09-11 실기기 QA에서 보고됨). 초기값을 디바이스 감지 결과로 바꾸고,
 * i18n 초기화가 끝난 뒤 syncFromI18n()으로 실제 적용된 언어에 한 번 더 맞춘다
 * (저장된 선택이 있으면 그 값이 디바이스 언어보다 우선하기 때문).
 *
 * 선택한 언어의 영구 저장도 이번에 함께 붙였다 — persistLanguage()가 AsyncStorage에
 * 쓰고, 다음 실행에서 i18n이 그 값으로 초기화된다.
 */
import { create } from "zustand";
import i18n, {
  detectInitialLanguage,
  persistLanguage,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
} from "@/i18n";
import { getMyPreferences, saveMyPreferences } from "@/services/profile";

type LocaleState = {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  /** i18n 초기화 완료 후, 실제 적용된 언어로 화면 표기를 맞춘다(app/_layout.tsx에서 호출). */
  syncFromI18n: () => void;
  /**
   * [2026-09-16 확정-결정사항 9] 로그인 뒤 서버 값을 반영한다(app/_layout.tsx에서 호출).
   *
   * 지금까지 언어는 기기에만 남아 기기를 바꾸면 초기화됐다. 서버가 비어 있으면
   * "아직 고르지 않음"이므로 기기 값을 유지하고, 그 값을 서버에 올린다.
   */
  syncWithServer: () => Promise<void>;
};

function isSupported(tag: string): tag is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(tag);
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  language: detectInitialLanguage(),
  setLanguage: (language) => {
    i18n.changeLanguage(language);
    set({ language });
    // 저장 실패는 persistLanguage 안에서 경고만 남기고 삼킨다 — 전환 자체는 이미 끝났다.
    void persistLanguage(language);
    // [2026-09-16 확정 9] 로그인 상태면 서버에도 올린다. 비로그인이면 아무 일도
    // 하지 않는다 — 나중에 로그인할 때 syncWithServer가 올린다.
    void saveMyPreferences({ language });
  },
  syncFromI18n: () => {
    // i18n.language는 "ko-KR"처럼 지역까지 붙어 올 수 있어 앞 두 글자만 본다.
    const applied = (i18n.language ?? "").split("-")[0];
    if (isSupported(applied)) {
      set({ language: applied });
    }
  },
  syncWithServer: async () => {
    const { language } = await getMyPreferences();
    if (language && isSupported(language)) {
      i18n.changeLanguage(language);
      set({ language });
      // 서버 값을 기기에도 남긴다 — 다음 실행은 로그인 전에도 이 언어로 뜬다.
      void persistLanguage(language);
      return;
    }
    // 서버가 비어 있다 = 아직 고르지 않았다. 지금 기기 값을 올려 둔다.
    void saveMyPreferences({ language: get().language });
  },
}));
