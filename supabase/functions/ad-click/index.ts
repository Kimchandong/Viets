// Supabase Edge Function: ad-click
//
// [2026-09-12 사용자 지시] 광고 클릭 과금 + 잔액 소진 푸시.
//
// 왜 앱에서 RPC를 직접 부르지 않는가:
//   ① 클릭 어뷰징 방어. 같은 곳에서 온 반복 클릭을 걸러내려면 요청 IP가 필요한데,
//      앱이 스스로 보내는 값은 얼마든지 바꿀 수 있다. 서버(이 함수)가 헤더에서 읽어
//      해시한 값만 믿는다. 원본 IP는 저장하지 않는다.
//   ② 푸시 발송. 잔액이 0이 된 순간 등록자에게 보내야 하는데, Postgres에서 외부로
//      HTTP를 보내려면 pg_net 같은 확장이 필요하고 실패해도 알 길이 없다. 과금과
//      발송을 한 요청 안에서 처리한다.
//
// 로그인하지 않은 고객도 광고를 누른다 — 인증을 요구하지 않는다. 대신 과금 판단은
// 전부 DB 함수(charge_ad_click)가 하고, 이 함수는 IP 해시와 사용자 id만 만들어 준다.

import { createClient } from "jsr:@supabase/supabase-js@2";

import { pushMessage } from "../_shared/pushText.ts";

type AdClickRequest = {
  propertyId: string;
  placement: "featured" | "top10";
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
 * IP를 그대로 두지 않고 해시한다. 어떤 IP였는지는 알 필요가 없고, "같은 곳에서 또
 * 왔는가"만 비교하면 된다. 소금(SALT)을 섞어 해시표로 되짚는 것도 막는다.
 */
async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get("AD_CLICK_IP_SALT") ?? "viets-ad-click";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** x-forwarded-for는 "클라이언트, 프록시1, 프록시2" 형태라 맨 앞이 실제 요청자다. */
function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || "unknown";
}

/**
 * Expo 푸시 발송. 토큰이 여러 개(기기별)일 수 있어 한 번에 보낸다.
 * 실패해도 과금은 이미 끝났으므로 전체를 실패로 만들지 않는다 — 로그만 남긴다.
 *
 * [2026-09-12] 문구를 **기기 언어로** 만든다. 예전에는 한국어 문자열을 그대로 보내
 * 베트남 사용자도 한국어 푸시를 받았다(앱 안은 6개 언어인데 앱 밖만 한국어였다).
 */
async function sendExpoPush(tokens: { token: string; lang: string | null }[]) {
  const messages = tokens
    .map((row) => {
      const text = pushMessage("ad_balance_empty", row.lang);
      if (!text) return null;
      return {
        to: row.token,
        sound: "default",
        title: text.title,
        body: text.body,
        // 잔액이 비었으니 충전하러 가야 한다.
        data: { route: "/payment-info", kind: "ad_balance_empty" },
      };
    })
    .filter((message): message is NonNullable<typeof message> => message !== null);

  if (messages.length === 0) return;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      console.warn("[ad-click] expo push failed:", response.status, await response.text());
    }
  } catch (err) {
    console.warn("[ad-click] expo push threw:", err instanceof Error ? err.message : err);
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
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server misconfigured" }, 500);
  }

  let body: AdClickRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!body?.propertyId || (body.placement !== "featured" && body.placement !== "top10")) {
    return json({ error: "invalid body" }, 400);
  }

  // 로그인 상태면 사용자 id를 얻는다. 비로그인이어도 계속 진행한다 — 광고는 누구에게나 보인다.
  let viewerId: string | null = null;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.length > 0) {
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await authClient.auth.getUser();
    viewerId = data.user?.id ?? null;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const ipHash = await hashIp(clientIp(req));

  const { data, error } = await admin.rpc("charge_ad_click", {
    p_property_id: body.propertyId,
    p_placement: body.placement,
    p_ip_hash: ipHash,
    p_viewer: viewerId,
  });

  if (error) {
    console.warn("[ad-click] charge failed:", error.message);
    // 과금에 실패해도 고객의 화면 이동을 막지 않는다 — 200으로 돌려준다.
    //
    // [2026-09-12] 다만 **실패했다는 사실은 돌려준다.** 예전에는 그냥 charged:0이라
    // 앱에서도 콘솔에서도 구분이 되지 않았고, 그래서 service_role에 execute 권한이
    // 없어 과금이 전부 실패하던 것을 아무도 몰랐다(20260914150000 참조).
    // 정상적인 '과금 대상 아님'(중복 클릭·자리 밖)은 여전히 charged:0에 error 없음이다.
    return json({ charged: 0, error: "charge-failed" });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const charged = Number(row?.charged ?? 0);
  const depleted = Boolean(row?.depleted);
  const ownerId: string | null = row?.owner_id ?? null;

  // 잔액이 이번 클릭으로 0이 되었다면 등록자에게 푸시. 같은 알림을 두 번 보내지 않도록
  // 아직 pushed_at이 비어 있는 행만 골라 표시한다.
  if (depleted && ownerId) {
    const { data: pending } = await admin
      .from("ad_notifications")
      .select("id")
      .eq("user_id", ownerId)
      .eq("kind", "balance_empty")
      .is("pushed_at", null)
      .limit(1);

    const notificationId = pending?.[0]?.id;
    if (notificationId) {
      const { data: tokens } = await admin
        .from("push_tokens")
        .select("token,lang")
        .eq("user_id", ownerId);

      await sendExpoPush((tokens ?? []) as { token: string; lang: string | null }[]);

      await admin
        .from("ad_notifications")
        .update({ pushed_at: new Date().toISOString() })
        .eq("id", notificationId);
    }
  }

  return json({ charged });
});
