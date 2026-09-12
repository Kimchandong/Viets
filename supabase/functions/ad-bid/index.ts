// Supabase Edge Function: ad-bid
//
// [2026-09-12 사용자 지시] 광고 클릭 단가 설정 + **탈락 푸시**.
//
// 왜 앱에서 RPC를 직접 부르지 않는가: 이 호출로 다른 업체가 순위에서 밀려날 수 있고,
// 그 사실을 밀려난 쪽에 푸시로 알려야 한다. Postgres에서는 외부로 HTTP를 보낼 수
// 없으므로(ad-click과 같은 이유) 설정과 발송을 한 요청 안에서 처리한다.
//
// RPC는 **호출자의 JWT로** 실행한다 — set_ad_bid가 auth.uid()로 "이 매물을 만질 수
// 있는 사람인지"를 확인하기 때문이다. service_role로 부르면 그 확인이 통째로 무력화된다.
// 푸시 토큰 조회만 service_role로 한다(남의 토큰은 RLS가 막는다).

import { createClient } from "jsr:@supabase/supabase-js@2";

import { pushMessage } from "../_shared/pushText.ts";

type AdBidRequest = {
  propertyId: string;
  placement: "featured" | "top10";
  amount: number;
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

// [2026-09-12] 문구를 기기 언어로 만든다(ad-click과 같은 이유 — 앱 밖만 한국어였다).
async function sendExpoPush(tokens: { token: string; lang: string | null }[]) {
  const messages = tokens
    .map((row) => {
      const text = pushMessage("ad_slot_dropped", row.lang);
      if (!text) return null;
      return {
        to: row.token,
        sound: "default",
        title: text.title,
        body: text.body,
        // 자리에서 빠졌으니 다시 순위를 사러 가야 한다.
        data: { route: "/ad-manage", kind: "ad_slot_dropped" },
      };
    })
    .filter((message): message is NonNullable<typeof message> => message !== null);

  if (messages.length === 0) return;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      console.warn("[ad-bid] expo push failed:", response.status, await response.text());
    }
  } catch (err) {
    console.warn("[ad-bid] expo push threw:", err instanceof Error ? err.message : err);
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

  let body: AdBidRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (
    !body?.propertyId ||
    (body.placement !== "featured" && body.placement !== "top10") ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0
  ) {
    return json({ error: "invalid body" }, 400);
  }

  // 호출자 권한 그대로 실행 — 남의 매물을 광고에 올리지 못하게 하는 검사가 DB 안에 있다.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await userClient.rpc("set_ad_bid", {
    p_property_id: body.propertyId,
    p_placement: body.placement,
    p_amount: body.amount,
  });

  if (error) {
    console.warn("[ad-bid] set_ad_bid failed:", error.message);
    return json({ result: "failed" });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const result = String(row?.result ?? "failed");
  const droppedOwner: string | null = row?.dropped_owner ?? null;

  // 밀려난 업체 대표에게 푸시. 설정 자체는 이미 끝났으므로 발송이 실패해도 결과는 ok다.
  if (result === "ok" && droppedOwner) {
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: pending } = await admin
      .from("ad_notifications")
      .select("id")
      .eq("user_id", droppedOwner)
      .eq("kind", "slot_dropped")
      .is("pushed_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    const notificationId = pending?.[0]?.id;
    if (notificationId) {
      const { data: tokens } = await admin
        .from("push_tokens")
        .select("token,lang")
        .eq("user_id", droppedOwner);

      await sendExpoPush((tokens ?? []) as { token: string; lang: string | null }[]);

      await admin
        .from("ad_notifications")
        .update({ pushed_at: new Date().toISOString() })
        .eq("id", notificationId);
    }
  }

  return json({ result });
});
