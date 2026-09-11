import { supabase } from "./supabase";

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

async function callCount(fn: "my_unread_chat_count" | "my_new_investment_count"): Promise<number> {
  if (!supabase) return 0;

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
