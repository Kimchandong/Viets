import { readImageBytes } from "@/utils/imageBytes";
import { supabase } from "./supabase";

/**
 * [2026-09-11 사용자 지시] 부동산 등록신청 — MY > 부동산 등록신청 → 관리자 승인.
 *
 * 테이블은 새로 만들지 않았다. 20260901071931_property_agency_foundation.sql의
 * agencies/agency_members/agency_permissions가 이미 이 모델이고, 이번에는 폼에만
 * 있던 항목(지역·담당자·전화·주소·첨부·반려사유)을 컬럼으로 더했을 뿐이다.
 *
 * 접수와 심사는 RPC로 한다 — 신청은 agencies와 agency_members를 함께 만들어야 하고,
 * 승인은 상태 변경과 권한 활성화를 함께 해야 한다. 어느 쪽도 반쪽만 성공하면 안 된다.
 */

export type AgencyApprovalStatus = "pending" | "approved" | "rejected" | "suspended";

export type MyAgency = {
  id: string;
  name: string;
  approvalStatus: AgencyApprovalStatus;
  region: string;
  contactName: string;
  phone: string;
  address: string;
  registrationNo: string;
  /** 반려됐을 때만 값이 있다 — 화면에 그대로 보여 준다. */
  rejectionReason: string;
};

const AGENCY_COLUMNS =
  "id,name,approval_status,region,contact_name,phone,address,business_registration_no,rejection_reason";

type AgencyRow = {
  id: string;
  name: string;
  approval_status: AgencyApprovalStatus;
  region: string | null;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  business_registration_no: string | null;
  rejection_reason: string | null;
};

function mapAgency(row: AgencyRow): MyAgency {
  return {
    id: row.id,
    name: row.name,
    approvalStatus: row.approval_status,
    region: row.region ?? "",
    contactName: row.contact_name ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    registrationNo: row.business_registration_no ?? "",
    rejectionReason: row.rejection_reason ?? "",
  };
}

/**
 * 내 등록신청 — 없으면 null(= 아직 신청하지 않음).
 *
 * agency_members를 기준으로 찾는다. RLS가 본인 멤버 행만 돌려주므로(agency_members_
 * select_own) 따로 user_id 조건을 걸지 않아도 남의 신청은 오지 않는다. 반려 후 다시
 * 신청하면 행이 둘이 되므로 **가장 최근 것**을 쓴다.
 */
export async function getMyAgency(): Promise<MyAgency | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("agency_members")
    .select(`agencies(${AGENCY_COLUMNS})`)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.warn("[services/agencies] getMyAgency failed:", error.message);
    return null;
  }

  // PostgREST는 임베드한 관계를 배열로 타이핑한다(FK가 1:1이라 실제로는 한 건).
  // 생성 타입과 런타임 모양이 어긋나므로 둘 다 받아 준다.
  const rows = (data ?? []) as unknown as { agencies: AgencyRow | AgencyRow[] | null }[];
  const embedded = rows[0]?.agencies;
  const found = Array.isArray(embedded) ? embedded[0] : embedded;
  return found ? mapAgency(found) : null;
}

export type AgencyApplicationInput = {
  name: string;
  region: string;
  contactName: string;
  phone: string;
  address: string;
  /** 중개번호가 없으면 빈 문자열 — 서버가 NULL로 저장한다. */
  registrationNo: string;
  /** agency-documents 버킷 안의 경로. 첨부하지 않았으면 빈 문자열. */
  licenseFilePath: string;
};

export type SubmitResult =
  | { ok: true; agencyId: string }
  | { ok: false; reason: "already-applied" | "failed" };

/** 등록신청 접수. 심사 중이거나 이미 승인된 신청이 있으면 already-applied. */
export async function submitAgencyApplication(
  input: AgencyApplicationInput,
): Promise<SubmitResult> {
  if (!supabase) {
    return { ok: false, reason: "failed" };
  }

  const { data, error } = await supabase.rpc("submit_agency_application", {
    p_name: input.name,
    p_region: input.region,
    p_contact_name: input.contactName,
    p_phone: input.phone,
    p_address: input.address,
    p_registration_no: input.registrationNo,
    p_license_file_path: input.licenseFilePath,
  });

  if (error) {
    // 함수가 raise한 문구가 그대로 message에 실려 온다 — 중복 신청만 따로 구분해
    // 화면에서 다른 문구를 보여 준다.
    if (error.message.includes("already-applied")) {
      return { ok: false, reason: "already-applied" };
    }
    console.warn("[services/agencies] submitAgencyApplication failed:", error.message);
    return { ok: false, reason: "failed" };
  }

  return { ok: true, agencyId: data as string };
}

const AGENCY_DOCUMENTS_BUCKET = "agency-documents";

/**
 * 중개번호 증빙 파일 업로드. 공개 URL이 아니라 **버킷 내부 경로**를 돌려준다 —
 * 이 버킷은 비공개라 URL을 만들어도 열리지 않고, 열람은 서명 URL로만 한다.
 *
 * 경로 앞머리가 반드시 본인 uuid여야 Storage 정책을 통과한다.
 */
export async function uploadAgencyDocument(localUri: string): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      return null;
    }

    const { bytes, contentType, fileExt } = await readImageBytes(localUri);
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

    const { error } = await supabase.storage
      .from(AGENCY_DOCUMENTS_BUCKET)
      .upload(path, bytes, { contentType });

    if (error) {
      console.warn("[services/agencies] uploadAgencyDocument failed:", error.message);
      return null;
    }
    return path;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/agencies] uploadAgencyDocument threw:", message);
    return null;
  }
}

/** 비공개 첨부를 잠깐 열어 보기 위한 서명 URL(10분). 실패하면 null. */
export async function getAgencyDocumentUrl(path: string): Promise<string | null> {
  if (!supabase || path.length === 0) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(AGENCY_DOCUMENTS_BUCKET)
    .createSignedUrl(path, 600);

  if (error) {
    console.warn("[services/agencies] getAgencyDocumentUrl failed:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/* ==========================================================================
 * 관리자 — 심사
 * ======================================================================== */

export type AdminAgency = MyAgency & {
  licenseFilePath: string;
  createdAt: string;
};

/**
 * 심사 화면용 신청 목록. 무엇이 보이는지는 RLS가 정한다(agencies_select_admin) —
 * 관리자가 아니면 자기 것만 돌아오므로 화면 쪽에서도 관리자만 진입시킨다.
 */
export async function listAgencyApplications(): Promise<AdminAgency[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("agencies")
    .select(`${AGENCY_COLUMNS},license_file_path,created_at`)
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/agencies] listAgencyApplications failed:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as (AgencyRow & {
    license_file_path: string | null;
    created_at: string;
  })[]).map((row) => ({
    ...mapAgency(row),
    licenseFilePath: row.license_file_path ?? "",
    createdAt: row.created_at,
  }));
}

/**
 * 승인/반려. 승인하면 서버가 property_listing·chat·account_active 권한까지 함께 켠다
 * — 상태만 바꾸면 "승인됐는데 매물 등록이 안 되는" 상태가 된다.
 */
export async function reviewAgency(
  agencyId: string,
  approve: boolean,
  reason?: string,
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.rpc("admin_review_agency", {
    target_agency: agencyId,
    approve,
    reason: reason ?? null,
  });

  if (error) {
    console.warn("[services/agencies] reviewAgency failed:", error.message);
    return false;
  }
  return true;
}
