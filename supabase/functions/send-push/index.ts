// Supabase Edge Function: send-push
//
// [2026-09-12] 수신함 알림(user_notifications)을 푸시로 보낸다.
//
// 왜 DB 트리거가 직접 보내지 않는가: Postgres는 외부로 HTTP를 보낼 수 없다. pg_net을
// 켜서 DB가 이 함수를 부르게 할 수도 있지만, 그러려면 호출용 비밀값을 DB 안에 두어야
// 하고 그 값이 마이그레이션(=저장소)에 남는다. 지금 알림이 생기는 지점은 전부 **관리자가
// 앱에서 누른 결과**(업체 승인, 충전 승인, QA 답변)이므로, 그 관리자의 클라이언트가
// 승인 직후 이 함수를 한 번 부르는 편이 단순하고 새 비밀도 필요 없다 — ad-bid와 같은 방식이다.
//
// 호출자는 admin이어야 한다. 확인은 **호출자의 JWT로** is_admin_or_above()를 실행해
// DB가 판정한다(service_role로 부르면 그 판정이 무력화된다). 발송 대상 조회와 발송
// 기록만 service_role로 한다 — 남의 토큰은 RLS가 막기 때문이다.
//
// 문구는 받는 사람 기기의 언어로 만든다(push_tokens.lang). 언어가 다른 기기를 함께
// 쓰면 기기마다 다른 언어로 간다.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { pushMessage } from "../_shared/pushText.ts";

type SendPushRequest = {
  /** 알림 종류. user_notifications.kind와 같다. */
  kind: string;
  /** 그 알림을 특정하는 키. 트리거가 넣은 dedupe_key와 같은 값이어야 한다. */
  dedupeKey: string;
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

type TokenRow = { token: string; lang: string | null };

/**
 * Expo 푸시 발송.
 *
 * 한 번에 보내되 문구는 기기 언어별로 다르다 — Expo는 메시지 배열을 받으므로 기기마다
 * 다른 문구를 한 요청에 담을 수 있다.
 *
 * 실패해도 예외를 던지지 않는다. 알림은 이미 수신함에 들어가 있고, 푸시가 실패했다고
 * 승인 자체를 되돌릴 수는 없다 — 로그만 남긴다.
 */
async function sendExpoPush(
  tokens: TokenRow[],
  kind: string,
  params: Record<string, unknown>,
  route: string | null,
): Promise<boolean> {
  const messages = tokens
    .map((row) => {
      const text = pushMessage(kind, row.lang, params);
      if (!text) return null;
      return {
        to: row.token,
        sound: "default",
        title: text.title,
        body: text.body,
        // 앱이 알림을 눌렀을 때 갈 곳. 없으면 수신함으로 보낸다.
        data: { route: route ?? "/notifications", kind },
      };
    })
    .filter((message): message is NonNullable<typeof message> => message !== null);

  if (messages.length === 0) return false;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      console.warn("[send-push] expo push failed:", response.status, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[send-push] expo push threw:", err instanceof Error ? err.message : err);
    return false;
  }
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.length === 0) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: SendPushRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!body?.kind || !body?.dedupeKey) {
    return json({ error: "invalid body" }, 400);
  }

  // 관리자인지 DB가 판정한다 — 여기서 역할을 다시 해석하지 않는다.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: isAdmin } = await userClient.rpc("is_admin_or_above");

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // [2026-09-12] 예외 하나: **입금 신고 알림은 업체가 보낸다.**
  //
  // 다른 알림은 전부 관리자가 누른 결과라 "호출자는 관리자"로 충분했다. 그런데 입금
  // 신고는 업체가 하고 받는 사람이 관리자다 — 업체는 관리자가 아니므로 그대로는 막힌다.
  //
  // 그래서 이 종류만, **그 신고를 낸 본인인지**를 확인해서 허용한다. dedupe_key가
  // payment_requests.id이므로 그 행의 requested_by와 호출자를 맞춰 보면 된다.
  // 남의 신고 id를 넣어도 통과하지 못한다.
  let allowed = isAdmin === true;
  if (!allowed && body.kind === "payment_requested") {
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData.user?.id ?? null;
    if (callerId) {
      const { data: request } = await admin
        .from("payment_requests")
        .select("id")
        .eq("id", body.dedupeKey)
        .eq("requested_by", callerId)
        .maybeSingle();
      allowed = !!request;
    }
  }

  if (!allowed) {
    return json({ error: "forbidden" }, 403);
  }

  // 아직 안 보낸 알림들. 이미 보냈으면(pushed_at) 조용히 건너뛴다 — 화면을 두 번 눌러도
  // 푸시가 두 번 가지 않는다.
  //
  // [2026-09-12] **여러 건**을 처리한다. 예전에는 한 건만 보냈는데, 받는 사람이 여럿인
  // 알림(입금 신고 → 관리자 전원, 신고 처리 → 신고자 전원)에서는 첫 사람만 받고 나머지는
  // 영영 못 받았다. 같은 kind + dedupe_key는 "같은 사건"이므로 한 번에 다 보낸다.
  const { data: rows, error: rowError } = await admin
    .from("user_notifications")
    .select("id,user_id,kind,params,link")
    .eq("kind", body.kind)
    .eq("dedupe_key", body.dedupeKey)
    .is("pushed_at", null)
    .limit(50);

  if (rowError) {
    console.warn("[send-push] lookup failed:", rowError.message);
    return json({ result: "failed" });
  }

  if (!rows || rows.length === 0) {
    return json({ result: "nothing-to-send" });
  }

  let sentCount = 0;

  for (const row of rows) {
    const { data: tokens } = await admin
      .from("push_tokens")
      .select("token,lang")
      .eq("user_id", row.user_id);

    const sent = await sendExpoPush(
      (tokens ?? []) as TokenRow[],
      row.kind,
      (row.params ?? {}) as Record<string, unknown>,
      row.link,
    );

    // 보낸 표시는 실제로 보낸 경우에만. 기기가 하나도 없는 사용자(웹만 쓰는 계정)는
    // NULL로 남겨 둔다 — 나중에 앱을 깔면 그때 받을 수 있어야 한다.
    if (sent) {
      sentCount += 1;
      await admin
        .from("user_notifications")
        .update({ pushed_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  }

  return json({ result: sentCount > 0 ? "ok" : "no-device", sent: sentCount });
});
