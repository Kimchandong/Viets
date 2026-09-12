import i18n, { SUPPORTED_LANGUAGES } from "@/i18n";

import { supabase } from "./supabase";

/**
 * [2026-09-12] 콘텐츠 번역 — 매물·투자상품 설명처럼 **사용자가 쓴 글**을 저장 시점에
 * 6개 언어로 번역한다.
 *
 * UI 번역(i18n/locales/*.json)과 섞지 않는다(I18N.md §1). 저 쪽은 우리가 미리 써 둔
 * 문장이고, 이 쪽은 등록자가 방금 입력한 문장이다.
 *
 * 게시판(services/boards.ts)이 같은 일을 먼저 했고, 그 방식이 실사용에서 검증됐다.
 * 다만 게시판은 제목+본문 두 칸을 한 번에 다루고 여기는 설명 한 칸이라, 공통 부분만
 * 이 모듈로 꺼냈다.
 */

/** 한 문장을 한 언어로. 실패하면 null — 부르는 쪽이 그 언어를 건너뛴다. */
export async function translateOnce(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke("translate", {
      body: { text, sourceLang, targetLang },
    });
    if (error) {
      console.warn("[services/contentTranslation] translate failed:", error.message);
      return null;
    }
    const translated = (data as { translatedText?: unknown })?.translatedText;
    return typeof translated === "string" ? translated : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/contentTranslation] translate threw:", message);
    return null;
  }
}

/**
 * 한 문장을 원문 언어 외 5개 언어로.
 *
 * 실패한 언어는 결과에 넣지 않는다 — 빈 문자열을 넣으면 화면이 원문 폴백 대신 빈 칸을
 * 보여 준다. 한 언어가 실패해도 나머지는 저장한다(전부 아니면 전무로 하면 일시적인
 * API 오류에 매물 등록 자체가 막힌다).
 *
 * 순차로 도는 이유: 여섯 개를 동시에 던지면 Google 쪽 rate limit에 걸린다. 등록은
 * 자주 일어나는 일이 아니므로 몇 초 더 걸려도 된다.
 */
export async function translateTextForAllLanguages(
  text: string,
  sourceLang: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const trimmed = text.trim();
  if (trimmed.length === 0) return result;

  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang === sourceLang) continue;
    const translated = await translateOnce(trimmed, sourceLang, lang);
    if (translated) result[lang] = translated;
  }
  return result;
}

/**
 * 지금 앱 언어 — 등록자가 쓰고 있는 언어를 설명의 원문 언어로 본다.
 *
 * 화면마다 "이 설명은 무슨 언어인가요?"를 따로 묻지 않는 이유: 사람은 자기가 보고 있는
 * 언어로 쓴다. 틀리더라도 손해가 크지 않다 — 원문은 그대로 보존되고, 번역이 어색해지는
 * 정도다. 물어보는 칸 하나를 늘리는 비용이 그보다 크다.
 */
export function currentContentLang(): string {
  const lang = (i18n.language ?? "").split("-")[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang) ? lang : "vi";
}

/**
 * 저장된 원문 + 번역맵을 화면이 쓰는 "언어코드 → 문장" 맵으로.
 *
 * 원문을 원문 언어 자리에 함께 넣는다 — 그래야 등록자가 쓴 언어로 보는 사람이 번역을
 * 거치지 않은 문장을 읽는다. 원문 언어를 모르면(기존 데이터) `vi` 자리에 넣는다:
 * utils/format.ts localizedText()가 없는 언어를 vi로 폴백하므로, 결과적으로 모든
 * 언어에서 원문이 보인다 — 번역을 붙이기 전과 똑같은 동작이다.
 */
export function toContentMap(
  original: string | null,
  i18nMap: Record<string, string> | null | undefined,
  sourceLang: string | null | undefined,
): Record<string, string> {
  const text = original ?? "";
  const map: Record<string, string> = { ...(i18nMap ?? {}) };
  map[sourceLang && sourceLang.length > 0 ? sourceLang : "vi"] = text;
  return map;
}
