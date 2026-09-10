/**
 * Viet's i18n 초기화
 *
 * 지원 언어: vi, ko, en, zh, ja, th (I18N.md 참조, 2026-09-09 태국어 추가)
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
// [STEP: 2026-09-09] 사용자 요청 — 언어 선택에 태국어 추가.
import th from "./locales/th.json";

export const SUPPORTED_LANGUAGES = ["vi", "ko", "en", "zh", "ja", "th"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "en";

const resources = {
  vi: { translation: vi },
  ko: { translation: ko },
  en: { translation: en },
  zh: { translation: zh },
  ja: { translation: ja },
  th: { translation: th },
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

let initPromise: Promise<typeof i18n> | null = null;

/**
 * STEP 4-10A-3: i18next.init()은 비동기다 — 반환된 Promise를 기다리지 않으면
 * "초기화를 호출은 했지만 실제로는 아직 끝나지 않은" 시점에 준비 완료로 착각하게
 * 된다(react-i18next의 useTranslation()이 그 틈에 호출되면 NO_I18NEXT_INSTANCE류
 * 경고와 함께, i18n이 진짜로 준비되는 순간 다시 렌더되며 hook 개수가 달라지는
 * "Rendered more hooks than during the previous render" 오류로 이어진다).
 * 호출부(app/_layout.tsx)가 이 Promise가 resolve된 뒤에만 i18n에 의존하는 화면을
 * 그리도록, init 완료 시점을 정확히 알려주기 위해 Promise를 그대로 반환한다.
 */
export function initI18n(): Promise<typeof i18n> {
  if (initPromise) return initPromise;

  initPromise = i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: detectInitialLanguage(),
      fallbackLng: DEFAULT_LANGUAGE,
      compatibilityJSON: "v4",
      interpolation: {
        escapeValue: false, // React가 이미 XSS를 방어함
      },
    })
    .then(() => i18n);

  return initPromise;
}

export default i18n;
