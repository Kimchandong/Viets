/**
 * Viet's i18n 초기화
 *
 * 지원 언어: vi, ko, en, zh, ja, th (I18N.md 참조, 2026-09-09 태국어 추가)
 * 이것은 "UI Translation" 전용이다 — 매물/기사 등 "Content Translation"은
 * DB(article_translations 등)에서 별도로 관리하며 이 모듈과 섞지 않는다
 * (I18N.md §1 참조).
 *
 * Locale 결정 순서 (I18N.md §2.4):
 *   1) 사용자가 Settings에서 명시적으로 선택한 언어 (2026-09-11: AsyncStorage에
 *      영구 저장 — 앱을 껐다 켜도 유지된다)
 *   2) Device locale이 지원 언어 목록에 있으면 그 언어
 *   3) 그 외에는 'en'
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
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

/**
 * [2026-09-11] 선택한 언어를 기기에 저장한다.
 *
 * 이전에는 저장소가 없어 앱을 껐다 켤 때마다 언어 선택이 초기화됐다(위 §2.4의
 * 1번 항목이 "미구현"으로 남아 있었다). AsyncStorage는 세션 유지용으로 이미
 * 설치했으므로 그대로 쓴다.
 */
const LANGUAGE_STORAGE_KEY = "viets.language";

export async function persistLanguage(language: SupportedLanguage): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch (err) {
    // 저장 실패가 언어 전환 자체를 막지는 않는다 — 이번 실행에서만 유지된다.
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[i18n] 언어 저장 실패:", message);
  }
}

/** 저장된 선택 → 디바이스 언어 → en 순으로 실제 사용할 언어를 정한다. */
export async function resolveInitialLanguage(): Promise<SupportedLanguage> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && isSupportedLanguage(stored)) {
      return stored;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[i18n] 저장된 언어 읽기 실패:", message);
  }
  return detectInitialLanguage();
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

  // 저장된 언어를 먼저 읽어야 하므로 init 자체가 비동기 체인으로 시작한다 —
  // 읽은 뒤에 init해야 "영어로 잠깐 보였다가 한국어로 바뀌는" 깜빡임이 없다.
  initPromise = resolveInitialLanguage()
    .then((lng) =>
      i18n
        .use(initReactI18next)
        .init({
          resources,
          lng,
          fallbackLng: DEFAULT_LANGUAGE,
          compatibilityJSON: "v4",
          interpolation: {
            escapeValue: false, // React가 이미 XSS를 방어함
          },
        }),
    )
    .then(() => i18n);

  return initPromise;
}

export default i18n;
