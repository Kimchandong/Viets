import { hasSession, supabase } from "./supabase";

/**
 * [2026-09-11 사용자 지시] 홈 상단 우측 알림 — 부동산(상담 미읽음) / 투자(신규 상품).
 *
 * 이전에는 종 아이콘 하나에 constants/mockData.ts의 MOCK_UNREAD_NOTIFICATION_COUNT라는
 * **고정값**이 붙어 있었다. 무엇을 눌러도 숫자가 변하지 않았고 눌러도 "준비 중"이었다.
 *
 * 세는 일은 전부 DB 함수가 한다(20260911171500_read_marks.sql). 클라이언트에서
 * 메시지를 전부 받아 세면 대화가 늘수록 받는 양이 늘고, 무엇보다 "어떤 대화가 내게
 * 보이는가"를 앱이 다시 판단하게 되어 서버의 RLS 판단과 어긋날 수 있다.
 *
 * 실패하면 0을 돌려준다 — 알림 숫자 때문에 화면이 막히면 안 된다.
 */

export type ReadScope = "property_chat" | "investment_list";

async function callCount(
  fn: "my_unread_chat_count" | "my_new_investment_count" | "my_unread_notification_count",
): Promise<number> {
  if (!supabase) return 0;
  // [2026-09-12] 비로그인 상태에서는 세는 대상 자체가 없다. 그대로 부르면 RPC 안에서
  // permission denied가 나고(함수가 invoker 권한이다) 콘솔만 더러워진다.
  if (!(await hasSession())) return 0;

  const { data, error } = await supabase.rpc(fn);
  if (error) {
    console.warn(`[services/notifications] ${fn} failed:`, error.message);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

/** 내가 아직 읽지 않은 상담 메시지 수. 로그인하지 않았으면 0이다. */
export async function getUnreadChatCount(): Promise<number> {
  return callCount("my_unread_chat_count");
}

/** 마지막으로 투자 목록을 본 뒤 등록된 상품 수. 기록이 없으면 최근 7일치. */
export async function getNewInvestmentCount(): Promise<number> {
  return callCount("my_new_investment_count");
}

/**
 * 지금 시각까지 읽은 것으로 표시한다.
 *
 * 비로그인 상태에서는 조용히 아무것도 하지 않는다 — 읽음은 사용자별 기록이라
 * 남길 대상이 없고, 화면 쪽에서 로그인 여부를 다시 확인하게 만들 이유가 없다.
 */
export async function markRead(scope: ReadScope, refKey = ""): Promise<void> {
  if (!supabase) return;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return;

  const { error } = await supabase.rpc("mark_read", {
    target_scope: scope,
    target_ref: refKey,
  });
  if (error) {
    console.warn("[services/notifications] mark_read failed:", error.message);
  }
}

// ============================================================================
// [2026-09-12] 알림 수신함
// ============================================================================
//
// 홈 배지(위)는 "안 읽은 것이 몇 개인가"만 다루고, 여기부터는 "무엇이 있었는가"를
// 다룬다. 둘을 한 파일에 두는 이유는 사용자에게는 같은 '알림'이기 때문이다.
//
// 문구는 DB에 없다. 서버는 kind(종류)와 params(값)만 남기고, 문장은 앱이 i18n으로
// 만든다 — 앱은 6개 언어이므로 문장을 저장하면 다른 언어 사용자가 남의 언어를 읽게
// 된다. 언어를 바꾸면 지난 알림까지 함께 바뀐다.

/** 서버가 남기는 알림 종류. i18n 키 `notifications.kind.<kind>`와 1:1이다. */
export const NOTIFICATION_KINDS = [
  "ad_balance_empty",
  "ad_slot_dropped",
  "agency_approved",
  "agency_rejected",
  "payment_approved",
  "payment_rejected",
  "qa_answered",
  "report_resolved",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type AppNotification = {
  id: string;
  kind: string;
  /** 문구에 끼워 넣을 값(금액, 업체명 등). 종류마다 다르다. */
  params: Record<string, string | number>;
  /** 누르면 갈 앱 내 경로. 없으면 넘어가지 않는다. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  kind: string;
  params: Record<string, unknown> | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/** 내 알림 목록. 무엇이 보이는지는 RLS가 정한다 — 여기서 user_id로 거르지 않는다. */
export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  if (!supabase) return [];
  if (!(await hasSession())) return [];

  const { data, error } = await supabase
    .from("user_notifications")
    .select("id,kind,params,link,read_at,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[services/notifications] listNotifications failed:", error.message);
    return [];
  }

  return ((data ?? []) as NotificationRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    params: (row.params ?? {}) as Record<string, string | number>,
    link: row.link,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

/** 안 읽은 알림 수. 실패하면 0 — 숫자 하나 때문에 화면이 막히면 안 된다. */
export async function getUnreadNotificationCount(): Promise<number> {
  return callCount("my_unread_notification_count");
}

/** 한 건 읽음. 목록에서 열 때 부른다. */
export async function markNotificationRead(id: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);

  if (error) {
    console.warn("[services/notifications] markNotificationRead failed:", error.message);
  }
}

/** 전부 읽음. 목록 상단 버튼용 — 하나씩 누르게 하면 쌓인 알림을 치울 방법이 없다. */
export async function markAllNotificationsRead(): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  if (error) {
    console.warn("[services/notifications] markAllNotificationsRead failed:", error.message);
  }
}

/** 한 건 삭제. 읽고 치우는 목록이라 이력을 남기지 않는다. */
export async function deleteNotification(id: string): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase.from("user_notifications").delete().eq("id", id);
  if (error) {
    console.warn("[services/notifications] deleteNotification failed:", error.message);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 종류별 수신 설정
// ---------------------------------------------------------------------------
// 행이 없으면 켜진 것으로 본다(기본 수신). 끈 사람만 행이 생긴다.

/** 꺼 둔 종류들. 여기 없는 종류는 전부 켜져 있다. */
export async function listDisabledNotificationKinds(): Promise<string[]> {
  if (!supabase) return [];
  if (!(await hasSession())) return [];

  const { data, error } = await supabase
    .from("notification_preferences")
    .select("kind,enabled")
    .eq("enabled", false);

  if (error) {
    console.warn("[services/notifications] listDisabledNotificationKinds failed:", error.message);
    return [];
  }
  return ((data ?? []) as { kind: string }[]).map((row) => row.kind);
}

/** 종류 하나를 켜거나 끈다. */
export async function setNotificationKindEnabled(
  kind: string,
  enabled: boolean,
): Promise<boolean> {
  if (!supabase) return false;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return false;

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(
      { user_id: userId, kind, enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id,kind" },
    );

  if (error) {
    console.warn("[services/notifications] setNotificationKindEnabled failed:", error.message);
    return false;
  }
  return true;
}

/**
 * [2026-09-12] 방금 만들어진 알림을 푸시로 내보낸다 — **관리자 화면에서만** 부른다.
 *
 * DB는 외부로 HTTP를 보낼 수 없어 트리거가 직접 푸시를 보낼 수 없다. 알림이 생기는
 * 지점은 지금 전부 "관리자가 승인/반려/답변을 누른 결과"이므로, 누른 쪽이 곧바로 한 번
 * 부르는 것이 가장 단순하다(pg_net을 켜고 DB에 호출용 비밀값을 두는 것보다 낫다).
 *
 * dedupeKey는 서버 트리거가 넣은 값과 같아야 한다 — 그래야 엣지 함수가 그 알림을
 * 찾는다. 이미 보낸 알림이면 서버가 조용히 넘어가므로 두 번 눌러도 두 번 가지 않는다.
 *
 * 실패해도 무시한다. 승인은 이미 끝났고 알림은 수신함에 들어가 있다 — 푸시가 실패했다고
 * 관리자에게 오류를 보여 주면 승인이 실패한 것으로 읽힌다.
 */
export async function sendNotificationPush(kind: string, dedupeKey: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.functions.invoke("send-push", {
    body: { kind, dedupeKey },
  });
  if (error) {
    console.warn("[services/notifications] sendNotificationPush failed:", error.message);
  }
}
