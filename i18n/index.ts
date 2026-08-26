/**
 * Viet's i18n 초기화
 *
 * 지원 언어: vi, ko, en, zh, ja (I18N.md 참조)
 * 이것은 "UI Translation" 전용이다 — 매물/기사 등 "Content Translation"은
 * DB(article_translations 등)에서 별도로 관리하며 이 모듈과 섞지 않는다
 * (I18N.md §1 참조).
 *
 * Locale 결정 순서 (I18N.md §2.4):
 *   1) 사용자가 Settings에서 명시적으로 선택한 언어 (아직 미구현 — Phase 3/10에서
 *      영구 저장소 연동 예정, 현재는 store/useLocaleStore.ts의 메모리 상태만 사용)
 *   2) Device locale이 지원 언어 목록에 있으면 그 언어
 *   3) 그 외에는 'en'
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";

import en from "./locales/en.json";
import ko from "./locales/ko.json";
import vi from "./locales/vi.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";

export const SUPPORTED_LANGUAGES = ["vi", "ko", "en", "zh", "ja"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

const resources = {
  vi: { translation: vi },
  ko: { translation: ko },
  en: { translation: en },
  zh: { translation: zh },
  ja: { translation: ja },
};

function isSupportedLanguage(tag: string): tag is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(tag);
}

/**
 * Device locale을 확인해 지원 언어 중 하나를 고르거나 DEFAULT_LANGUAGE로 폴백한다.
 * (원칙 10, 마스터 프롬프트: 미지원 언어는 English 기본값)
 */
export function detectInitialLanguage(): SupportedLanguage {
  const deviceLocales = Localization.getLocales();
  for (const locale of deviceLocales) {
    if (isSupportedLanguage(locale.languageCode ?? "")) {
      return locale.languageCode as SupportedLanguage;
    }
  }
  return DEFAULT_LANGUAGE;
}

let initialized = false;

export function initI18n() {
  if (initialized) return i18n;
  initialized = true;

  i18n.use(initReactI18next).init({
    resources,
    lng: detectInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    compatibilityJSON: "v4",
    interpolation: {
      escapeValue: false, // React가 이미 XSS를 방어함
    },
  });

  return i18n;
}

export default i18n;
