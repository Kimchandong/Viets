import { supabase } from "./supabase";

/**
 * [2026-09-12 사용자 지시] 허위매물 신고.
 *
 * 매물 상세에서 신고하면 관리자 목록에 쌓인다. 같은 사람이 같은 매물을 여러 번
 * 신고하지 못하도록 DB가 (매물, 신고자)를 유일키로 막는다 — 중복 요청은 오류가 아니라
 * "이미 신고함"으로 돌려준다(사용자에게는 실패가 아니라 이미 접수된 상태다).
 */

export type ReportResult = "ok" | "already" | "not-logged-in" | "failed";

export async function reportProperty(propertyId: string): Promise<ReportResult> {
  if (!supabase) return "failed";

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return "not-logged-in";

  const { error } = await supabase
    .from("property_reports")
    .insert({ property_id: propertyId, reporter_id: userId });

  if (error) {
    // 23505 = unique 위반. 같은 매물을 다시 신고한 경우다.
    if (error.code === "23505") return "already";
    console.warn("[services/reports] reportProperty failed:", error.message);
    return "failed";
  }
  return "ok";
}

/**
 * 관리자 목록용 — **매물 단위로 묶은** 신고.
 *
 * 신고는 사람마다 하나씩 쌓이는데(같은 매물을 여러 사람이 신고할 수 있다), 그대로
 * 나열하면 같은 매물이 열 줄이 되어 읽을 수 없다. 관리자가 판단하는 단위는 "이 매물이
 * 허위인가"이므로 매물로 묶고 신고 건수를 함께 보여 준다.
 */
export type PropertyReportGroup = {
  propertyId: string;
  propertyTitle: string;
  /** 이 매물에 들어온 신고 건수(처리 여부 무관). */
  count: number;
  /** 아직 처리하지 않은 건수. 0이면 처리완료로 본다. */
  openCount: number;
  /** 가장 최근 신고 시각 — 목록 정렬과 표시에 쓴다. */
  latestAt: string;
};

type ReportRow = {
  id: string;
  property_id: string;
  status: string;
  created_at: string;
  properties: { title: string | null } | { title: string | null }[] | null;
};

/**
 * 신고 목록(매물 단위). 무엇이 보이는지는 RLS가 정한다 — 관리자는 전체.
 *
 * 묶는 일을 서버가 아니라 여기서 하는 이유: 집계 뷰를 따로 만들면 RLS를 한 번 더
 * 설계해야 하는데, 신고 건수는 한 화면에 담기는 규모라 굳이 그럴 이유가 없다.
 */
export async function listPropertyReports(): Promise<PropertyReportGroup[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("property_reports")
    .select("id, property_id, status, created_at, properties(title)")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("[services/reports] listPropertyReports failed:", error.message);
    return [];
  }

  const grouped = new Map<string, PropertyReportGroup>();
  for (const row of (data ?? []) as unknown as ReportRow[]) {
    const embedded = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const current = grouped.get(row.property_id);
    const isOpen = row.status !== "resolved";

    if (!current) {
      grouped.set(row.property_id, {
        propertyId: row.property_id,
        propertyTitle: embedded?.title ?? "",
        count: 1,
        openCount: isOpen ? 1 : 0,
        // 이미 created_at 내림차순이라 첫 행이 가장 최근이다.
        latestAt: row.created_at,
      });
      continue;
    }
    current.count += 1;
    if (isOpen) current.openCount += 1;
  }

  // 미처리가 위로, 그 안에서는 최근 신고 순.
  return [...grouped.values()].sort((a, b) => {
    if (a.openCount > 0 !== b.openCount > 0) return a.openCount > 0 ? -1 : 1;
    return a.latestAt < b.latestAt ? 1 : -1;
  });
}

/**
 * 관리자 전용 — 그 매물의 미처리 신고를 한 번에 처리완료로 바꾼다.
 * 매물 단위로 판단하므로 건별로 누르게 하면 같은 판단을 열 번 반복하게 된다.
 */
export async function resolvePropertyReports(propertyId: string): Promise<boolean> {
  if (!supabase) return false;

  const { data: sessionData } = await supabase.auth.getSession();
  const { error } = await supabase
    .from("property_reports")
    .update({
      status: "resolved",
      handled_by: sessionData.session?.user.id ?? null,
      handled_at: new Date().toISOString(),
    })
    .eq("property_id", propertyId)
    .eq("status", "open");

  if (error) {
    console.warn("[services/reports] resolvePropertyReports failed:", error.message);
    return false;
  }
  return true;
}
