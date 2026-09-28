// Supabase Edge Function: translate-content
//
// [2026-09-28 사용자 지시] "실시간으로 새 매물이 올라올 건데, 매물마다 번역이
// 자동으로 유저 디바이스 언어에 따라 되어야 한다."
//
// 등록 화면으로 올린 매물은 저장 시점에 6개 언어가 만들어진다
// (services/contentTranslation.ts). 문제는 그렇지 않은 글이다 — SQL로 직접 넣은
// 매물, 이 기능이 생기기 전 데이터, 등록 당시 번역 API가 실패한 언어.
//
// 그런 글을 앱이 볼 때 번역하고 있었는데(hooks/useLocalizedContent.ts), 두 가지가
// 잘못돼 있었다.
//
//   1. 번역 결과가 그 매물에 저장되지 않았다. 앱 메모리에만 남아, 앱을 껐다 켜면
//      사라지고 사용자마다 따로 번역을 불렀다.
//   2. translate 함수는 로그인을 요구한다(익명 호출 차단). 그런데 매물 상세는
//      **로그인 없이 볼 수 있다** — 비로그인 베트남 사용자에게는 한국어로 쓴 설명이
//      끝까지 한국어로 보였다.
//
// 그래서 이 함수는 translate와 달리:
//   · 번역할 **문장을 클라이언트에서 받지 않는다.** 행 id와 대상 언어만 받고 원문은
//     서버가 DB에서 읽는다 — 아무 문장이나 남의 매물에 써 넣을 수 없다.
//   · 결과를 description_i18n에 **저장한다.** 그 뒤로는 앱이 이 함수를 부를 일이
//     없고(행에 이미 있다), 비로그인 사용자도 그대로 읽는다.
//   · 익명 호출을 허용한다. 비용은 (행 × 언어)로 묶여 있다 — 한 번 번역된 칸은
//     다시 번역되지 않으므로, 이는 정당한 번역 비용의 상한 그 자체다.
//
// 실제 번역은 translate 함수와 같은 전역 캐시(translation_cache)를 먼저 본다.

import { createClient } from "jsr:@supabase/supabase-js@2";

type ContentKind = "property" | "investment";

type RequestBody = {
  kind: ContentKind;
  id: string;
  targetLang: string;
};

const TABLES: Record<ContentKind, string> = {
  property: "properties",
  investment: "investment_products",
};

const SUPPORTED = ["vi", "ko", "en", "zh", "ja", "th"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** translate 함수와 **같은 규칙**이어야 한다 — 다르면 캐시를 공유하지 못한다. */
async function buildTranslationKey(sourceLang: string, targetLang: string, text: string): Promise<string> {
  const normalized = text.trim().replace(/\s+/g, " ");
  const payload = `${sourceLang}:${targetLang}:${normalized}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleApiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server misconfigured" }, 500);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const table = TABLES[body?.kind];
  const targetLang = body?.targetLang;
  if (!table || !body?.id || !targetLang || !SUPPORTED.includes(targetLang)) {
    return json({ error: "kind, id and a supported targetLang are required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: row, error: rowError } = await admin
    .from(table)
    .select("id,description,description_i18n,description_lang")
    .eq("id", body.id)
    .maybeSingle();

  if (rowError || !row) {
    return json({ error: "not found" }, 404);
  }

  const stored = (row.description_i18n ?? {}) as Record<string, string>;

  // 이미 있으면 번역하지 않는다. 앱이 경합해서 두 번 부르는 경우가 여기서 걸린다.
  if (typeof stored[targetLang] === "string" && stored[targetLang].trim().length > 0) {
    return json({ translatedText: stored[targetLang], outcome: "stored" });
  }

  // 원문 고르기 — 원문 언어가 기록돼 있으면 그 언어의 글이 원문이다. 없으면
  // description 칸을 쓰되 언어를 vi로 본다(기존 데이터의 규칙, toContentMap과 동일).
  const sourceLang = (row.description_lang as string | null) || "vi";
  const sourceText = ((row.description as string | null) ?? "").trim();

  if (sourceText.length === 0) {
    return json({ translatedText: "", outcome: "skipped" });
  }
  if (sourceLang === targetLang) {
    return json({ translatedText: sourceText, outcome: "skipped" });
  }

  const translationKey = await buildTranslationKey(sourceLang, targetLang, sourceText);

  let translated: string | null = null;
  let outcome: "cache_hit" | "api_call" | "failed" = "failed";

  const { data: cached } = await admin
    .from("translation_cache")
    .select("translated_text, hit_count")
    .eq("translation_key", translationKey)
    .maybeSingle();

  if (cached?.translated_text) {
    translated = cached.translated_text as string;
    outcome = "cache_hit";
    await admin
      .from("translation_cache")
      .update({ hit_count: ((cached.hit_count as number) ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("translation_key", translationKey);
  } else if (googleApiKey) {
    try {
      const response = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${googleApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: sourceText, source: sourceLang, target: targetLang, format: "text" }),
        },
      );
      const result = await response.json();
      const value = result?.data?.translations?.[0]?.translatedText;
      if (typeof value === "string") {
        translated = value;
        outcome = "api_call";
        await admin.from("translation_cache").upsert(
          {
            translation_key: translationKey,
            source_lang: sourceLang,
            target_lang: targetLang,
            translated_text: value,
            provider: "google",
          },
          { onConflict: "translation_key", ignoreDuplicates: true },
        );
      }
    } catch (_err) {
      translated = null;
    }
  }

  await admin.from("translation_usage_log").insert({
    outcome: outcome === "failed" ? "failed" : outcome,
    source_lang: sourceLang,
    target_lang: targetLang,
    char_count: sourceText.length,
  });

  if (translated === null) {
    // 원문을 돌려준다 — 번역 실패가 화면을 비우지 않게 한다.
    return json({ translatedText: sourceText, outcome: "failed" });
  }

  // 행에 저장한다. 여기서부터는 앱이 이 함수를 부르지 않고, 비로그인 사용자도 읽는다.
  //
  // 방금 읽은 stored를 덮어쓰는 것이라 다른 언어를 동시에 번역한 요청과 부딪힐 수
  // 있다. jsonb 병합(`||`)을 쓰면 그 창이 없어지지만 PostgREST로는 표현할 수 없어,
  // 한쪽이 덮어써도 다음에 보는 사람이 다시 채우는 쪽을 택했다(손실은 캐시 한 칸이고
  // Google 재호출도 캐시가 막는다).
  const { error: updateError } = await admin
    .from(table)
    .update({ description_i18n: { ...stored, [targetLang]: translated } })
    .eq("id", body.id);

  if (updateError) {
    console.warn("[translate-content] 저장 실패:", updateError.message);
  }

  return json({ translatedText: translated, outcome });
});
