import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { listManagedConversations, type ManagedConversation } from "@/services/chat";
import { getSession, onAuthStateChange } from "@/services/auth";
import { canRegisterProperty } from "@/services/roles";

/**
 * [2026-09-11] 상담 목록 — 매물 담당자(중개업소/관리자)가 받은 상담을 보는 화면.
 *
 * 왜 필요한가: 채팅은 고객이 매물 상세에서 시작한다. 담당자가 같은 경로로 들어가면
 * getOrCreateConversation이 **담당자 본인 명의의 새 대화**를 만들어 버려 고객의 상담이
 * 보이지 않는다. 담당자에게는 "어떤 대화가 와 있는지" 목록이 따로 있어야 한다.
 *
 * 어떤 대화가 보이는지는 서버(RLS can_manage_property_chat)가 정한다 — 이 화면은
 * 전체를 요청할 뿐이고, 내가 담당하지 않는 매물의 상담은 애초에 돌아오지 않는다.
 */

export default function ChatInboxScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [conversations, setConversations] = useState<ManagedConversation[]>([]);
  const [loading, setLoading] = useState(true);

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
    let mounted = true;
    if (!session) {
      setAllowed(false);
      setCheckingPermission(false);
      return;
    }
    canRegisterProperty().then((ok) => {
      if (mounted) {
        setAllowed(ok);
        setCheckingPermission(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [session]);

  // 상담은 수시로 들어오므로 화면에 들어올 때마다 다시 불러온다(대화를 보고
  // 돌아왔을 때 목록이 옛날 그대로면 방금 읽은 것이 그대로 "답장 필요"로 남는다).
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      listManagedConversations().then((result) => {
        if (!active) return;
        setConversations(result);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [session]),
  );

  const screenTitle = t("chatInbox.title");

  if (sessionLoading || checkingPermission) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <EmptyState title={t("chatInbox.noPermissionTitle")} description={t("chatInbox.noPermissionDescription")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />

      {loading ? (
        <Loading />
      ) : conversations.length === 0 ? (
        <EmptyState title={t("chatInbox.emptyTitle")} description={t("chatInbox.emptyDescription")} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {conversations.map((conversation) => (
            <Pressable
              key={conversation.id}
              onPress={() =>
                router.push({
                  pathname: "/property-chat/[id]",
                  params: { id: conversation.propertyId, conversationId: conversation.id },
                })
              }
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                { borderColor: theme.border, backgroundColor: theme.card, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <View style={styles.rowTexts}>
                <View style={styles.titleRow}>
                  <Text
                    style={[textStyles.cardTitle, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {conversation.propertyTitle}
                  </Text>
                  {/* 마지막 말이 고객 것이면 아직 답이 나가지 않았다는 뜻이다. */}
                  {conversation.needsReply ? (
                    <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                      <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                        {t("chatInbox.needsReply")}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {conversation.propertyAddress.length > 0 ? (
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                    {conversation.propertyAddress}
                  </Text>
                ) : null}

                <Text
                  style={[
                    textStyles.bodySmall,
                    { color: conversation.lastMessageText ? theme.text : theme.secondaryText },
                  ]}
                  numberOfLines={1}
                >
                  {conversation.lastMessageText || t("chatInbox.imageMessage")}
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  const theme = colors.light;
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
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  rowTexts: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.full,
  },
});
