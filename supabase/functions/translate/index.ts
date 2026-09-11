// Supabase Edge Function: translate
//
// [STEP T-2, 2026-09-10] 채팅 자동번역 비용 최적화 — Google Translation API 호출을
// 클라이언트에서 이 서버 함수로 옮긴다.
//
// 왜 서버로 옮기는가(감사 결과):
//   기존에는 앱이 EXPO_PUBLIC_GOOGLE_TRANSLATE_API_KEY로 Google API를 직접 호출했다.
//   EXPO_PUBLIC_* 값은 APK 번들에 평문으로 들어가므로, 앱을 디컴파일하면 누구나 키를
//   꺼내 무제한으로 호출할 수 있었다(지시서 §15 위반, 비용 폭탄 위험).
//   이제 키는 Supabase Secrets(GOOGLE_TRANSLATE_API_KEY)에만 존재하고, 앱은 로그인
//   사용자의 JWT로 이 함수를 호출한다.
//
// 이 함수가 책임지는 것:
//   1. 인증 확인 — 로그인하지 않은 요청은 거부한다.
//   2. 번역 불필요 판정(같은 언어/빈 문자열) — API를 호출하지 않는다.
//   3. 전역 캐시(translation_cache) 조회 — 있으면 Google을 호출하지 않는다.
//   4. 없을 때만 Google Translation API 호출 → 결과를 캐시에 upsert.
//      upsert의 on-conflict가 동시 요청 중복 저장을 막는다(§9).
//   5. 사용량 로그(translation_usage_log) 기록 — 과금 문자 수와 Cache Hit Rate 근거.
//
// 이 함수는 번역 결과만 돌려준다. property_messages.translations 갱신(메시지 단위
// 캐시)은 기존과 동일하게 클라이언트가 수행한다 — 기존 동작을 바꾸지 않기 위함이다.

import { createClient } from "jsr:@supabase/supabase-js@2";

type TranslateRequest = {
  text: string;
  sourceLang: string;
  targetLang: string;
  /** 사용량 로그에 남길 메시지 id(선택). 원문은 로그에 남기지 않는다. */
  messageId?: string;
};

type TranslateResponse = {
  translatedText: string;
  /** 호출부가 상태를 기록할 수 있도록 처리 경로를 함께 알려준다. */
  outcome: "api_call" | "cache_hit" | "skipped" | "failed";
};

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

/**
 * 캐시 키 = sha256(sourceLang:targetLang:정규화된 원문).
 * 정규화는 앞뒤 공백 제거 + 연속 공백 1칸으로만 한다 — 대소문자나 문장부호까지
 * 건드리면 번역 결과가 달라질 수 있어 의미를 바꾸지 않는 선에서만 정규화한다.
 * 원문 자체는 키에도 로그에도 남기지 않는다(§15).
 */
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

  // 1. 인증 확인 — 익명 호출을 막는다(유출된 anon key만으로 번역을 돌리지 못하게).
  const authHeader = req.headers.get("Authorization") ?? "";
  const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "unauthorized" }, 401);
  }

  // service_role 클라이언트 — 캐시/로그 테이블은 RLS로 클라이언트에 닫혀 있어
  // 이 함수만 접근한다.
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: TranslateRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const text = (body.text ?? "").trim();
  const sourceLang = body.sourceLang;
  const targetLang = body.targetLang;

  if (!sourceLang || !targetLang) {
    return json({ error: "sourceLang and targetLang are required" }, 400);
  }

  // 2. 번역 불필요 — 같은 언어이거나 내용이 없으면 Google을 호출하지 않는다(§18).
  if (text.length === 0 || sourceLang === targetLang) {
    await admin.from("translation_usage_log").insert({
      outcome: "skipped",
      source_lang: sourceLang,
      target_lang: targetLang,
      char_count: 0,
      message_id: body.messageId ?? null,
    });
    return json({ translatedText: text, outcome: "skipped" } satisfies TranslateResponse);
  }

  const translationKey = await buildTranslationKey(sourceLang, targetLang, text);

  // 3. 전역 캐시 조회 — 다른 사용자가 이미 번역한 같은 문장이면 무과금으로 끝난다(§14).
  const { data: cached } = await admin
    .from("translation_cache")
    .select("translated_text, hit_count")
    .eq("translation_key", translationKey)
    .maybeSingle();

  if (cached?.translated_text) {
    // 재사용 통계 갱신(실패해도 번역 응답에는 영향을 주지 않는다).
    await admin
      .from("translation_cache")
      .update({ hit_count: (cached.hit_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("translation_key", translationKey);

    await admin.from("translation_usage_log").insert({
      outcome: "cache_hit",
      source_lang: sourceLang,
      target_lang: targetLang,
      char_count: text.length,
      message_id: body.messageId ?? null,
    });

    return json({ translatedText: cached.translated_text, outcome: "cache_hit" } satisfies TranslateResponse);
  }

  // 4. 캐시에 없을 때만 Google Translation API 호출.
  if (!googleApiKey) {
    await admin.from("translation_usage_log").insert({
      outcome: "failed",
      source_lang: sourceLang,
      target_lang: targetLang,
      char_count: text.length,
      message_id: body.messageId ?? null,
      error_message: "GOOGLE_TRANSLATE_API_KEY is not set",
    });
    // 원문을 돌려준다 — 번역 실패가 대화를 끊지 않게 한다(§19).
    return json({ translatedText: text, outcome: "failed" } satisfies TranslateResponse);
  }

  try {
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source: sourceLang, target: targetLang, format: "text" }),
      },
    );

    const result = await response.json();
    const translated = result?.data?.translations?.[0]?.translatedText;

    if (typeof translated !== "string") {
      await admin.from("translation_usage_log").insert({
        outcome: "failed",
        source_lang: sourceLang,
        target_lang: targetLang,
        char_count: text.length,
        message_id: body.messageId ?? null,
        error_message: result?.error?.message ?? "unexpected response shape",
      });
      return json({ translatedText: text, outcome: "failed" } satisfies TranslateResponse);
    }

    // 5. 캐시에 저장 — on conflict do nothing이라, 같은 문장을 동시에 번역한 다른
    //    요청이 먼저 저장했더라도 오류 없이 지나간다(§9 동시성).
    await admin.from("translation_cache").upsert(
      {
        translation_key: translationKey,
        source_lang: sourceLang,
        target_lang: targetLang,
        translated_text: translated,
        provider: "google",
      },
      { onConflict: "translation_key", ignoreDuplicates: true },
    );

    await admin.from("translation_usage_log").insert({
      outcome: "api_call",
      source_lang: sourceLang,
      target_lang: targetLang,
      char_count: text.length,
      message_id: body.messageId ?? null,
    });

    return json({ translatedText: translated, outcome: "api_call" } satisfies TranslateResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await admin.from("translation_usage_log").insert({
      outcome: "failed",
      source_lang: sourceLang,
      target_lang: targetLang,
      char_count: text.length,
      message_id: body.messageId ?? null,
      error_message: message,
    });
    return json({ translatedText: text, outcome: "failed" } satisfies TranslateResponse);
  }
});
