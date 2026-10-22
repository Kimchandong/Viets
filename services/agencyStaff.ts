import { supabase } from "./supabase";

/**
 * [2026-10-22 사용자 지시] 직원관리 — 내 업체 소속 직원 추가/삭제.
 *
 * 권한 판정은 전부 서버가 한다(migration 20261022100000_agency_staff.sql):
 *   · 목록/검색은 owner만 부를 수 있는 RPC다 — owner가 아니면 예외가 돌아온다.
 *   · 추가/삭제는 RLS가 막는다. 여기서 한 번 더 검사하지 않는 이유: 두 곳에 규칙을
 *     두면 언젠가 어긋나고, 그때 느슨한 쪽이 통과한다.
 *
 * 이메일은 auth.users에 있어 클라이언트가 직접 읽을 수 없다 — 그래서 목록도 RPC다.
 */
export type AgencyStaff = {
  memberId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: "owner" | "staff";
  status: string;
};

export type AgencyUserSearchResult = {
  userId: string;
  email: string;
  displayName: string | null;
};

export async function listAgencyStaff(): Promise<AgencyStaff[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("agency_staff_list");
  if (error) {
    console.warn("[services/agencyStaff] listAgencyStaff failed:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    memberId: String(row.member_id),
    userId: String(row.user_id),
    email: String(row.email ?? ""),
    displayName: (row.display_name as string | null) ?? null,
    role: (row.role_in_agency as "owner" | "staff") ?? "staff",
    status: String(row.status ?? "active"),
  }));
}

export async function searchAgencyCandidates(search: string): Promise<AgencyUserSearchResult[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("agency_search_users", { search });
  if (error) {
    console.warn("[services/agencyStaff] searchAgencyCandidates failed:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    userId: String(row.user_id),
    email: String(row.email ?? ""),
    displayName: (row.display_name as string | null) ?? null,
  }));
}

/** 직원 추가. 업체 id는 서버가 정한다 — 클라이언트가 보내면 남의 업체에 넣을 수 있다. */
export async function addAgencyStaff(userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: agencyId, error: agencyError } = await supabase.rpc("my_owned_agency_id");
  if (agencyError || !agencyId) {
    console.warn("[services/agencyStaff] my_owned_agency_id failed:", agencyError?.message ?? "no agency");
    return false;
  }
  const { error } = await supabase.from("agency_members").insert({
    agency_id: agencyId as string,
    user_id: userId,
    role_in_agency: "staff",
    status: "active",
  });
  if (error) {
    console.warn("[services/agencyStaff] addAgencyStaff failed:", error.message);
    return false;
  }
  return true;
}

export async function removeAgencyStaff(memberId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("agency_members").delete().eq("id", memberId);
  if (error) {
    console.warn("[services/agencyStaff] removeAgencyStaff failed:", error.message);
    return false;
  }
  return true;
}
