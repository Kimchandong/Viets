import { getMyAgency } from "./agencies";
import { supabase } from "./supabase";

/**
 * [STEP 04] 현재 로그인 사용자의 내부 운영 role 조회 — DATABASE.md §1 user_roles.
 *
 * 매물 등록 화면(app/property-register.tsx) 진입 노출 여부를 판단하는 용도다.
 * user_roles의 RLS는 Owner-Only SELECT라, 이 조회는 "본인 role"만 돌려준다
 * (다른 사용자 role은 애초에 보이지 않는다).
 *
 * 주의: 이 값은 **화면 노출 판단용일 뿐 보안 경계가 아니다.** 실제 등록 권한은
 * properties 테이블의 RLS(is_admin_or_above() / can_manage_agency_property())가
 * 서버에서 최종 판정한다 — 클라이언트가 이 함수를 우회해도 INSERT 자체가 거부된다.
 */

export type UserRole = "super_admin" | "admin" | "editor" | "reviewer" | "operator" | "user";

/** DB의 user_permission_type enum과 1:1. 관리자가 계정별로 켜고 끄는 기능 권한이다. */
export type UserPermissionType = "investment_manage" | "property_manage";

/** 관리자 계열(properties/investment_products RLS의 is_admin_or_above와 동일 기준). */
const ADMIN_ROLES: UserRole[] = ["super_admin", "admin"];

export async function fetchMyRoles(): Promise<UserRole[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.from("user_roles").select("role");

  if (error) {
    console.warn("[services/roles] fetchMyRoles failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => (row as { role: UserRole }).role);
}

/** 관리자가 나에게 부여한 기능 권한(활성 상태만). RLS Owner-Only라 본인 것만 돌아온다. */
export async function fetchMyPermissions(): Promise<UserPermissionType[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("user_permissions")
    .select("permission_type")
    .eq("enabled", true);

  if (error) {
    console.warn("[services/roles] fetchMyPermissions failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => (row as { permission_type: UserPermissionType }).permission_type);
}

export async function isAdmin(): Promise<boolean> {
  const roles = await fetchMyRoles();
  return roles.some((role) => ADMIN_ROLES.includes(role));
}

/**
 * 매물 등록/수정 진입점을 노출할지 여부 — 세 갈래 중 하나면 된다.
 *   · admin 계열
 *   · 관리자가 계정별로 켜 준 `property_manage` 권한
 *   · [2026-09-11] 부동산 등록신청이 **승인된** Agency 소속
 *
 * 세 번째가 이번에 붙은 정식 경로다(MY > 부동산 등록신청 → 관리자 승인). 승인 시점에
 * 서버가 agency_permissions.property_listing까지 함께 켜므로 여기서는 승인 상태만 봐도
 * 된다 — 실제 등록 가능 여부는 properties RLS가 그 권한을 보고 최종 판정한다.
 */
export async function canRegisterProperty(): Promise<boolean> {
  const [roles, permissions, agency] = await Promise.all([
    fetchMyRoles(),
    fetchMyPermissions(),
    getMyAgency(),
  ]);
  return (
    roles.some((role) => ADMIN_ROLES.includes(role)) ||
    permissions.includes("property_manage") ||
    agency?.approvalStatus === "approved"
  );
}

/**
 * 투자상품 등록/수정/삭제 진입점을 노출할지 여부 — admin 계열이거나
 * `investment_manage` 권한 보유자(직원/운영자/특정 투자자 등 관리자가 지정한 계정).
 */
export async function canManageInvestment(): Promise<boolean> {
  const [roles, permissions] = await Promise.all([fetchMyRoles(), fetchMyPermissions()]);
  return roles.some((role) => ADMIN_ROLES.includes(role)) || permissions.includes("investment_manage");
}

/** 관리자 권한 관리 화면(app/admin-permissions.tsx)의 계정 검색 결과 한 줄. */
export type AdminUserSearchResult = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  investment_manage: boolean;
  property_manage: boolean;
};

/**
 * 관리자 전용 계정 검색(이메일/표시이름 부분일치).
 *
 * auth.users와 남의 profiles는 클라이언트 RLS로 조회할 수 없어, DB의 SECURITY DEFINER
 * 함수 `admin_search_users`를 RPC로 호출한다 — 관리자 여부와 검색어 길이(2자 이상)를
 * 서버가 직접 검사한다.
 */
export async function adminSearchUsers(search: string): Promise<AdminUserSearchResult[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("admin_search_users", { search });

  if (error) {
    console.warn("[services/roles] adminSearchUsers failed:", error.message);
    return [];
  }
  return (data ?? []) as AdminUserSearchResult[];
}

/** 관리자가 특정 계정의 기능 권한을 켜거나 끈다(없으면 생성). */
export async function adminSetUserPermission(
  userId: string,
  permission: UserPermissionType,
  enabled: boolean,
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase.rpc("admin_set_user_permission", {
    target_user: userId,
    target_permission: permission,
    next_enabled: enabled,
  });

  if (error) {
    console.warn("[services/roles] adminSetUserPermission failed:", error.message);
    return false;
  }
  return true;
}
