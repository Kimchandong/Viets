import type { RealtimeChannel } from "@supabase/supabase-js";
import { File } from "expo-file-system";

import { supabase } from "./supabase";

/**
 * [STEP: 2026-09-09] 사용자 요청 — 부동산상세 "문의하기" > 매물 등록자와의 1:1 채팅.
 *
 * 아직 부동산중개업소별 등록자 계정/권한 체계가 없어서(실제 백엔드 부재), 실제
 * 동작하는 채팅(Supabase 테이블 + Realtime)은 만들되, 상대방(중개인) 쪽은 고정된
 * mock 담당자 1명(constants/mockData.ts의 MOCK_LISTING_AGENT)이 짧은 지연 후
 * 자동 응답하는 것으로 시뮬레이션한다(사용자 확인 — "mock 담당자 1명을 정해두고
 * 자동응답을 붙이는 방식"). 고객이 로그인한 계정(auth.uid())이 대화의 유일한
 * 실제 참여자이므로, RLS 정책도 "이 대화의 customer_id = auth.uid()"만으로
 * customer/agent 메시지 양쪽을 함께 허용한다(agent는 별도 로그인 계정이 없음).
 *
 * 사용하는 Supabase 테이블/버킷:
 *   public.property_conversations(id, property_id, customer_id, created_at)
 *   public.property_messages(id, conversation_id, sender_type, original_text,
 *     original_lang, translations jsonb, image_url, created_at, translation_* 4종)
 *   storage bucket "chat-images"(public read, 본인 폴더에만 업로드 가능)
 *
 * 이 스키마는 2026-09-08에 SQL Editor로 1회 실행해 만들었던 것을 2026-09-11에
 * migration으로 편입했다(D51 해소, 20260911073649_chat_schema_capture.sql). 같은 날
 * property_id도 text → uuid + FK(properties, ON DELETE CASCADE)로 정리했다
 * (20260911082640_chat_property_uuid_fk.sql) — 이제 존재하지 않는 매물 id로는
 * 대화가 만들어지지 않고, 매물을 하드 삭제하면 대화도 함께 사라진다.
 *
 * 핵심 요구사항(사용자 원문): "입력언어와 상관없이 수신인은 디바이스 설정언어로
 * 번역되어 대화창에 노출되어야 함" — getTranslatedText()가 뷰어의 현재 앱 언어
 * (store/useLocaleStore.ts, 이 앱에서 "디바이스 설정언어"에 대응하는 값)로 매
 * 메시지를 번역해 반환한다. 이미 그 언어로 번역된 적이 있으면 캐시(메시지의
 * translations 컬럼)를 그대로 쓰고, 없으면 Google Cloud Translation API를 호출한
 * 뒤 결과를 그 컬럼에 병합 저장한다 — 같은 대화를 여러 번 열어도 동일 언어 조합은
 * API를 한 번만 호출한다.
 *
 * [STEP: 2026-09-09-2] 사용자 요청 — 전송 버튼이 눌러도 반응이 없던 문제 수정:
 * sendCustomerMessage가 예외를 던지거나 실패를 조용히 삼키면 화면(handleSend)의
 * sending 상태가 풀리지 않아 버튼이 계속 비활성 상태로 보일 수 있었다. 이제 모든
 * 전송 함수는 예외를 절대 던지지 않고(try/catch로 감쌈) boolean을 반환해, 호출부가
 * 성공/실패를 항상 알 수 있게 한다(실패 시 Toast로 알림, 초안 텍스트 보존).
 * 같은 요청 — 이미지 첨부/삽입 기능(sendCustomerImage) 추가.
 */

export type ChatSenderType = "customer" | "agent";

export type MessageTranslationStatus = "not_required" | "pending" | "translated" | "failed";

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_type: ChatSenderType;
  original_text: string;
  original_lang: string;
  translations: Record<string, string> | null;
  image_url: string | null;
  created_at: string;
  // [STEP T-2] 번역 상태 — 기존 메시지에는 없을 수 있어(마이그레이션 기본값 'pending')
  // optional로 둔다.
  translation_status?: MessageTranslationStatus;
  translation_attempts?: number;
};

/** 번역 실패 재시도 상한(§19 — 무한 재시도 금지). 이 횟수를 넘기면 원문만 보여준다. */
const MAX_TRANSLATION_ATTEMPTS = 3;

const CONVERSATIONS_TABLE = "property_conversations";
const MESSAGES_TABLE = "property_messages";
const CHAT_IMAGES_BUCKET = "chat-images";

// 데모용 mock 담당자 자동 응답 원문 — "채팅 콘텐츠"이므로 i18n(UI Translation
// 전용, i18n/index.ts 상단 주석 참고)이 아니라 여기(콘텐츠 계층)에 원문(베트남어)
// 그대로 둔다. getTranslatedText()의 동일한 실시간 번역 경로를 그대로 타므로,
// 뷰어 언어와 무관하게 항상 현재 앱 언어로 번역되어 보인다.
// [STEP S-1 후속, 2026-09-09] 사용자 요청 — 안내멘트 문구 변경("해당 매물의
// 중개업소 및 등록자가 답변 드립니다. 잠시만 기다려 주세요"). 다른 채팅 콘텐츠와
// 동일하게 원문(베트남어)만 저장하고 getTranslatedText()의 실시간 번역 경로를
// 그대로 태워 뷰어의 현재 앱 언어로 자동 번역되어 보이게 한다(다국어 적용,
// 위 AGENT_AUTO_REPLY_TEXT 사용처와 동일 원칙 — 상단 주석 참고).
const AGENT_AUTO_REPLY_TEXT =
  "Văn phòng môi giới và người đăng tin của bất động sản này sẽ phản hồi. Vui lòng chờ trong giây lát.";
const AGENT_AUTO_REPLY_LANG = "vi";
const AGENT_AUTO_REPLY_DELAY_MS = 1400;

/**
 * 이 매물(propertyId) + 현재 로그인 사용자 조합의 대화를 찾거나 새로 만든다.
 * supabase가 null이거나(.env 미설정) 로그인 세션이 없으면 null을 반환한다 —
 * 호출부(화면)가 반드시 null을 먼저 체크해야 한다(services 전역 원칙).
 */
export async function getOrCreateConversation(propertyId: string): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const customerId = userData.user?.id;
    if (userError || !customerId) {
      console.warn("[services/chat] getOrCreateConversation: no authenticated user");
      return null;
    }

    const { data: existing, error: selectError } = await supabase
      .from(CONVERSATIONS_TABLE)
      .select("id")
      .eq("property_id", propertyId)
      .eq("customer_id", customerId)
      .maybeSingle();

    if (selectError) {
      console.warn("[services/chat] getOrCreateConversation select failed:", selectError.message);
    }
    if (existing?.id) {
      return existing.id as string;
    }

    const { data: created, error: insertError } = await supabase
      .from(CONVERSATIONS_TABLE)
      .insert({ property_id: propertyId, customer_id: customerId })
      .select("id")
      .single();

    if (insertError || !created) {
      console.warn("[services/chat] getOrCreateConversation insert failed:", insertError?.message);
      return null;
    }
    return created.id as string;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/chat] getOrCreateConversation threw:", message);
    return null;
  }
}

/** 대화 한 건의 최소 정보 — 화면이 "내가 고객인가 담당자인가"를 판정하는 데 쓴다. */
export type ChatConversation = {
  id: string;
  property_id: string;
  customer_id: string;
  created_at: string;
};

/**
 * [2026-09-11] 대화 단건 조회.
 *
 * 담당자는 상담 목록에서 특정 대화를 열기 때문에 propertyId가 아니라 conversationId로
 * 들어온다. 이때 customer_id를 보고 "내가 이 대화의 고객인지"를 판정해야 보낼 때
 * sender_type을 옳게 정할 수 있다(담당자가 customer로 보내면 RLS가 막는다).
 */
export async function getConversation(conversationId: string): Promise<ChatConversation | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from(CONVERSATIONS_TABLE)
    .select("id,property_id,customer_id,created_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/chat] getConversation failed:", error.message);
    return null;
  }
  return data as ChatConversation;
}

/** 상담 목록 한 줄. */
export type ManagedConversation = {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyAddress: string;
  lastMessageText: string;
  lastMessageAt: string;
  lastSenderType: ChatSenderType | null;
  /** 마지막 메시지가 고객이 보낸 것이면 답장이 필요하다는 뜻. */
  needsReply: boolean;
};

/**
 * [2026-09-11] 담당자가 볼 상담 목록.
 *
 * 어떤 대화가 보이는지는 전적으로 RLS가 정한다(can_manage_property_chat) — 이 함수는
 * 그냥 전체를 요청하고, 서버가 내가 담당하는 매물의 대화만 돌려준다. 고객 계정이
 * 호출하면 자기 대화만 나온다.
 *
 * 마지막 메시지는 별도 쿼리로 한 번에 가져와 클라이언트에서 대화별 최신 1건만 고른다.
 * PostgREST로는 "대화별 최신 1건"을 한 번에 뽑을 수 없고, 대화마다 쿼리를 돌리면
 * 목록 길이만큼 왕복이 생긴다.
 */
export async function listManagedConversations(): Promise<ManagedConversation[]> {
  if (!supabase) {
    return [];
  }

  const { data: convData, error: convError } = await supabase
    .from(CONVERSATIONS_TABLE)
    .select("id,property_id,created_at,properties(title,address)")
    .order("created_at", { ascending: false });

  if (convError) {
    console.warn("[services/chat] listManagedConversations failed:", convError.message);
    return [];
  }

  const conversations = (convData ?? []) as unknown as {
    id: string;
    property_id: string;
    created_at: string;
    properties: { title: string; address: string | null } | null;
  }[];

  if (conversations.length === 0) {
    return [];
  }

  const { data: msgData } = await supabase
    .from(MESSAGES_TABLE)
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
      propertyId: c.property_id,
      propertyTitle: c.properties?.title ?? "",
      propertyAddress: c.properties?.address ?? "",
      lastMessageText: last?.text ?? "",
      lastMessageAt: last?.at ?? c.created_at,
      lastSenderType: last?.sender ?? null,
      needsReply: last?.sender === "customer",
    };
  });
}

export async function fetchMessages(conversationId: string): Promise<ChatMessage[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("[services/chat] fetchMessages failed:", error.message);
    return [];
  }
  return (data ?? []) as ChatMessage[];
}

/**
 * 고객 텍스트 메시지를 저장하고, 데모용 mock 담당자 자동 응답을 짧은 지연 후 같은
 * 대화에 삽입한다(실시간 구독을 통해 두 메시지 모두 화면에 자연스럽게 나타남).
 * 절대 예외를 던지지 않는다 — 성공 여부를 boolean으로 반환해 호출부가 실패를
 * 사용자에게 알릴 수 있게 한다.
 */
export async function sendCustomerMessage(
  conversationId: string,
  text: string,
  lang: string,
  // [2026-09-11] 담당자(중개업소/관리자)가 같은 대화에 답할 수 있게 되면서 보내는
  // 주체가 둘이 됐다. 함수 이름은 호출부 호환을 위해 그대로 두고 인자로 구분한다.
  senderType: ChatSenderType = "customer",
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  try {
    const { error } = await supabase.from(MESSAGES_TABLE).insert({
      conversation_id: conversationId,
      sender_type: senderType,
      original_text: text,
      original_lang: lang,
    });

    if (error) {
      console.warn("[services/chat] sendCustomerMessage failed:", error.message);
      return false;
    }

    // 자동응답은 "아직 담당자가 붙지 않은 대화"를 위한 것이다 — 실제 담당자가
    // 답하는 중에는 보내지 않는다.
    if (senderType === "customer") {
      scheduleAgentAutoReply(conversationId);
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/chat] sendCustomerMessage threw:", message);
    return false;
  }
}

/**
 * 로컬 이미지(expo-image-picker가 반환한 uri)를 Supabase Storage(chat-images
 * 버킷)에 업로드하고, 그 결과 URL을 담은 메시지를 저장한다. 이미지 메시지는
 * 번역 대상이 아니므로 original_text는 빈 문자열로 둔다(getTranslatedText가
 * image_url이 있으면 번역을 건너뛴다).
 */
export async function sendCustomerImage(
  conversationId: string,
  localUri: string,
  lang: string,
  senderType: ChatSenderType = "customer",
): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const customerId = userData.user?.id;
    if (userError || !customerId) {
      console.warn("[services/chat] sendCustomerImage: no authenticated user");
      return false;
    }

    // RN(Android)에서 fetch(localUri).then(r => r.blob())는 로컬 파일을 온전히
    // 읽지 못해 업로드가 조용히 실패하는 경우가 있어(B2 근본 원인, 2026-09-09
    // 진단), expo-file-system의 File.arrayBuffer()로 직접 바이트를 읽는다.
    const file = new File(localUri);
    const arrayBuffer = await file.arrayBuffer();
    const extMatch = localUri.split("?")[0].match(/\.(\w+)$/);
    const fileExt = extMatch?.[1] ?? "jpg";
    const contentType = fileExt === "png" ? "image/png" : "image/jpeg";
    const path = `${customerId}/${conversationId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(path, arrayBuffer, { contentType });

    if (uploadError) {
      console.warn("[services/chat] image upload failed:", uploadError.message);
      return false;
    }

    const { data: publicUrlData } = supabase.storage.from(CHAT_IMAGES_BUCKET).getPublicUrl(path);
    const imageUrl = publicUrlData?.publicUrl;
    if (!imageUrl) {
      console.warn("[services/chat] image upload succeeded but no public URL was returned");
      return false;
    }

    const { error: insertError } = await supabase.from(MESSAGES_TABLE).insert({
      conversation_id: conversationId,
      sender_type: senderType,
      original_text: "",
      original_lang: lang,
      image_url: imageUrl,
    });

    if (insertError) {
      console.warn("[services/chat] image message insert failed:", insertError.message);
      return false;
    }

    if (senderType === "customer") {
      scheduleAgentAutoReply(conversationId);
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/chat] sendCustomerImage threw:", message);
    return false;
  }
}

// 대화당 1회만 자동응답을 보내기 위한 메모리 가드(같은 세션 내 중복 타이머 방지용,
// 1차 판단은 여전히 DB 조회로 한다 — 앱 재시작/여러 기기에서도 정확하도록).
const autoReplySentConversations = new Set<string>();

/**
 * [STEP S-1, 2026-09-09] 사용자 확인 — 자동응답 인사말은 대화당 "최초 1회만"
 * 나와야 한다. 매 전송마다 다시 나오던 문제(이전에는 무조건 스케줄링)를 고쳐,
 * 이 대화에 이미 agent 메시지가 있으면 다시 보내지 않는다.
 */
function scheduleAgentAutoReply(conversationId: string): void {
  if (autoReplySentConversations.has(conversationId)) {
    return;
  }

  setTimeout(() => {
    void (async () => {
      if (!supabase) {
        return;
      }

      const { data: existingAgentMessage, error: checkError } = await supabase
        .from(MESSAGES_TABLE)
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("sender_type", "agent" satisfies ChatSenderType)
        .limit(1)
        .maybeSingle();

      if (checkError) {
        console.warn("[services/chat] auto-reply existence check failed:", checkError.message);
      }
      if (existingAgentMessage) {
        autoReplySentConversations.add(conversationId);
        return;
      }

      const { error: replyError } = await supabase.from(MESSAGES_TABLE).insert({
        conversation_id: conversationId,
        sender_type: "agent" satisfies ChatSenderType,
        original_text: AGENT_AUTO_REPLY_TEXT,
        original_lang: AGENT_AUTO_REPLY_LANG,
      });

      if (replyError) {
        console.warn("[services/chat] auto-reply insert failed:", replyError.message);
      } else {
        autoReplySentConversations.add(conversationId);
      }
    })();
  }, AGENT_AUTO_REPLY_DELAY_MS);
}

/**
 * 이 대화(conversationId)의 새 메시지를 Realtime으로 구독한다. INSERT 이벤트만
 * 다룬다 — 이 앱에는 메시지 수정/삭제 UI가 없다(getTranslatedText가 번역 캐시를
 * 위해 UPDATE를 쓰지만, 그건 이 화면 자신이 발생시키는 것이라 별도 구독이
 * 필요 없다).
 */
export function subscribeToMessages(
  conversationId: string,
  onInsert: (message: ChatMessage) => void
): { unsubscribe: () => void } {
  if (!supabase) {
    return { unsubscribe: () => {} };
  }

  const channel: RealtimeChannel = supabase
    .channel(`property-chat-${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: MESSAGES_TABLE, filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new as ChatMessage)
    )
    .subscribe();

  return {
    unsubscribe: () => {
      supabase?.removeChannel(channel);
    },
  };
}

/**
 * [STEP T-2, 2026-09-10] 번역 호출을 Edge Function(`translate`)으로 옮겼다.
 *
 * 이전에는 이 함수가 앱에서 Google Translation API를 직접 호출했고, API 키를
 * `EXPO_PUBLIC_GOOGLE_TRANSLATE_API_KEY`로 들고 있었다 — EXPO_PUBLIC_* 값은 APK
 * 번들에 평문으로 들어가므로 디컴파일만 하면 누구나 키를 꺼내 무제한 호출할 수
 * 있었다(비용 폭탄 위험). 이제 키는 Supabase Secrets에만 존재하고, 앱은 로그인
 * 사용자의 JWT로 Edge Function을 호출한다.
 *
 * Edge Function은 (1) 같은 언어면 호출을 건너뛰고, (2) 전역 캐시
 * (translation_cache)를 먼저 조회하며, (3) 없을 때만 Google을 호출하고 결과를
 * 캐시에 저장한다. 즉 같은 문장은 사용자·메시지가 달라도 딱 한 번만 과금된다.
 *
 * 실패 시 null을 반환해 호출부가 원문으로 폴백하게 한다(앱을 crash시키지 않는다).
 */
async function callTranslateApi(
  text: string,
  targetLang: string,
  sourceLang: string,
  messageId?: string,
): Promise<{ text: string; outcome: string } | null> {
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase.functions.invoke("translate", {
      body: { text, sourceLang, targetLang, messageId },
    });

    if (error) {
      console.warn("[services/chat] translate function failed:", error.message);
      return null;
    }

    const translated = (data as { translatedText?: unknown })?.translatedText;
    const outcome = (data as { outcome?: unknown })?.outcome;
    if (typeof translated !== "string") {
      console.warn("[services/chat] translate function returned an unexpected response shape");
      return null;
    }
    return { text: translated, outcome: typeof outcome === "string" ? outcome : "api_call" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/chat] translate function request failed:", message);
    return null;
  }
}

/**
 * message를 targetLang(뷰어의 현재 앱 언어)으로 번역해 반환한다.
 * - 이미지 메시지(image_url 존재)는 번역 대상이 아니므로 즉시 빈 문자열을 반환한다.
 * - targetLang이 원문 언어와 같으면 API 호출 없이 원문을 그대로 반환한다.
 * - 이미 그 언어로 캐시돼 있으면(message.translations) 캐시를 그대로 쓴다.
 * - 새로 번역한 결과는 DB의 translations(jsonb)에 병합 저장해 다음에는 캐시를
 *   쓰도록 한다(같은 언어 조합에 대해 API를 반복 호출하지 않는다).
 * API 키 미설정/호출 실패 시에도 원문을 반환해 대화가 끊기지 않게 한다.
 */
export async function getTranslatedText(message: ChatMessage, targetLang: string): Promise<string> {
  if (message.image_url) {
    return "";
  }
  if (targetLang === message.original_lang) {
    return message.original_text;
  }

  // 1차 캐시: 이 메시지에 이미 저장된 번역문. 서버 왕복조차 하지 않는다 —
  // 채팅방 재진입/스크롤/새로고침이 여기서 끝난다(§18, §21).
  const cached = message.translations?.[targetLang];
  if (cached) {
    return cached;
  }

  // [STEP T-2] 실패한 메시지를 화면 열 때마다 다시 시도하던 문제를 막는다.
  // 기존에는 실패를 기록하지 않아, 번역이 안 되는 메시지가 조회될 때마다 API를
  // 재호출했다. 이제 시도 횟수가 상한(3회)에 도달하면 더 호출하지 않고 원문을
  // 보여준다(§19 — 무한 재시도 금지).
  if (message.translation_status === "failed" && (message.translation_attempts ?? 0) >= MAX_TRANSLATION_ATTEMPTS) {
    return message.original_text;
  }

  const result = await callTranslateApi(
    message.original_text,
    targetLang,
    message.original_lang,
    message.id,
  );

  if (!result) {
    // 실패를 기록해 다음 조회에서 재시도 횟수를 누적한다(상한 도달 시 중단).
    await recordTranslationFailure(message, "translate function unavailable");
    return message.original_text;
  }

  if (result.outcome === "failed") {
    await recordTranslationFailure(message, "translation provider failed");
    return message.original_text;
  }

  // 2차 캐시: 메시지 단위 캐시에도 저장해, 다음 조회는 서버 왕복 없이 끝나게 한다.
  if (supabase) {
    const nextTranslations = { ...(message.translations ?? {}), [targetLang]: result.text };
    const { error } = await supabase
      .from(MESSAGES_TABLE)
      .update({
        translations: nextTranslations,
        translation_status: "translated",
        translation_error: null,
        translated_at: new Date().toISOString(),
      })
      .eq("id", message.id);
    if (error) {
      console.warn("[services/chat] translation cache write failed:", error.message);
    }
    // 로컬 객체도 갱신해, 같은 화면에서 이 메시지를 다시 렌더링할 때 재조회하지 않는다.
    message.translations = nextTranslations;
    message.translation_status = "translated";
  }

  return result.text;
}

/**
 * [STEP T-2] 관리자용 번역 사용량 집계(§16, §17).
 *
 * 단가를 코드에 하드코딩하지 않는다 — Google 요금 체계가 바뀔 수 있어, 단가는
 * 호출부(설정값)에서 곱한다. 이 함수는 "실제 과금 대상 문자 수"까지만 책임진다.
 */
export type TranslationUsage = {
  api_calls: number;
  cache_hits: number;
  skipped: number;
  failures: number;
  billable_chars: number;
  cache_hit_rate: number;
};

export async function fetchTranslationUsage(period: "today" | "month"): Promise<TranslationUsage | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.rpc("admin_translation_usage", { period });

  if (error) {
    console.warn("[services/chat] fetchTranslationUsage failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as TranslationUsage) ?? null;
}

/** 번역 실패를 메시지에 기록한다 — 시도 횟수가 쌓여 상한에 도달하면 재시도를 멈춘다. */
async function recordTranslationFailure(message: ChatMessage, reason: string): Promise<void> {
  if (!supabase) {
    return;
  }

  const nextAttempts = (message.translation_attempts ?? 0) + 1;
  const { error } = await supabase
    .from(MESSAGES_TABLE)
    .update({
      translation_status: "failed",
      translation_attempts: nextAttempts,
      translation_error: reason,
    })
    .eq("id", message.id);

  if (error) {
    console.warn("[services/chat] translation failure record failed:", error.message);
  }
  message.translation_status = "failed";
  message.translation_attempts = nextAttempts;
}
