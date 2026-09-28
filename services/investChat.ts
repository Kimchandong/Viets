import { supabase } from "./supabase";
import {
  getTranslatedText,
  sendCustomerImage,
  type ChatMessage,
  type ChatSenderType,
} from "./chat";

/**
 * [2026-09-28 사용자 지시] 투자상품 1:1 상담.
 *
 * 메시지의 **모양**은 매물 상담과 같다(services/chat.ts의 ChatMessage를 그대로
 * 쓴다). 그래서 번역·이미지 업로드처럼 값비싼 로직은 chat.ts의 것을 테이블만
 * 바꿔 재사용하고, 이 파일에는 투자 쪽 테이블을 읽고 쓰는 부분만 둔다.
 *
 * chat.ts 전체를 두 도메인용으로 일반화하지 않은 이유: 그 파일은 이미 운영 중인
 * 매물 상담 전체를 담고 있어, 구조를 바꾸면 매물 상담이 같이 흔들린다.
 *
 * 누가 무엇을 볼 수 있는지는 전부 RLS(can_manage_investment_chat)가 정한다 —
 * 이 파일은 전체를 요청할 뿐이고, 권한이 없으면 자기 대화만 돌아온다.
 */

const CONVERSATIONS_TABLE = "investment_conversations";
export const INVEST_MESSAGES_TABLE = "investment_messages";

const MESSAGE_COLUMNS =
  "id,conversation_id,sender_type,original_text,original_lang,translations,image_url,created_at,translation_status,translation_attempts";

export type InvestConversation = {
  id: string;
  investmentId: string;
  investmentTitle: string;
  lastMessageText: string;
  lastMessageAt: string;
  lastSenderType: ChatSenderType | null;
  /** 마지막 말이 고객 것이면 담당자가 답할 차례라는 뜻. */
  needsReply: boolean;
};

export type InvestConversationHead = {
  id: string;
  investmentId: string;
  investmentTitle: string;
  customerId: string;
};

/**
 * 이 사람과 이 상품의 대화방. 없으면 만든다.
 *
 * 먼저 조회하고 없을 때만 넣는다 — unique(investment_id, customer_id)가 있어
 * 동시에 두 번 눌리면 한쪽이 충돌하는데, 그때는 다시 조회해 같은 방을 쓴다.
 */
export async function getOrCreateInvestConversation(investmentId: string): Promise<string | null> {
  if (!supabase) return null;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;

  const { data: found } = await supabase
    .from(CONVERSATIONS_TABLE)
    .select("id")
    .eq("investment_id", investmentId)
    .eq("customer_id", userId)
    .maybeSingle();
  if (found?.id) return found.id as string;

  const { data: created, error } = await supabase
    .from(CONVERSATIONS_TABLE)
    .insert({ investment_id: investmentId, customer_id: userId })
    .select("id")
    .maybeSingle();

  if (error) {
    const { data: retry } = await supabase
      .from(CONVERSATIONS_TABLE)
      .select("id")
      .eq("investment_id", investmentId)
      .eq("customer_id", userId)
      .maybeSingle();
    if (retry?.id) return retry.id as string;
    console.warn("[services/investChat] 대화방 생성 실패:", error.message);
    return null;
  }
  return (created?.id as string) ?? null;
}

/** 대화방 하나의 머리말. customerId는 화면이 "내가 고객인가"를 판정하는 데 쓴다. */
export async function getInvestConversation(
  conversationId: string,
): Promise<InvestConversationHead | null> {
  if (!supabase) return null;

  const { data } = await supabase
    .from(CONVERSATIONS_TABLE)
    .select("id,investment_id,customer_id,investment_products(title)")
    .eq("id", conversationId)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as {
    id: string;
    investment_id: string;
    customer_id: string;
    investment_products: { title: string } | null;
  };
  return {
    id: row.id,
    investmentId: row.investment_id,
    investmentTitle: row.investment_products?.title ?? "",
    customerId: row.customer_id,
  };
}

/**
 * 상담 목록.
 *
 * 마지막 메시지는 별도 쿼리로 한 번에 가져와 대화별 최신 1건만 고른다 —
 * PostgREST로는 "대화별 최신 1건"을 한 번에 뽑을 수 없고, 대화마다 쿼리를
 * 돌리면 목록 길이만큼 왕복이 생긴다(매물 쪽과 같은 이유).
 */
export async function listInvestConversations(
  // 매물 쪽과 같은 이유로 둔다(services/chat.ts 참고) — 나의활동 밑에서는
  // 내가 건 상담만 보여야 한다.
  options: { onlyMine?: boolean } = {},
): Promise<InvestConversation[]> {
  if (!supabase) return [];

  let query = supabase
    .from(CONVERSATIONS_TABLE)
    .select("id,investment_id,created_at,investment_products(title)")
    .order("created_at", { ascending: false });

  if (options.onlyMine) {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return [];
    query = query.eq("customer_id", userId);
  }

  const { data: convData, error } = await query;

  if (error) {
    console.warn("[services/investChat] 목록 조회 실패:", error.message);
    return [];
  }

  const conversations = (convData ?? []) as unknown as {
    id: string;
    investment_id: string;
    created_at: string;
    investment_products: { title: string } | null;
  }[];
  if (conversations.length === 0) return [];

  const { data: msgData } = await supabase
    .from(INVEST_MESSAGES_TABLE)
    .select("conversation_id,original_text,image_url,sender_type,created_at")
    .in(
      "conversation_id",
      conversations.map((c) => c.id),
    )
    .order("created_at", { ascending: false });

  const latest = new Map<string, { text: string; at: string; sender: ChatSenderType }>();
  for (const row of (msgData ?? []) as {
    conversation_id: string;
    original_text: string;
    image_url: string | null;
    sender_type: ChatSenderType;
    created_at: string;
  }[]) {
    // 내림차순이라 각 대화에서 처음 만나는 행이 가장 최신이다.
    if (latest.has(row.conversation_id)) continue;
    latest.set(row.conversation_id, {
      text: row.image_url ? "" : row.original_text,
      at: row.created_at,
      sender: row.sender_type,
    });
  }

  return conversations.map((c) => {
    const last = latest.get(c.id);
    return {
      id: c.id,
      investmentId: c.investment_id,
      investmentTitle: c.investment_products?.title ?? "",
      lastMessageText: last?.text ?? "",
      lastMessageAt: last?.at ?? c.created_at,
      lastSenderType: last?.sender ?? null,
      needsReply: last?.sender === "customer",
    };
  });
}

export async function fetchInvestMessages(conversationId: string): Promise<ChatMessage[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from(INVEST_MESSAGES_TABLE)
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[services/investChat] 메시지 조회 실패:", error.message);
    return [];
  }
  return (data ?? []) as unknown as ChatMessage[];
}

/**
 * 메시지 보내기.
 *
 * senderType은 화면이 넘기지만 **서버 RLS가 최종 판정한다** — 고객 정책은
 * sender_type='customer'만, 담당자 정책은 'agent'만 통과시킨다. 그래서 여기서
 * 역할을 다시 검사하지 않는다(검사해 봐야 두 벌이 어긋나기만 한다).
 */
export async function sendInvestMessage(
  conversationId: string,
  text: string,
  lang: string,
  senderType: ChatSenderType = "customer",
): Promise<boolean> {
  if (!supabase) return false;
  const body = text.trim();
  if (body.length === 0) return false;

  const { error } = await supabase.from(INVEST_MESSAGES_TABLE).insert({
    conversation_id: conversationId,
    sender_type: senderType,
    original_text: body,
    original_lang: lang,
  });

  if (error) {
    console.warn("[services/investChat] 전송 실패:", error.message);
    return false;
  }
  return true;
}

/** 이미지 전송 — 업로드·버킷 처리는 매물 쪽 것을 그대로 쓰고 테이블만 바꾼다. */
export function sendInvestImage(
  conversationId: string,
  localUri: string,
  lang: string,
  senderType: ChatSenderType = "customer",
): Promise<boolean> {
  return sendCustomerImage(conversationId, localUri, lang, senderType, INVEST_MESSAGES_TABLE);
}

/** 번역 — 캐시를 investment_messages에 되쓴다. */
export function getInvestTranslatedText(message: ChatMessage, targetLang: string): Promise<string> {
  return getTranslatedText(message, targetLang, INVEST_MESSAGES_TABLE);
}

/** 새 메시지 실시간 수신. 해제 함수를 돌려준다. */
export function subscribeToInvestMessages(
  conversationId: string,
  onMessage: (message: ChatMessage) => void,
): () => void {
  if (!supabase) return () => undefined;

  const channel = supabase
    .channel(`invest-chat:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: INVEST_MESSAGES_TABLE,
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onMessage(payload.new as unknown as ChatMessage),
    )
    .subscribe();

  return () => {
    void supabase?.removeChannel(channel);
  };
}
