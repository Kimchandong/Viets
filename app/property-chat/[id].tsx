import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import type { Session } from "@supabase/supabase-js";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import type { ThemeColors } from "@/constants/theme";
import { findMockProperty } from "@/constants/mockData";
import { getSession, onAuthStateChange } from "@/services/auth";
import {
  ChatMessage,
  fetchMessages,
  getConversation,
  getOrCreateConversation,
  getTranslatedText,
  sendCustomerImage,
  sendCustomerMessage,
  subscribeToMessages,
} from "@/services/chat";
import { useLocaleStore } from "@/store/useLocaleStore";

/**
 * [STEP: 2026-09-09] 사용자 요청 — 부동산상세 "문의하기" 클릭 시 매물 등록자와의
 * 1:1 상담(채팅) 화면. app/invest-apply/[id].tsx와 동일한 sibling 라우트 방식으로
 * 추가한다(app/_layout.tsx 루트 Stack에 자동 등록, 기존 파일 삭제/이동 없음).
 *
 * 로그인 게이트는 app/property-detail/[id].tsx의 "문의하기" 버튼에서 이미
 * LoginPromptModal로 처리한다 — 이 화면은 직접 딥링크로 들어온 비로그인 접근에
 * 대한 안전망으로만 자체 게이트를 둔다(투자신청 화면과 동일 패턴).
 *
 * 핵심 요구사항(사용자 원문): "입력언어와 상관없이 수신인은 디바이스 설정언어로
 * 번역되어 대화창에 노출되어야 함" — 메시지마다 useLocaleStore의 현재 언어로
 * services/chat.ts의 getTranslatedText()를 호출해 화면에 표시한다(원문 언어와
 * 같으면 API 호출 없이 원문, 다르면 캐시 우선 후 Google Cloud Translation API).
 *
 * [STEP: 2026-09-09-2] 사용자 요청 반영(4건):
 * 1) 키보드 위로 입력창이 올라오지 않던 문제 — KeyboardAvoidingView의 behavior가
 *    iOS에서만 "padding"이고 Android는 undefined(아무 동작 없음)였다. Android에
 *    "height"를 지정한다.
 * 2) 전송 버튼이 눌러도 반응 없던 문제 — services/chat.ts의 전송 함수들이 이제
 *    boolean을 반환하도록 바꿔, 실패 시 Toast로 알리고 입력한 텍스트를 지우지
 *    않는다(이전엔 실패해도 조용히 아무 일도 없었다).
 * 3) 입력창 좌측 이미지 첨부 아이콘 — expo-image-picker로 갤러리에서 이미지를
 *    골라 Supabase Storage(chat-images 버킷)에 업로드 후 메시지로 삽입, 삽입된
 *    이미지를 탭하면 전체화면 보기(다시 탭하거나 닫기 버튼으로 닫음).
 * 4) 헤더 타이틀 — 담당자 이름/소속(개인화된 정보) 대신 고정된 다국어 문구
 *    "부동산 상담"(chat.headerTitle)으로 변경.
 */
export default function PropertyChatScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();
  // [2026-09-11] 담당자는 상담 목록에서 특정 대화를 열기 때문에 conversationId가
  // 함께 온다. 이 값이 있으면 새 대화를 만들지 않고 그 대화를 그대로 연다 —
  // 없으면 기존처럼 "내(고객) 대화를 찾거나 만든다".
  const { id, conversationId: conversationIdParam } = useLocalSearchParams<{
    id: string;
    conversationId?: string;
  }>();
  const language = useLocaleStore((state) => state.language);

  const property = useMemo(() => (id ? findMockProperty(id) : undefined), [id]);

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  /** 내가 이 대화의 담당자(중개업소/관리자)인가 — 보낼 때 sender_type을 정한다. */
  const [isAgentView, setIsAgentView] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [displayTexts, setDisplayTexts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  // [STEP: 2026-09-09-7] 사용자 요청 — 투자신청/문의하기의 로그인 루프 버그와
  // 동일한 원인(로컬 session state가 마운트 시 1회 조회 후 갱신되지 않음)이 이
  // 화면(딥링크로 직접 접근해 자체 로그인 게이트를 타는 경우)에도 있어 동일하게
  // onAuthStateChange 구독을 추가한다 — "/login"에서 뒤로 돌아와도 이 화면은
  // 다시 마운트되지 않으므로(스택에 남아있던 인스턴스), 구독 없이는 로그인
  // 성공 후에도 계속 "로그인 필요" 화면이 보인다.
  useEffect(() => {
    let mounted = true;

    getSession().then((initialSession) => {
      if (mounted) {
        setSession(initialSession);
        setSessionLoading(false);
      }
    });

    const { unsubscribe } = onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !property) {
      return;
    }
    let mounted = true;

    // 담당자 경로: 넘겨받은 대화를 연다. 고객 경로: 내 대화를 찾거나 만든다.
    const resolve = conversationIdParam
      ? Promise.resolve(conversationIdParam)
      : getOrCreateConversation(property.id);

    resolve.then(async (convId) => {
      if (!mounted || !convId) {
        return;
      }
      setConversationId(convId);

      // 이 대화에서 내가 고객인지 담당자인지 판정한다 — 담당자가 customer로
      // 보내면 서버(RLS)가 거부하므로 보내기 전에 반드시 정해져 있어야 한다.
      const conversation = await getConversation(convId);
      if (mounted && conversation) {
        setIsAgentView(conversation.customer_id !== session.user.id);
      }

      const initialMessages = await fetchMessages(convId);
      if (mounted) {
        setMessages(initialMessages);
      }
    });

    return () => {
      mounted = false;
    };
  }, [session, property, conversationIdParam]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }
    const { unsubscribe } = subscribeToMessages(conversationId, (message) => {
      setMessages((prev) => (prev.some((existing) => existing.id === message.id) ? prev : [...prev, message]));
    });
    return unsubscribe;
  }, [conversationId]);

  // 메시지 목록/현재 언어가 바뀔 때마다, 아직 이 언어로 번역해두지 않은 메시지만
  // 번역한다 — getTranslatedText 자체가 캐시(message.translations)를 우선 쓰므로
  // 같은 언어 조합에 대해 API를 반복 호출하지 않는다.
  useEffect(() => {
    let mounted = true;
    messages.forEach((message) => {
      const key = `${message.id}:${language}`;
      if (displayTexts[key] !== undefined) {
        return;
      }
      getTranslatedText(message, language).then((text) => {
        if (mounted) {
          setDisplayTexts((prev) => ({ ...prev, [key]: text }));
        }
      });
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, language]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) {
      return;
    }
    if (!conversationId) {
      showToast(t("chat.sendFailedToast"));
      return;
    }
    setSending(true);
    const success = await sendCustomerMessage(conversationId, text, language, isAgentView ? "agent" : "customer");
    setSending(false);

    if (success) {
      setDraft("");
    } else {
      // 실패 시 입력한 텍스트를 지우지 않는다 — 다시 눌러 재시도할 수 있게 한다.
      showToast(t("chat.sendFailedToast"));
    }
  }

  async function handlePickImage() {
    if (!conversationId || sending) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("chat.imagePermissionDenied"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) {
      return;
    }

    setSending(true);
    const success = await sendCustomerImage(
      conversationId,
      result.assets[0].uri,
      language,
      isAgentView ? "agent" : "customer",
    );
    setSending(false);

    if (!success) {
      showToast(t("chat.sendFailedToast"));
    }
  }

  if (sessionLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("chat.headerTitle")} leftAction={<BackButton onPress={() => router.back()} theme={theme} />} />
        <Loading fullscreen />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("chat.headerTitle")} leftAction={<BackButton onPress={() => router.back()} theme={theme} />} />
        <EmptyState
          title={t("common.loginRequired")}
          description={t("chat.loginRequiredDescription")}
          action={<Button title={t("auth.login.title")} onPress={() => router.push("/login")} />}
        />
      </SafeAreaView>
    );
  }

  if (!property) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("common.notFoundTitle")} leftAction={<BackButton onPress={() => router.back()} theme={theme} />} />
        <EmptyState title={t("common.notFoundTitle")} description={t("common.notFoundDescription")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("chat.headerTitle")} leftAction={<BackButton onPress={() => router.back()} theme={theme} />} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        >
          {/* 사용자 요청: "채팅창에는 고객이 보고있는 매물정보가 삽입되어야 함
              (매물명/위치/가격/옵션)" — 대화 목록 맨 위에 카드 형태로 삽입한다. */}
          <View style={[styles.propertyCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            {/* [STEP: 2026-09-09-3] 사용자 요청 — 채팅창 매물정보 카드에 사진이미지(1개) 추가 */}
            {property.images?.[0] ? (
              <Image
                source={property.images[0]}
                style={[styles.propertyCardImage, { backgroundColor: theme.border }]}
                resizeMode="cover"
              />
            ) : null}
            <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={2}>
              {property.title}
            </Text>
            <Text style={[textStyles.caption, { color: theme.secondaryText, marginTop: spacing.xs }]}>
              {property.location}
            </Text>
            <Text style={[textStyles.price, { color: theme.accent, marginTop: spacing.xs }]}>{property.price}</Text>
            {property.options.length > 0 ? (
              <View style={styles.optionsRow}>
                {property.options.map((option) => (
                  <View key={option} style={[styles.optionChip, { borderColor: theme.border }]}>
                    <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{option}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {messages.map((message) => {
            // [2026-09-11] "내 말풍선"은 보는 사람이 누구냐에 따라 달라진다.
            // 고객이 보면 customer 메시지가 내 것이고, 담당자가 보면 agent 메시지가
            // 내 것이다. 이 구분이 없으면 담당자 화면에서 자기 답장이 상대편 자리에
            // 찍힌다.
            const isCustomer = isAgentView
              ? message.sender_type === "agent"
              : message.sender_type === "customer";
            const text = displayTexts[`${message.id}:${language}`] ?? message.original_text;
            return (
              <View key={message.id} style={[styles.bubbleRow, isCustomer ? styles.bubbleRowCustomer : styles.bubbleRowAgent]}>
                {message.image_url ? (
                  <Pressable onPress={() => setPreviewImageUrl(message.image_url)} accessibilityRole="imagebutton">
                    <Image source={{ uri: message.image_url }} style={styles.messageImage} resizeMode="cover" />
                  </Pressable>
                ) : (
                  <View
                    style={[
                      styles.bubble,
                      isCustomer
                        ? [styles.bubbleCustomer, { backgroundColor: theme.accent }]
                        : [styles.bubbleAgent, { backgroundColor: theme.card, borderColor: theme.border }],
                    ]}
                  >
                    <Text style={[textStyles.bodySmall, { color: isCustomer ? theme.onAccent : theme.text }]}>{text}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.inputRow, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
          <Pressable
            onPress={handlePickImage}
            disabled={!conversationId || sending}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.attachButton,
              { opacity: !conversationId || sending ? opacity.disabled : pressed ? opacity.pressed : 1 },
            ]}
          >
            <Ionicons name="image-outline" size={24} color={theme.secondaryText} />
          </Pressable>
          <Input
            containerStyle={styles.inputContainer}
            style={styles.input}
            placeholder={t("chat.inputPlaceholder")}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: theme.accent,
                opacity: !draft.trim() || sending ? opacity.disabled : pressed ? opacity.pressed : 1,
              },
            ]}
          >
            <Ionicons name="send" size={18} color={theme.onAccent} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* 사용자 요청: "삽입된 이미지 클릭하여 전체화면 보기(닫기)" */}
      <Modal visible={!!previewImageUrl} transparent animationType="fade" onRequestClose={() => setPreviewImageUrl(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreviewImageUrl(null)}>
          {previewImageUrl ? <Image source={{ uri: previewImageUrl }} style={styles.previewImage} resizeMode="contain" /> : null}
          <Pressable
            onPress={() => setPreviewImageUrl(null)}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            style={styles.previewClose}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
        </Pressable>
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function BackButton({ onPress, theme }: { onPress: () => void; theme: ThemeColors }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
    >
      <Ionicons name="chevron-back" size={24} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  messages: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  propertyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  propertyCardImage: {
    width: "100%",
    height: 180,
    marginTop: -spacing.md,
    marginHorizontal: -spacing.md,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  optionChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
  bubbleRow: {
    flexDirection: "row",
  },
  bubbleRowCustomer: {
    justifyContent: "flex-end",
  },
  bubbleRowAgent: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "80%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleCustomer: {
    borderBottomRightRadius: radius.sm,
  },
  bubbleAgent: {
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: radius.sm,
  },
  messageImage: {
    width: 180,
    height: 180,
    borderRadius: radius.md,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
  },
  attachButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  inputContainer: {
    flex: 1,
    marginBottom: 0,
  },
  input: {
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: "80%",
  },
  previewClose: {
    position: "absolute",
    top: 48,
    right: spacing.lg,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
