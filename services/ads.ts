import { supabase } from "./supabase";

/**
 * [2026-09-12 사용자 지시] 광고 자리 — 추천매물 / TOP10.
 *
 * 오버추어식 **클릭당 과금**이다.
 *   · 순위에 적는 금액 = 고객이 그 매물을 한 번 눌렀을 때 빠져나가는 금액(클릭 단가).
 *     자리에 들어갈 때는 아무것도 차감하지 않는다.
 *   · 노출 자리: 추천 5개, TOP10 10개. 그 아래로 밀리면 보이지 않으므로 과금도 없다.
 *   · 잔액이 없는 업체의 매물은 순위에서 자동으로 빠지고, 마지막 클릭에서는 남은
 *     잔액만큼만 차감된다(화면 이동은 그대로).
 *
 * 순위/노출 판정을 클라이언트에서 하지 않는 이유: 잔액은 남의 업체 것을 읽을 수
 * 없고(RLS), 정렬 규칙이 화면마다 흩어지면 같은 목록이 다르게 보인다. DB 함수
 * active_ad_slots 하나가 "지금 실제로 보이는 자리"를 정한다.
 */

export type AdPlacement = "featured" | "top10";

/** 노출 자리 수 — DB의 ad_slot_capacity()와 같은 값이어야 한다. */
export const AD_SLOT_CAPACITY: Record<AdPlacement, number> = {
  featured: 5,
  top10: 10,
};

export type AdSlot = {
  rank: number;
  propertyId: string;
  /** 매물명 — 순위표에 "어떤 매물이 그 자리에 있는지" 보여 준다. */
  title: string;
  /** 클릭 1회당 차감 금액. */
  clickFee: number;
};

type SlotRow = {
  property_id: string;
  bid_amount: number | string;
  properties: { title: string | null } | { title: string | null }[] | null;
};

/**
 * 순위표 — 자리 수를 넘어 밀려난 매물까지 전부. 광고를 사는 쪽은 "지금 몇 위이고
 * 얼마를 더 내야 올라가는지"를 봐야 하므로 노출되는 것만 보여 주면 판단할 수 없다.
 */
export async function listAdSlots(placement: AdPlacement): Promise<AdSlot[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("property_ad_slots")
    .select("property_id, bid_amount, properties(title)")
    .eq("placement", placement)
    .order("bid_amount", { ascending: false })
    .order("updated_at", { ascending: true });

  if (error) {
    console.warn("[services/ads] listAdSlots failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as SlotRow[];
  return rows
    .map((row) => {
      // PostgREST는 임베드한 관계를 배열로 타이핑한다.
      const embedded = Array.isArray(row.properties) ? row.properties[0] : row.properties;
      return {
        propertyId: row.property_id,
        title: embedded?.title ?? "",
        clickFee: Number(row.bid_amount ?? 0),
      };
    })
    .filter((slot) => slot.title.length > 0)
    .map((slot, index) => ({ ...slot, rank: index + 1 }));
}

/**
 * 지금 실제로 노출되는 자리 — 잔액이 남은 업체의 공개 매물만, 자리 수만큼.
 * 홈/부동산 화면이 그릴 목록의 기준이다.
 */
export async function listActiveAdSlots(placement: AdPlacement): Promise<string[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("active_ad_slots", { p_placement: placement });
  if (error) {
    console.warn("[services/ads] listActiveAdSlots failed:", error.message);
    return [];
  }
  const rows = (data ?? []) as { property_id: string }[];
  return rows.map((row) => row.property_id);
}

/** 내 매물이 그 자리에 적어 둔 클릭 단가. 없으면 0. */
export async function getMyBid(propertyId: string, placement: AdPlacement): Promise<number> {
  if (!supabase) return 0;

  const { data, error } = await supabase
    .from("property_ad_slots")
    .select("bid_amount")
    .eq("property_id", propertyId)
    .eq("placement", placement)
    .maybeSingle();

  if (error) {
    console.warn("[services/ads] getMyBid failed:", error.message);
    return 0;
  }
  return Number(data?.bid_amount ?? 0);
}

/**
 * `not-active`: 거래완료·보류 매물은 고객 화면에 나오지 않으므로 광고 자리를 살 수 없다
 * (서버가 막는다 — 화면에서 목록을 걸러도 RPC를 직접 부르는 길이 남기 때문).
 */
export type SetAdBidResult =
  | "ok"
  | "too-low"
  | "no-balance"
  | "no-agency"
  | "not-active"
  | "failed";

/**
 * 클릭 단가 설정/변경. 이 시점에는 차감되지 않는다.
 *
 * 엣지 함수(ad-bid)를 거치는 이유: 이 호출로 다른 업체가 순위에서 밀려날 수 있고,
 * 밀려난 쪽에 푸시를 보내야 한다. DB에서는 외부로 알림을 보낼 수 없다.
 * 권한 확인은 그대로 DB가 한다 — 엣지 함수가 호출자의 JWT로 RPC를 실행한다.
 */
export async function setAdBid(
  propertyId: string,
  placement: AdPlacement,
  amount: number,
): Promise<SetAdBidResult> {
  if (!supabase) return "failed";

  const { data, error } = await supabase.functions.invoke("ad-bid", {
    body: { propertyId, placement, amount },
  });

  if (error) {
    console.warn("[services/ads] setAdBid failed:", error.message);
    return "failed";
  }
  const result = String((data as { result?: string } | null)?.result ?? "");
  return result === "ok" ||
    result === "too-low" ||
    result === "no-balance" ||
    result === "no-agency" ||
    result === "not-active"
    ? result
    : "failed";
}

/**
 * 광고로 노출된 매물을 고객이 눌렀을 때의 과금.
 *
 * DB 함수를 직접 부르지 않고 엣지 함수(ad-click)를 거치는 이유: 클릭 어뷰징을
 * 막으려면 요청 IP가 필요한데, 앱이 스스로 보내는 값은 위조할 수 있다. 서버가
 * 헤더에서 읽어 해시한 값만 신뢰한다. 잔액이 0이 되면 그 함수가 푸시까지 보낸다.
 *
 * 반환값(차감액)을 화면이 기다리지 않도록 호출부는 await 없이 보내고 바로 이동해도
 * 된다 — 과금 실패가 고객의 이동을 막아서는 안 된다(사용자 결정).
 */
export async function chargeAdClick(
  propertyId: string,
  placement: AdPlacement,
): Promise<number> {
  if (!supabase) return 0;

  const { data, error } = await supabase.functions.invoke("ad-click", {
    body: { propertyId, placement },
  });

  if (error) {
    console.warn("[services/ads] chargeAdClick failed:", error.message);
    return 0;
  }

  const result = data as { charged?: number; error?: string } | null;
  // [2026-09-12] 서버가 "과금하려다 실패했다"고 알려 주면 남긴다. 이 표시가 없던 동안
  // service_role 권한 누락으로 모든 클릭 과금이 조용히 0이 되고 있었다.
  if (result?.error) {
    console.warn("[services/ads] chargeAdClick server error:", result.error);
  }
  return Number(result?.charged ?? 0);
}

export type AdNotification = {
  id: string;
  kind: string;
  createdAt: string;
};

/** 읽지 않은 광고 알림(지금은 '잔액 소진' 한 종류). */
export async function listUnreadAdNotifications(): Promise<AdNotification[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("ad_notifications")
    .select("id, kind, created_at")
    .is("read_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/ads] listUnreadAdNotifications failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    createdAt: String(row.created_at),
  }));
}

/** 알림을 읽음 처리 — 같은 안내가 화면을 열 때마다 다시 뜨지 않게 한다. */
export async function markAdNotificationRead(id: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("ad_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.warn("[services/ads] markAdNotificationRead failed:", error.message);
  }
}
