// Supabase Edge Function: geocode
//
// [STEP 04-지오코딩, 2026-09-11] 매물 주소 → 좌표 변환.
//
// 배경: 매물 등록 화면에서 위치는 지도를 눌러 직접 찍는 것이 기본이다(LocationPicker).
// 다만 주소를 이미 입력한 상태라면 지도를 손으로 찾아 들어가는 대신 그 주소로 한 번에
// 이동할 수 있는 편이 빠르다 — 이 함수가 그 변환을 담당한다.
//
// 왜 클라이언트에서 직접 부르지 않는가:
//   1. 기존 Maps 키(EXPO_PUBLIC_GOOGLE_MAPS_API_KEY)는 Android 앱 제한(패키지명+SHA-1)이
//      걸려 있어 Geocoding **Web** API에는 쓸 수 없다. 제한을 풀면 앱 번들에 평문으로
//      들어있는 키로 누구나 과금시킬 수 있다 — 2026-09-10 번역 키에서 이미 겪은 사고다.
//   2. 그래서 Geocoding 전용 키를 따로 발급해 Supabase Secrets(GOOGLE_GEOCODING_API_KEY)에만
//      두고, 앱은 로그인 사용자의 JWT로 이 함수를 호출한다.
//
// 남용 방지: 로그인만으로는 부족하다 — Geocoding은 호출당 과금되므로, **매물을 등록할 수
// 있는 계정**(admin 계열 또는 user_permissions.property_manage)만 호출할 수 있게 막는다.
// 일반 회원이 유출된 anon key로 이 함수를 두드려도 403으로 끝난다.

import { createClient } from "jsr:@supabase/supabase-js@2";

type GeocodeRequest = {
  address: string;
};

type GeocodeResponse = {
  latitude: number;
  longitude: number;
  /** Google이 정규화한 주소 — 화면에서 "이 주소가 맞는지" 확인시키는 용도. */
  formattedAddress: string;
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

/** 관리자 계열(properties RLS의 is_admin_or_above와 동일 기준). */
const ADMIN_ROLES = ["super_admin", "admin"];

/**
 * 이 사용자가 매물을 등록/수정할 수 있는가 — services/roles.ts canRegisterProperty()와
 * 같은 기준을 서버에서 다시 판정한다(클라이언트 판정은 보안 경계가 아니다).
 */
async function canRegisterProperty(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> {
  const [{ data: roles }, { data: permissions }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin
      .from("user_permissions")
      .select("permission_type")
      .eq("user_id", userId)
      .eq("enabled", true),
  ]);

  const isAdmin = (roles ?? []).some((row: { role: string }) => ADMIN_ROLES.includes(row.role));
  const hasPermission = (permissions ?? []).some(
    (row: { permission_type: string }) => row.permission_type === "property_manage",
  );
  return isAdmin || hasPermission;
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
  const googleApiKey = Deno.env.get("GOOGLE_GEOCODING_API_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server misconfigured" }, 500);
  }

  // 1. 인증 — 익명 호출 거부.
  const authHeader = req.headers.get("Authorization") ?? "";
  const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: "unauthorized" }, 401);
  }

  // 2. 권한 — 매물 등록 권한이 있는 계정만(과금 남용 방지).
  const admin = createClient(supabaseUrl, serviceRoleKey);
  if (!(await canRegisterProperty(admin, userData.user.id))) {
    return json({ error: "forbidden" }, 403);
  }

  let body: GeocodeRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const address = (body.address ?? "").trim();
  // 너무 짧은 주소는 아무 데나 찍히므로 호출 자체를 하지 않는다(무의미한 과금 방지).
  if (address.length < 4) {
    return json({ error: "address too short" }, 400);
  }

  if (!googleApiKey) {
    return json({ error: "geocoding key is not configured" }, 503);
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    // 베트남 내로 한정한다 — 같은 지명이 다른 나라에도 있어 엉뚱한 좌표가 나오는 것을 막는다.
    url.searchParams.set("components", "country:VN");
    url.searchParams.set("language", "vi");
    url.searchParams.set("key", googleApiKey);

    const response = await fetch(url.toString());
    const result = await response.json();

    if (result?.status === "ZERO_RESULTS") {
      return json({ error: "not found" }, 404);
    }
    if (result?.status !== "OK") {
      console.error("[geocode] google returned", result?.status, result?.error_message);
      // 키/할당량 문제를 클라이언트에 그대로 노출하지 않는다.
      return json({ error: "geocoding failed" }, 502);
    }

    const first = result.results?.[0];
    const location = first?.geometry?.location;
    if (typeof location?.lat !== "number" || typeof location?.lng !== "number") {
      return json({ error: "geocoding failed" }, 502);
    }

    return json({
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: first.formatted_address ?? address,
    } satisfies GeocodeResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[geocode] threw:", message);
    return json({ error: "geocoding failed" }, 502);
  }
});
