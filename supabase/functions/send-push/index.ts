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

type ExpoMessage = {
  to: string;
  sound: string;
  title: string;
  body: string;
  data: { route: string; kind: string };
};

/**
 * 기기 목록 → Expo 메시지 목록.
 *
 * 문구는 기기 언어별로 다르다(push_tokens.lang). Expo는 메시지 배열을 받으므로 기기마다
 * 다른 문구를 한 요청에 담을 수 있다.
 *
 * [2026-09-27] 발송(sendExpoPush)에서 **만들기만** 떼어냈다. 받는 사람이 수백 명일 수
 * 있어(관리자 푸시) 여러 사람의 메시지를 모아 한 번에 보내야 하는데, 예전 구조는
 * "한 사람의 기기들"만 받아 바로 보냈다.
 */
function buildExpoMessages(
  tokens: TokenRow[],
  kind: string,
  params: Record<string, unknown>,
  route: string | null,
): ExpoMessage[] {
  return tokens
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
    .filter((message): message is ExpoMessage => message !== null);
}

/**
 * Expo 푸시 발송.
 *
 * 실패해도 예외를 던지지 않는다. 알림은 이미 수신함에 들어가 있고, 푸시가 실패했다고
 * 승인 자체를 되돌릴 수는 없다 — 로그만 남긴다.
 *
 * [2026-09-27] **100건씩 나눠 보낸다.** Expo가 한 요청에 받는 메시지 수 상한이 100이고,
 * 넘기면 요청 전체가 거부된다 — 관리자 푸시가 전체 계정을 대상으로 하면 바로 걸린다.
 */
async function sendExpoPush(messages: ExpoMessage[]): Promise<boolean> {
  if (messages.length === 0) return false;

  const CHUNK = 100;
  let anySent = false;

  for (let start = 0; start < messages.length; start += CHUNK) {
    const chunk = messages.slice(start, start + CHUNK);
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!response.ok) {
        console.warn("[send-push] expo push failed:", response.status, await response.text());
        continue;
      }
      anySent = true;
    } catch (err) {
      console.warn("[send-push] expo push threw:", err instanceof Error ? err.message : err);
    }
  }

  return anySent;
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

  // [2026-09-16 결함 수정] 예외 둘: **업체 등록 신청 알림은 신청자가 보낸다.**
  //
  // 입금 신고와 사정이 같다 — 보내는 쪽은 업체이고 받는 쪽이 관리자라, "호출자는
  // 관리자" 규칙으로는 막힌다. dedupe_key가 agencies.id이므로 그 업체의 활성
  // 구성원인지 확인해서 허용한다. 남의 업체 id를 넣어도 통과하지 못한다.
  if (!allowed && body.kind === "agency_applied") {
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData.user?.id ?? null;
    if (callerId) {
      const { data: member } = await admin
        .from("agency_members")
        .select("agency_id")
        .eq("agency_id", body.dedupeKey)
        .eq("user_id", callerId)
        .maybeSingle();
      allowed = !!member;
    }
  }

  // [2026-09-28] 예외 셋: **투자 상담 알림은 상담을 건 고객이 보낸다.**
  //
  // 앞의 둘과 사정이 같다 — 보내는 쪽이 고객이고 받는 쪽이 관리자·상담 직원이라
  // "호출자는 관리자" 규칙으로는 막힌다. 여기서 막히면 화면은 조용히 지나가고
  // (푸시 실패는 무시한다) 담당자는 문의가 온 줄 모른다.
  //
  // dedupe_key가 investment_conversations.id이므로 그 대화의 customer_id와
  // 호출자를 맞춰 본다. 남의 대화 id를 넣어도 통과하지 못한다.
  if (!allowed && body.kind === "investment_chat") {
    const { data: userData } = await userClient.auth.getUser();
    const callerId = userData.user?.id ?? null;
    if (callerId) {
      const { data: conversation } = await admin
        .from("investment_conversations")
        .select("id")
        .eq("id", body.dedupeKey)
        .eq("customer_id", callerId)
        .maybeSingle();
      allowed = !!conversation;
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
  //
  // [2026-09-27] **50명 상한을 없앴다.**
  //
  // 관리자 푸시 메시지(admin_message)가 생기면서 대상이 전체 가입 계정이 될 수 있다.
  // .limit(50) 그대로였다면 51번째부터는 알림함에만 쌓이고 푸시는 영영 안 갔다 —
  // 게다가 실패가 아니라 "성공"으로 끝나 아무도 눈치채지 못했을 것이다.
  //
  // 세 가지를 바꿨다:
  //   1. **id 커서로 페이지를 넘긴다.** pushed_at is null로 다시 읽는 방식은 쓸 수 없다 —
  //      기기가 없는 사용자의 행은 일부러 NULL로 남기므로(아래 참고) 같은 행을 끝없이
  //      다시 읽게 된다.
  //   2. **토큰을 한 번에 조회한다.** 행마다 push_tokens를 따로 읽으면 사용자 수만큼
  //      왕복이 생겨 함수 실행 시간 안에 끝나지 않는다.
  //   3. **Expo에 100건씩 나눠 보낸다.** Expo가 한 요청에 받는 메시지 수 상한이 100이다.
  const BATCH_ROWS = 500;
  const MAX_ROUNDS = 40; // 안전 상한 — 500 × 40 = 20,000건에서 멈춘다.

  let sentCount = 0;
  let cursor = "";

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let query = admin
      .from("user_notifications")
      .select("id,user_id,kind,params,link")
      .eq("kind", body.kind)
      .eq("dedupe_key", body.dedupeKey)
      .is("pushed_at", null)
      .order("id")
      .limit(BATCH_ROWS);
    if (cursor) query = query.gt("id", cursor);

    const { data: rows, error: rowError } = await query;
    if (rowError) {
      console.warn("[send-push] lookup failed:", rowError.message);
      return json({ result: "failed", sent: sentCount });
    }
    if (!rows || rows.length === 0) break;

    cursor = rows[rows.length - 1].id as string;

    // 이 묶음의 토큰을 한 번에 가져와 사용자별로 나눈다.
    const userIds = [...new Set(rows.map((row) => row.user_id as string))];
    const { data: tokenRows } = await admin
      .from("push_tokens")
      .select("user_id,token,lang")
      .in("user_id", userIds);

    const tokensByUser = new Map<string, TokenRow[]>();
    for (const row of (tokenRows ?? []) as { user_id: string; token: string; lang: string | null }[]) {
      const list = tokensByUser.get(row.user_id) ?? [];
      list.push({ token: row.token, lang: row.lang });
      tokensByUser.set(row.user_id, list);
    }

    const messages: ExpoMessage[] = [];
    const deliveredRowIds: string[] = [];

    for (const row of rows) {
      const tokens = tokensByUser.get(row.user_id as string) ?? [];
      const built = buildExpoMessages(
        tokens,
        row.kind as string,
        (row.params ?? {}) as Record<string, unknown>,
        (row.link ?? null) as string | null,
      );
      if (built.length === 0) continue; // 기기가 없는 사용자 — 아래 참고.
      messages.push(...built);
      deliveredRowIds.push(row.id as string);
    }

    if (messages.length === 0) continue;

    const ok = await sendExpoPush(messages);
    if (!ok) continue;

    // 보낸 표시는 실제로 보낸 경우에만. 기기가 하나도 없는 사용자(웹만 쓰는 계정)는
    // NULL로 남겨 둔다 — 나중에 앱을 깔면 그때 받을 수 있어야 한다.
    for (let start = 0; start < deliveredRowIds.length; start += 200) {
      await admin
        .from("user_notifications")
        .update({ pushed_at: new Date().toISOString() })
        .in("id", deliveredRowIds.slice(start, start + 200));
    }
    sentCount += deliveredRowIds.length;
  }

  return json({ result: sentCount > 0 ? "ok" : "no-device", sent: sentCount });
});
