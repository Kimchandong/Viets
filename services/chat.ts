import type { RealtimeChannel } from "@supabase/supabase-js";

import { readImageBytes } from "@/utils/imageBytes";
import { supabase } from "./supabase";

/**
 * [STEP: 2026-09-09] 사용자 요청 — 부동산상세 "문의하기" > 매물 등록자와의 1:1 채팅.
 *
 * [2026-09-11 STEP 07-③] 담당자는 이제 **매물 등록자**(properties.created_by)다.
 * 그 판정은 이 파일이 하지 않는다 — RLS의 can_manage_property_chat()이 정하고,
 * 담당자는 상담 목록(app/chat-inbox.tsx)에서 대화를 열어 agent로 답한다.
 *
 * 그래서 mock 담당자 자동응답을 없앴다. 그것은 대화가 아니라 "담당자가 답변드립니다"
 * 라는 안내였는데 agent 메시지로 DB에 저장돼, 홈 알림이 생긴 뒤로는 고객의 미읽음
 * 수에 1로 잡혔다(읽을 것이 없는데 배지가 붙는다). 같은 안내는 화면에서
 * (app/property-chat/[id].tsx) 담당자 답장이 아직 없을 때만 보여 준다 — DB에
 * 남기지 않으므로 세어지지도, 번역 비용이 들지도 않는다.
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

/**
 * [2026-09-11 사용자 결정] 자동번역 길이 상한(문자).
 *
 * 번역 비용은 "새로 생긴 서로 다른 문장"의 글자 수에만 붙는다 — 같은 언어끼리는
 * 호출 자체가 없고, 메시지별·전역 캐시가 재조회를 막는다. 그래서 실제 비용을
 * 좌우하는 것은 대화의 길이가 아니라 **한 번에 붙여넣은 긴 글** 하나다.
 * 짧은 문답 수백 개보다 긴 문서 한 통이 비싸다.
 *
 * 메시지 개수로 막지 않는 이유: 상담이 개수 상한을 넘는 순간 서로 말이 통하지
 * 않게 되어, 이 앱이 존재하는 이유가 사라진다. 길이 상한은 대화를 끊지 않으면서
 * 비용이 튀는 경우만 걸러 낸다.
 *
 * [2026-09-11 사용자 결정] 500 → 100. 상한을 넘는 메시지는 번역을 건너뛰는 데서
 * 그치지 않고, 화면이 아예 전송을 막고 팝업으로 알린다 — 번역되지 않는 긴 글이
 * 대화에 쌓이면 상대는 읽을 수 없는 원문만 받게 되기 때문이다.
 *
 * 이 값은 실사용 데이터를 보고 조정할 예정이다(MY > 번역 사용량의 과금 문자 수).
 */
export const MAX_TRANSLATE_CHARS = 100;

/**
 * 이 메시지가 길이 상한 때문에 번역되지 않는지. 화면이 원문 옆에 안내를 붙일 때 쓴다 —
 * 읽을 수 없는 원문만 덩그러니 두면 번역이 고장 난 것처럼 보인다.
 */
export function isTooLongToTranslate(text: string): boolean {
  return text.length > MAX_TRANSLATE_CHARS;
}
const CHAT_IMAGES_BUCKET = "chat-images";

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
    // 웹/네이티브 분기는 utils/imageBytes.ts가 담당한다(매물 사진과 동일한 문제).
    const { bytes, contentType, fileExt } = await readImageBytes(localUri);
    // 경로 첫 칸이 업로더의 uid여야 한다(chat-images 버킷 정책) — 담당자가 보낼 때도
    // 여기 들어가는 값은 "현재 로그인 사용자"라 그대로 통과한다.
    const path = `${customerId}/${conversationId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(CHAT_IMAGES_BUCKET)
      .upload(path, bytes, { contentType });

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

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/chat] sendCustomerImage threw:", message);
    return false;
  }
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

  // 길이 상한 — 캐시보다 뒤에 둔다. 이미 번역해 둔 긴 메시지는 그대로 보여 주는 것이
  // 맞다(추가 비용이 없고, 상한을 나중에 낮춰도 과거 대화가 갑자기 원문으로 바뀌지
  // 않는다). 새로 호출하는 것만 막는다.
  if (isTooLongToTranslate(message.original_text)) {
    return message.original_text;
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

export type TranslationUsagePeriod = "today" | "week" | "month" | "all";

/** [2026-09-11] 월별 추이 한 점 — "전체" 탭 그래프용. */
export type TranslationUsageMonth = {
  month: string;
  api_calls: number;
  billable_chars: number;
};

/** 최근 12개월 사용량. 기록이 없는 달도 0으로 채워져 돌아온다(서버가 채운다). */
export async function fetchTranslationUsageMonthly(): Promise<TranslationUsageMonth[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("admin_translation_usage_monthly");

  if (error) {
    console.warn("[services/chat] fetchTranslationUsageMonthly failed:", error.message);
    return [];
  }
  return ((data ?? []) as TranslationUsageMonth[]).map((row) => ({
    month: row.month,
    api_calls: Number(row.api_calls),
    billable_chars: Number(row.billable_chars),
  }));
}

export async function fetchTranslationUsage(
  period: TranslationUsagePeriod,
): Promise<TranslationUsage | null> {
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
