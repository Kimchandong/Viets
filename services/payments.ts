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
  depositWithLicense: number;
  depositWithoutLicense: number;
  propertyRegisterFee: number;
  featuredDailyFee: number;
  /** 공개 버킷이라 바로 <Image>에 넣을 수 있는 URL. 등록 전이면 null. */
  qrImageUrl: string | null;
  qrImagePath: string;
  bankInfo: string;
  currency: string;
};

const PAYMENT_ASSETS_BUCKET = "payment-assets";

type SettingsRow = {
  deposit_with_license: number;
  deposit_without_license: number;
  property_register_fee: number;
  featured_daily_fee: number;
  qr_image_path: string | null;
  bank_info: string | null;
  currency: string;
};

export async function getPaymentSettings(): Promise<PaymentSettings | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("payment_settings")
    .select("deposit_with_license,deposit_without_license,property_register_fee,featured_daily_fee,qr_image_path,bank_info,currency")
    .eq("id", "default")
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/payments] getPaymentSettings failed:", error.message);
    return null;
  }

  const row = data as unknown as SettingsRow;
  const path = row.qr_image_path ?? "";
  return {
    depositWithLicense: Number(row.deposit_with_license),
    depositWithoutLicense: Number(row.deposit_without_license),
    propertyRegisterFee: Number(row.property_register_fee),
    featuredDailyFee: Number(row.featured_daily_fee),
    qrImagePath: path,
    qrImageUrl:
      path.length > 0
        ? supabase.storage.from(PAYMENT_ASSETS_BUCKET).getPublicUrl(path).data?.publicUrl ?? null
        : null,
    bankInfo: row.bank_info ?? "",
    currency: row.currency,
  };
}

/** 관리자 전용 — 금액/계좌 안내 저장. 실제 차단은 payment_settings UPDATE 정책이 한다. */
export async function updatePaymentSettings(input: {
  depositWithLicense: number;
  depositWithoutLicense: number;
  propertyRegisterFee: number;
  featuredDailyFee: number;
  bankInfo: string;
  qrImagePath?: string;
}): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase
    .from("payment_settings")
    .update({
      deposit_with_license: input.depositWithLicense,
      deposit_without_license: input.depositWithoutLicense,
      property_register_fee: input.propertyRegisterFee,
      featured_daily_fee: input.featuredDailyFee,
      bank_info: input.bankInfo,
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
  | { ok: false; reason: "already-pending" | "not-approved-agency" | "failed" };

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

/** 관리자 전용 — 입금 확인 승인(잔액 반영) 또는 반려. */
export async function reviewPayment(
  requestId: string,
  approve: boolean,
  reason?: string,
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.rpc("admin_review_payment", {
    target_request: requestId,
    approve,
    reason: reason ?? null,
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

/** 내 업체의 잔액 — MY 상단 표시용. 승인된 Agency가 없으면 null. */
export async function getMyBalance(): Promise<AgencyBalance | null> {
  const agency = await getMyAgency();
  if (!agency || agency.approvalStatus !== "approved") {
    return null;
  }
  return getAgencyBalance(agency.id);
}
