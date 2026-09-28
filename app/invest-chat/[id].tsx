import { useEffect, useRef, useState } from "react";
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
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Modal as AppModal } from "@/components/Modal";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import { getInvestmentProductById } from "@/services/investments";
import type { MockInvestmentProduct } from "@/constants/mockData";
import { getSession, onAuthStateChange } from "@/services/auth";
import { isTooLongToTranslate, MAX_TRANSLATE_CHARS, type ChatMessage } from "@/services/chat";
import {
  fetchInvestMessages,
  getInvestConversation,
  getInvestTranslatedText,
  sendInvestImage,
  sendInvestMessage,
  subscribeToInvestMessages,
} from "@/services/investChat";
import { markNotificationsReadByLink } from "@/services/notifications";
import { useLocaleStore } from "@/store/useLocaleStore";
import { localizeUnits } from "@/utils/format";

/**
 * [2026-09-28 사용자 지시] 투자상품 1:1 상담 화면.
 *
 * 매물 상담(app/property-chat/[id].tsx)과 화면 구성은 같지만 **라우트 인자가
 * 다르다**: 여기 [id]는 언제나 **대화방 id**다.
 *
 * 매물 쪽은 [id]가 매물 id이고 담당자만 conversationId를 쿼리로 더 받는 이중
 * 구조인데, 그래서 "지금 이 값이 무엇인가"를 화면 곳곳에서 다시 따져야 한다.
 * 투자 쪽은 들어오는 문이 세 개(상세의 상담 버튼, 상담 목록, 푸시 알림)라
 * 같은 구조를 쓰면 분기가 더 늘어난다 — 그래서 문 세 개가 모두 대화방을 먼저
 * 확보하고 그 id로 들어오게 했다. 푸시 링크(/invest-chat/<conversationId>)도
 * 이 규칙을 따른다.
 *
 * 보내는 사람이 고객인지 담당자인지는 대화방의 customer_id와 내 uid를 비교해
 * 정한다. 틀리면 서버(RLS)가 거부한다 — 고객 정책은 sender_type='customer'만,
 * 담당자 정책은 'agent'만 통과시킨다.
 */
export default function InvestChatScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const language = useLocaleStore((state) => state.language);

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<MockInvestmentProduct | undefined>(undefined);
  /** 내가 이 대화의 담당자(관리자/직원)인가 — 보낼 때 sender_type을 정한다. */
  const [isAgentView, setIsAgentView] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [displayTexts, setDisplayTexts] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [lengthWarningOpen, setLengthWarningOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  // 로그인 상태는 구독한다 — 딥링크로 비로그인 접근 후 로그인하고 돌아오면
  // 이 화면은 다시 마운트되지 않아(스택에 남아 있다) 1회 조회로는 갱신되지 않는다.
  useEffect(() => {
    let mounted = true;
    getSession().then((initial) => {
      if (mounted) {
        setSession(initial);
        setSessionLoading(false);
      }
    });
    const { unsubscribe } = onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !conversationId) return;
    let mounted = true;
    setLoading(true);

    (async () => {
      const head = await getInvestConversation(conversationId);
      if (!mounted) return;
      if (!head) {
        // RLS가 막았거나 없는 대화다 — 둘을 구분해 알릴 방법이 없고, 구분해도
        // 사용자가 할 수 있는 일이 같다.
        setNotFound(true);
        setLoading(false);
        return;
      }

      setIsAgentView(head.customerId !== session.user.id);

      const [productResult, initialMessages] = await Promise.all([
        getInvestmentProductById(head.investmentId),
        fetchInvestMessages(conversationId),
      ]);
      if (!mounted) return;
      setProduct(productResult);
      setMessages(initialMessages);
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [session, conversationId]);

  // 읽음 처리 — 이 방으로 오는 알림을 치운다. 방을 열어 둔 채 새 메시지를 받는
  // 경우까지 포함해야 하므로 messages.length에도 반응한다(읽고 있는 중이다).
  useEffect(() => {
    if (!conversationId) return;
    void markNotificationsReadByLink(`/invest-chat/${conversationId}`);
  }, [conversationId, messages.length]);

  useEffect(() => {
    if (!conversationId) return;
    return subscribeToInvestMessages(conversationId, (message) => {
      setMessages((prev) => (prev.some((existing) => existing.id === message.id) ? prev : [...prev, message]));
    });
  }, [conversationId]);

  // 아직 이 언어로 번역하지 않은 메시지만 번역한다 — getInvestTranslatedText가
  // 메시지에 저장된 번역을 먼저 보므로 같은 조합으로 API를 반복 호출하지 않는다.
  useEffect(() => {
    let mounted = true;
    messages.forEach((message) => {
      const key = `${message.id}:${language}`;
      if (displayTexts[key] !== undefined) return;
      getInvestTranslatedText(message, language).then((text) => {
        if (mounted) setDisplayTexts((prev) => ({ ...prev, [key]: text }));
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
    if (!text || sending || !conversationId) return;
    // 상한을 넘으면 보내기 전에 막는다 — 보낸 뒤 알리면 상대에게는 이미 읽을 수
    // 없는 글이 가 있다.
    if (isTooLongToTranslate(text)) {
      setLengthWarningOpen(true);
      return;
    }

    setSending(true);
    const ok = await sendInvestMessage(conversationId, text, language, isAgentView ? "agent" : "customer");
    setSending(false);

    if (ok) {
      setDraft("");
    } else {
      // 실패해도 입력한 글은 지우지 않는다 — 다시 눌러 재시도할 수 있게.
      showToast(t("chat.sendFailedToast"));
    }
  }

  async function handlePickImage() {
    if (!conversationId || sending) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("chat.imagePermissionDenied"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;

    setSending(true);
    const ok = await sendInvestImage(
      conversationId,
      result.assets[0].uri,
      language,
      isAgentView ? "agent" : "customer",
    );
    setSending(false);
    if (!ok) showToast(t("chat.sendFailedToast"));
  }

  const headerTitle = t("investChat.headerTitle");

  if (sessionLoading || (session && loading)) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={headerTitle} leftAction={<BackButton fallback="/invest" />} />
        <Loading fullscreen />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={headerTitle} leftAction={<BackButton fallback="/invest" />} />
        <EmptyState
          title={t("common.loginRequired")}
          description={t("chat.loginRequiredDescription")}
          action={<Button title={t("auth.login.title")} onPress={() => router.push("/login")} />}
        />
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("common.notFoundTitle")} leftAction={<BackButton fallback="/invest" />} />
        <EmptyState title={t("common.notFoundTitle")} description={t("common.notFoundDescription")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={headerTitle} leftAction={<BackButton fallback="/invest" />} />
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
          {/* 어떤 상품에 대한 상담인지 — 매물 상담과 같은 자리에 같은 모양으로. */}
          {product ? (
            <View style={[styles.productCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {product.images?.[0] ? (
                <Image
                  source={product.images[0]}
                  style={[styles.productCardImage, { backgroundColor: theme.border }]}
                  resizeMode="cover"
                />
              ) : null}
              <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={2}>
                {product.title}
              </Text>
              <Text style={[textStyles.caption, { color: theme.secondaryText, marginTop: spacing.xs }]}>
                {product.propertyLocation}
              </Text>
              <Text style={[textStyles.price, { color: theme.accent, marginTop: spacing.xs }]}>
                {localizeUnits(product.expectedReturn, t)}
              </Text>
            </View>
          ) : null}

          {/* 담당자 답장이 아직 없을 때의 안내 — 화면에서만 보여 준다.
              메시지로 넣으면 고객의 미읽음 수에 잡히고 번역 비용도 든다.
              담당자 본인에게는 보여 주지 않는다(자기가 답할 차례다). */}
          {!isAgentView && messages.length > 0 && !messages.some((m) => m.sender_type === "agent") ? (
            <View style={[styles.waitingNotice, { borderColor: theme.border }]}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("investChat.waitingForAgent")}
              </Text>
            </View>
          ) : null}

          {messages.length === 0 ? (
            <View style={[styles.waitingNotice, { borderColor: theme.border }]}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("investChat.emptyHint")}
              </Text>
            </View>
          ) : null}

          {messages.map((message) => {
            // "내 말풍선"은 보는 사람에 따라 달라진다 — 담당자 화면에서 자기 답장이
            // 상대편 자리에 찍히지 않도록.
            const isMine = isAgentView
              ? message.sender_type === "agent"
              : message.sender_type === "customer";
            const text = displayTexts[`${message.id}:${language}`] ?? message.original_text;
            return (
              <View key={message.id} style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                {message.image_url ? (
                  <Pressable onPress={() => setPreviewImageUrl(message.image_url)} accessibilityRole="imagebutton">
                    <Image source={{ uri: message.image_url }} style={styles.messageImage} resizeMode="cover" />
                  </Pressable>
                ) : (
                  <View
                    style={[
                      styles.bubble,
                      isMine
                        ? [styles.bubbleMine, { backgroundColor: theme.accent }]
                        : [styles.bubbleTheirs, { backgroundColor: theme.card, borderColor: theme.border }],
                    ]}
                  >
                    <Text style={[textStyles.bodySmall, { color: isMine ? theme.onAccent : theme.text }]}>{text}</Text>
                    {/* 상한을 넘은 상대 메시지는 번역하지 않는다 — 원문만 두면
                        번역이 고장 난 것처럼 보이므로 이유를 밝힌다. */}
                    {!isMine
                      && message.original_lang !== language
                      && isTooLongToTranslate(message.original_text) ? (
                      <Text style={[textStyles.caption, styles.translateSkipped, { color: theme.secondaryText }]}>
                        {t("chat.translationSkippedLength", { limit: MAX_TRANSLATE_CHARS })}
                      </Text>
                    ) : null}
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

      <AppModal visible={lengthWarningOpen} onClose={() => setLengthWarningOpen(false)}>
        <Text style={[textStyles.body, { color: theme.text }]}>{t("chat.lengthLimitNotice")}</Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText, marginTop: spacing.xs }]}>
          {t("chat.lengthLimitHint", { limit: MAX_TRANSLATE_CHARS })}
        </Text>
        <Button
          title={t("common.confirm")}
          onPress={() => setLengthWarningOpen(false)}
          style={{ marginTop: spacing.md }}
        />
      </AppModal>

      <Modal visible={!!previewImageUrl} transparent animationType="fade" onRequestClose={() => setPreviewImageUrl(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreviewImageUrl(null)}>
          {previewImageUrl ? <Image source={{ uri: previewImageUrl }} style={styles.previewImage} resizeMode="contain" /> : null}
          <Pressable
            onPress={() => setPreviewImageUrl(null)}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            style={styles.previewClose}
          >
            <Ionicons name="close" size={28} color={colors.light.onAccent} />
          </Pressable>
        </Pressable>
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

const styles = createScaledStyles(() => ({
  container: { flex: 1 },
  flex: { flex: 1 },
  messages: { padding: spacing.md, gap: spacing.sm },
  productCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  productCardImage: {
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
  translateSkipped: { marginTop: 4 },
  waitingNotice: {
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMine: { borderBottomRightRadius: radius.sm },
  bubbleTheirs: {
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: radius.sm,
  },
  messageImage: { width: 180, height: 180, borderRadius: radius.md },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.sm,
  },
  attachButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  inputContainer: { flex: 1, marginBottom: 0 },
  input: { maxHeight: 100 },
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
  previewImage: { width: "100%", height: "80%" },
  previewClose: {
    position: "absolute",
    top: 48,
    right: spacing.lg,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
}));
