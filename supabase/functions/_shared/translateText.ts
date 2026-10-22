/**
 * [2026-10-22] 문장 하나를 한 언어로 번역한다 — 전역 캐시를 먼저 보고, 없을 때만
 * Google을 부른다.
 *
 * 왜 translate 엣지 함수를 부르지 않는가: 그 함수는 **로그인 사용자**를 요구한다
 * (익명 호출 차단). 수집 엔진에는 로그인한 사용자가 없어 그 경로로는 401이 된다.
 * 함수끼리 HTTP로 왕복하는 비용도 든다.
 *
 * 같은 로직이 translate / translate-content 두 함수에도 있다. 그 둘을 이 모듈로
 * 바꾸지 않은 이유는 둘 다 운영 중이고(채팅 번역, 매물 설명 번역) 지금 건드리면
 * 동작하는 기능이 함께 흔들리기 때문이다. 수집 쪽이 안정되면 통합한다.
 *
 * **캐시 키 규칙은 그 두 함수와 반드시 같아야 한다** — 다르면 캐시를 공유하지 못해
 * 같은 문장을 두 번 번역한다(돈이 두 번 나간다).
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** 앱이 지원하는 언어. i18n/index.ts의 SUPPORTED_LANGUAGES와 같아야 한다. */
export const TARGET_LANGUAGES = ["vi", "ko", "en", "zh", "ja", "th"] as const;

/**
 * 번역에 보낼 문장 길이 상한.
 *
 * 카드에 보이는 분량만 번역한다. 피드 요약이 길게 오는 경우가 있는데, 화면에 두
 * 줄만 보이는 글을 전부 번역하면 과금 문자 수만 늘어난다.
 */
export const MAX_TRANSLATE_CHARS = 400;

/** translate / translate-content와 **동일한** 키 규칙. 바꾸면 캐시가 갈라진다. */
async function buildKey(sourceLang: string, targetLang: string, text: string): Promise<string> {
  const normalized = text.trim().replace(/\s+/g, " ");
  const payload = `${sourceLang}:${targetLang}:${normalized}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type TranslateOutcome = "api_call" | "cache_hit" | "skipped" | "failed";

export type TranslateResult = {
  text: string | null;
  outcome: TranslateOutcome;
};

/**
 * 한 문장을 한 언어로. 실패하면 text가 null — 부르는 쪽이 그 언어를 건너뛴다.
 *
 * 빈 문자열을 넣지 않는 이유: 화면은 번역이 없으면 원문으로 폴백한다(localizedText).
 * 빈 문자열을 넣으면 폴백이 막혀 빈 칸이 보인다.
 */
export async function translateText(
  admin: SupabaseClient,
  googleApiKey: string | undefined,
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<TranslateResult> {
  const trimmed = text.trim().slice(0, MAX_TRANSLATE_CHARS);
  if (trimmed.length === 0 || sourceLang === targetLang) {
    return { text: null, outcome: "skipped" };
  }

  const key = await buildKey(sourceLang, targetLang, trimmed);

  const { data: cached } = await admin
    .from("translation_cache")
    .select("translated_text, hit_count")
    .eq("translation_key", key)
    .maybeSingle();

  if (cached?.translated_text) {
    // 재사용 통계. 실패해도 번역 결과에는 영향을 주지 않는다.
    await admin
      .from("translation_cache")
      .update({
        hit_count: ((cached.hit_count as number) ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("translation_key", key);

    await logUsage(admin, "cache_hit", sourceLang, targetLang, trimmed.length);
    return { text: cached.translated_text as string, outcome: "cache_hit" };
  }

  if (!googleApiKey) {
    await logUsage(admin, "failed", sourceLang, targetLang, trimmed.length, "GOOGLE_TRANSLATE_API_KEY 미설정");
    return { text: null, outcome: "failed" };
  }

  try {
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: trimmed, source: sourceLang, target: targetLang, format: "text" }),
      },
    );
    const result = await response.json();
    const translated = result?.data?.translations?.[0]?.translatedText;

    if (typeof translated !== "string" || translated.length === 0) {
      await logUsage(
        admin, "failed", sourceLang, targetLang, trimmed.length,
        result?.error?.message ?? "예상과 다른 응답 형태",
      );
      return { text: null, outcome: "failed" };
    }

    // 캐시에 저장. 같은 문장을 동시에 번역한 다른 요청이 먼저 넣었어도
    // ignoreDuplicates로 조용히 지나간다.
    await admin.from("translation_cache").upsert(
      {
        translation_key: key,
        source_lang: sourceLang,
        target_lang: targetLang,
        translated_text: translated,
        provider: "google",
      },
      { onConflict: "translation_key", ignoreDuplicates: true },
    );

    await logUsage(admin, "api_call", sourceLang, targetLang, trimmed.length);
    return { text: translated, outcome: "api_call" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    await logUsage(admin, "failed", sourceLang, targetLang, trimmed.length, message);
    return { text: null, outcome: "failed" };
  }
}

async function logUsage(
  admin: SupabaseClient,
  outcome: TranslateOutcome,
  sourceLang: string,
  targetLang: string,
  charCount: number,
  errorMessage?: string,
): Promise<void> {
  await admin.from("translation_usage_log").insert({
    outcome,
    source_lang: sourceLang,
    target_lang: targetLang,
    char_count: charCount,
    error_message: errorMessage ?? null,
  });
}

export type I18nMap = Record<string, string>;

export type TranslateFieldsResult = {
  titleI18n: I18nMap;
  summaryI18n: I18nMap;
  apiCalls: number;
  cacheHits: number;
  failures: number;
};

/**
 * 기사 한 건의 제목·요약을 원문 외 언어로 번역한다.
 *
 * 언어는 **병렬로** 돈다(5개 동시). 순차로 돌리면 기사 한 건에 10회 왕복이라
 * 10건을 처리하는 데 실행 시간 상한에 걸릴 수 있다. Google 쪽은 초당 수백 요청을
 * 허용하므로 5 동시는 안전하다.
 *
 * 한 언어가 실패해도 나머지는 저장한다 — 전부 아니면 전무로 하면 일시적인 오류에
 * 기사 전체가 원문으로 남는다.
 */
export async function translateArticleFields(
  admin: SupabaseClient,
  googleApiKey: string | undefined,
  title: string,
  summary: string | null,
  sourceLang: string,
): Promise<TranslateFieldsResult> {
  const titleI18n: I18nMap = {};
  const summaryI18n: I18nMap = {};
  let apiCalls = 0;
  let cacheHits = 0;
  let failures = 0;

  const targets = TARGET_LANGUAGES.filter((lang) => lang !== sourceLang);

  const results = await Promise.all(
    targets.map(async (lang) => {
      const [t, s] = await Promise.all([
        translateText(admin, googleApiKey, title, sourceLang, lang),
        summary && summary.trim().length > 0
          ? translateText(admin, googleApiKey, summary, sourceLang, lang)
          : Promise.resolve<TranslateResult>({ text: null, outcome: "skipped" }),
      ]);
      return { lang, t, s };
    }),
  );

  for (const { lang, t, s } of results) {
    if (t.text) titleI18n[lang] = t.text;
    if (s.text) summaryI18n[lang] = s.text;
    for (const outcome of [t.outcome, s.outcome]) {
      if (outcome === "api_call") apiCalls += 1;
      else if (outcome === "cache_hit") cacheHits += 1;
      else if (outcome === "failed") failures += 1;
    }
  }

  return { titleI18n, summaryI18n, apiCalls, cacheHits, failures };
}
