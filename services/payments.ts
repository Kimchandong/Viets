import { readImageBytes } from "@/utils/imageBytes";
import { getMyAgency } from "./agencies";
import { supabase } from "./supabase";

/**
 * [2026-09-11 사용자 지시] 결제·QR 입금·잔액 (2단계).
 *
 * 용어(사용자 정의 그대로):
 *   사용잔액 = 지금 쓸 수 있는 돈 (총 입금 − 총 사용)  → MY 상단에 크게(주황)
 *   현잔액   = 지금까지 입금한 누적 금액               → 그 아래 작게(회색)
 *
 * 잔액은 balance_entries 원장의 합계다 — 이 파일은 숫자를 직접 계산하지 않고 서버
 * 함수(agency_balance)를 부른다. 클라이언트가 잔액을 계산하기 시작하면 화면마다 값이
 * 달라지고, 무엇보다 원장을 우회한 값이 생긴다.
 */

export type PaymentSettings = {
  /** 등록비(중개업소) — 중개번호를 등록한 업체의 매물 1건당 차감액. */
  registerFeeAgency: number;
  /** 등록비(일반) — 중개번호가 없는 업체의 매물 1건당 차감액. */
  registerFeeGeneral: number;
  /** [사용 안 함 — 2026-09-12] 기간제 추천매물 1일 요금. 금액 순위로 대체됐다. */
  featuredDailyFee: number;
  /** [2026-09-12] 추천매물 자리 최소 진입금액. */
  featuredMinBid: number;
  /** [2026-09-12] TOP10 자리 최소 진입금액. */
  top10MinBid: number;
  /** [2026-09-12 사용자 지시] 입금 신고 1건의 최소 금액(상한 없음). */
  minDeposit: number;
  /** 공개 버킷이라 바로 <Image>에 넣을 수 있는 URL. 등록 전이면 null. */
  qrImageUrl: string | null;
  qrImagePath: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  currency: string;
};

const PAYMENT_ASSETS_BUCKET = "payment-assets";

type SettingsRow = {
  register_fee_agency: number;
  register_fee_general: number;
  featured_daily_fee: number;
  featured_min_bid: number;
  top10_min_bid: number;
  min_deposit: number;
  qr_image_path: string | null;
  bank_name: string | null;
  account_holder: string | null;
  account_number: string | null;
  currency: string;
};

export async function getPaymentSettings(): Promise<PaymentSettings | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("payment_settings")
    .select(
      "register_fee_agency,register_fee_general,featured_daily_fee,featured_min_bid,top10_min_bid,min_deposit,qr_image_path,bank_name,account_holder,account_number,currency",
    )
    .eq("id", "default")
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/payments] getPaymentSettings failed:", error.message);
    return null;
  }

  const row = data as unknown as SettingsRow;
  const path = row.qr_image_path ?? "";
  return {
    registerFeeAgency: Number(row.register_fee_agency),
    registerFeeGeneral: Number(row.register_fee_general),
    featuredDailyFee: Number(row.featured_daily_fee),
    featuredMinBid: Number(row.featured_min_bid ?? 0),
    top10MinBid: Number(row.top10_min_bid ?? 0),
    minDeposit: Number(row.min_deposit ?? 0),
    qrImagePath: path,
    qrImageUrl:
      path.length > 0
        ? supabase.storage.from(PAYMENT_ASSETS_BUCKET).getPublicUrl(path).data?.publicUrl ?? null
        : null,
    bankName: row.bank_name ?? "",
    accountHolder: row.account_holder ?? "",
    accountNumber: row.account_number ?? "",
    currency: row.currency,
  };
}

/** 관리자 전용 — 금액/계좌 안내 저장. 실제 차단은 payment_settings UPDATE 정책이 한다. */
export async function updatePaymentSettings(input: {
  registerFeeAgency: number;
  registerFeeGeneral: number;
  featuredMinBid: number;
  top10MinBid: number;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  qrImagePath?: string;
}): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase
    .from("payment_settings")
    .update({
      register_fee_agency: input.registerFeeAgency,
      register_fee_general: input.registerFeeGeneral,
      featured_min_bid: input.featuredMinBid,
      top10_min_bid: input.top10MinBid,
      bank_name: input.bankName,
      account_holder: input.accountHolder,
      account_number: input.accountNumber,
      ...(input.qrImagePath !== undefined ? { qr_image_path: input.qrImagePath } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");

  if (error) {
    console.warn("[services/payments] updatePaymentSettings failed:", error.message);
    return false;
  }
  return true;
}

/** 관리자 전용 — QR 이미지 업로드. 공개 버킷이라 경로만 저장하면 바로 보인다. */
export async function uploadQrImage(localUri: string): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { bytes, contentType, fileExt } = await readImageBytes(localUri);
    const path = `qr/${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage
      .from(PAYMENT_ASSETS_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });

    if (error) {
      console.warn("[services/payments] uploadQrImage failed:", error.message);
      return null;
    }
    return path;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/payments] uploadQrImage threw:", message);
    return null;
  }
}

/* ==========================================================================
 * 잔액
 * ======================================================================== */

export type AgencyBalance = {
  /** 현잔액 — 지금까지 입금한 누적 금액. */
  totalDeposited: number;
  totalSpent: number;
  /** 사용잔액 — 지금 쓸 수 있는 돈. */
  available: number;
};

export async function getAgencyBalance(agencyId: string): Promise<AgencyBalance | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.rpc("agency_balance", { target_agency: agencyId });

  if (error) {
    console.warn("[services/payments] getAgencyBalance failed:", error.message);
    return null;
  }

  // 함수가 table을 돌려주므로 배열 한 건으로 온다.
  const row = (data as { total_deposited: number; total_spent: number; available: number }[] | null)?.[0];
  if (!row) {
    return { totalDeposited: 0, totalSpent: 0, available: 0 };
  }
  return {
    totalDeposited: Number(row.total_deposited),
    totalSpent: Number(row.total_spent),
    available: Number(row.available),
  };
}

/* ==========================================================================
 * 입금 신고
 * ======================================================================== */

export type PaymentRequestStatus = "pending" | "approved" | "rejected";

export type PaymentRequest = {
  id: string;
  agencyId: string;
  agencyName: string;
  amount: number;
  status: PaymentRequestStatus;
  note: string;
  rejectReason: string;
  createdAt: string;
};

export type SubmitPaymentResult =
  | { ok: true }
  | {
      ok: false;
      reason: "already-pending" | "not-approved-agency" | "below-min-deposit" | "failed";
    };

/**
 * "입금했습니다" 신고. 실제 입금은 은행에서 일어나므로 앱이 할 수 있는 것은 신고를
 * 받아 관리자 목록에 올리는 것까지다 — 잔액은 관리자가 확인 후 승인할 때 생긴다.
 */
export async function submitPaymentRequest(
  amount: number,
  note: string,
): Promise<SubmitPaymentResult> {
  if (!supabase) {
    return { ok: false, reason: "failed" };
  }

  const { error } = await supabase.rpc("submit_payment_request", {
    p_amount: amount,
    p_note: note,
  });

  if (error) {
    if (error.message.includes("already-pending")) return { ok: false, reason: "already-pending" };
    if (error.message.includes("not-approved-agency")) {
      return { ok: false, reason: "not-approved-agency" };
    }
    if (error.message.includes("below-min-deposit")) {
      return { ok: false, reason: "below-min-deposit" };
    }
    console.warn("[services/payments] submitPaymentRequest failed:", error.message);
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}

type RequestRow = {
  id: string;
  agency_id: string;
  amount: number;
  status: PaymentRequestStatus;
  note: string | null;
  reject_reason: string | null;
  created_at: string;
  agencies: { name: string } | { name: string }[] | null;
};

function mapRequest(row: RequestRow): PaymentRequest {
  const agency = Array.isArray(row.agencies) ? row.agencies[0] : row.agencies;
  return {
    id: row.id,
    agencyId: row.agency_id,
    agencyName: agency?.name ?? "",
    amount: Number(row.amount),
    status: row.status,
    note: row.note ?? "",
    rejectReason: row.reject_reason ?? "",
    createdAt: row.created_at,
  };
}

/**
 * 입금 신고 목록. 무엇이 보이는지는 RLS가 정한다 — 관리자는 전체, 중개업소는 자기
 * 업체 것만. 그래서 관리자 화면과 본인 확인용에 같은 함수를 쓴다.
 */
export async function listPaymentRequests(): Promise<PaymentRequest[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("payment_requests")
    .select("id,agency_id,amount,status,note,reject_reason,created_at,agencies(name)")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/payments] listPaymentRequests failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as RequestRow[]).map(mapRequest);
}

/**
 * 관리자 전용 — 입금 확인 승인(잔액 반영) 또는 반려.
 *
 * [2026-09-12 사용자 지시] amount를 주면 신고 금액 대신 **실제 입금된 금액**으로
 * 잔액을 올리고 신고 행도 그 금액으로 고친다 — 신고와 송금이 어긋나는 경우가 있다.
 */
export async function reviewPayment(
  requestId: string,
  approve: boolean,
  reason?: string,
  amount?: number,
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.rpc("admin_review_payment", {
    target_request: requestId,
    approve,
    reason: reason ?? null,
    p_amount: amount ?? null,
  });

  if (error) {
    console.warn("[services/payments] reviewPayment failed:", error.message);
    return false;
  }
  return true;
}

/* ==========================================================================
 * 사용(차감)
 * ======================================================================== */

/**
 * 매물 등록 요금 차감. **false면 잔액이 모자라 요금을 물리지 못했다는 뜻이고, 서버가
 * 그 매물을 미노출(draft)로 내려 둔 상태다**(사용자 결정: 등록은 하되 미노출로 저장).
 * 요금이 0이거나 Agency 없이 등록한 계정은 차감 없이 true.
 */
export async function chargePropertyRegister(propertyId: string): Promise<boolean> {
  if (!supabase) {
    return true;
  }

  const { data, error } = await supabase.rpc("charge_property_register", {
    p_property_id: propertyId,
  });

  if (error) {
    console.warn("[services/payments] chargePropertyRegister failed:", error.message);
    // 차감에 실패했다고 등록 자체를 실패로 돌리지 않는다 — 매물은 이미 만들어졌다.
    return true;
  }
  return data as boolean;
}

/** 추천 매물 기간 구매(1일 요금 × 일수). 잔액이 모자라면 false이고 아무것도 바뀌지 않는다. */
export async function purchaseFeatured(propertyId: string, days: number): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { data, error } = await supabase.rpc("purchase_featured", {
    p_property_id: propertyId,
    p_days: days,
  });

  if (error) {
    console.warn("[services/payments] purchaseFeatured failed:", error.message);
    return false;
  }
  return data as boolean;
}

/**
 * 아직 안내하지 않은 반려 건 — MY에 "환불예정" 문구를 띄우기 위해 쓴다.
 * 가장 최근 반려 1건만 본다(그 앞의 것은 이미 처리가 끝난 이야기다).
 */
export async function getLatestRejectedPayment(): Promise<PaymentRequest | null> {
  const requests = await listPaymentRequests();
  return requests.find((request) => request.status === "rejected") ?? null;
}

/** 내 업체의 잔액 — MY 상단 표시용. 승인된 Agency가 없으면 null. */
export async function getMyBalance(): Promise<AgencyBalance | null> {
  const agency = await getMyAgency();
  if (!agency || agency.approvalStatus !== "approved") {
    return null;
  }
  return getAgencyBalance(agency.id);
}

/* ==========================================================================
 * 광고내역 — 무엇에 얼마가 쓰였는가
 * ======================================================================== */

// [2026-09-12] top10 추가 — 광고 자리 구매(추천/TOP10)가 각각 별도 종류로 남는다.
export type BalanceEntryKind =
  | "deposit"
  | "property_register"
  | "featured"
  | "top10"
  | "adjustment";

export type BalanceEntry = {
  id: string;
  kind: BalanceEntryKind;
  /** 입금은 +, 사용은 −. */
  amount: number;
  /** 매물 때문에 생긴 줄이면 그 매물 이름. 아니면 빈 문자열. */
  propertyTitle: string;
  memo: string;
  createdAt: string;
};

/**
 * [2026-09-11 사용자 지시 — 5차] 광고내역 — 매물명과 차감액.
 *
 * balance_entries.ref_id는 매물 id를 담지만 properties를 향한 FK가 아니다(입금
 * 신고 id도 같은 칸에 들어간다). FK가 없으면 PostgREST로 한 번에 조인할 수 없어,
 * 매물 이름은 id를 모아 한 번 더 조회해 붙인다 — 줄마다 부르지 않는다.
 */
export async function listBalanceEntries(agencyId: string): Promise<BalanceEntry[]> {
  if (!supabase || agencyId.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("balance_entries")
    .select("id,kind,amount,ref_id,memo,created_at")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/payments] listBalanceEntries failed:", error.message);
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    kind: BalanceEntryKind;
    amount: number;
    ref_id: string | null;
    memo: string | null;
    created_at: string;
  }[];

  const propertyIds = Array.from(
    new Set(
      rows
        .filter((row) => row.kind === "property_register" || row.kind === "featured")
        .map((row) => row.ref_id)
        .filter((id): id is string => !!id),
    ),
  );

  const titles = new Map<string, string>();
  if (propertyIds.length > 0) {
    const { data: properties } = await supabase
      .from("properties")
      .select("id,title")
      .in("id", propertyIds);
    for (const property of (properties ?? []) as { id: string; title: string }[]) {
      titles.set(property.id, property.title);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    amount: Number(row.amount),
    propertyTitle: row.ref_id ? (titles.get(row.ref_id) ?? "") : "",
    memo: row.memo ?? "",
    createdAt: row.created_at,
  }));
}
