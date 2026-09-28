import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import { listManagedConversations, type ManagedConversation } from "@/services/chat";
import { listInvestConversations, type InvestConversation } from "@/services/investChat";
import { getSession, onAuthStateChange } from "@/services/auth";
import { canSeeChatConsults, canSeeInvestConsults } from "@/services/roles";

/**
 * [2026-09-11] 상담 목록 — 매물 담당자(중개업소/관리자)가 받은 상담을 보는 화면.
 *
 * 왜 필요한가: 채팅은 고객이 매물 상세에서 시작한다. 담당자가 같은 경로로 들어가면
 * getOrCreateConversation이 **담당자 본인 명의의 새 대화**를 만들어 버려 고객의 상담이
 * 보이지 않는다. 담당자에게는 "어떤 대화가 와 있는지" 목록이 따로 있어야 한다.
 *
 * 어떤 대화가 보이는지는 서버(RLS can_manage_property_chat)가 정한다 — 이 화면은
 * 전체를 요청할 뿐이고, 내가 담당하지 않는 매물의 상담은 애초에 돌아오지 않는다.
 *
 * [2026-09-28 사용자 지시] 투자 탭 추가. 직원(chat_support)은 매물·투자 상담을
 * 둘 다 보고, 중개업소는 매물만 본다 — 투자 상품은 플랫폼이 직접 올리므로
 * 업체가 볼 상담이 없다. 그래서 투자 탭은 권한이 있을 때만 그린다(빈 탭을
 * 보여 주면 "상담이 없다"와 "권한이 없다"가 구분되지 않는다).
 */

export default function ChatInboxScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [investAllowed, setInvestAllowed] = useState(false);
  const [tab, setTab] = useState<"property" | "invest">("property");
  const [conversations, setConversations] = useState<ManagedConversation[]>([]);
  const [investConversations, setInvestConversations] = useState<InvestConversation[]>([]);
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
    Promise.all([canSeeChatConsults(), canSeeInvestConsults()]).then(([ok, investOk]) => {
      if (!mounted) return;
      setAllowed(ok);
      setInvestAllowed(investOk);
      setCheckingPermission(false);
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
      // 두 목록을 함께 불러온다 — 탭을 옮길 때마다 기다리게 하지 않는다.
      Promise.all([
        listManagedConversations(),
        investAllowed ? listInvestConversations() : Promise.resolve<InvestConversation[]>([]),
      ]).then(([properties, investments]) => {
        if (!active) return;
        setConversations(properties);
        setInvestConversations(investments);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [session, investAllowed]),
  );

  const screenTitle = t("chatInbox.title");

  if (sessionLoading || checkingPermission) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />
        <EmptyState title={t("chatInbox.noPermissionTitle")} description={t("chatInbox.noPermissionDescription")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />

      {/* 투자 상담을 볼 수 없는 계정(중개업소)에게는 탭 자체를 그리지 않는다 —
          누를 수 없는 탭이나 늘 비어 있는 탭보다 없는 편이 낫다. */}
      {investAllowed ? (
        <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
          {(["property", "invest"] as const).map((key) => {
            const active = tab === key;
            const count = key === "property" ? conversations.length : investConversations.length;
            const label = key === "property" ? t("chatConsults.tabProperty") : t("chatConsults.tabInvest");
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.tabButton,
                  {
                    borderBottomColor: active ? theme.accent : "transparent",
                    opacity: pressed ? opacity.pressed : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    textStyles.body,
                    { color: active ? theme.accent : theme.secondaryText, fontWeight: active ? "700" : "400" },
                  ]}
                >
                  {count > 0 ? `${label} ${count}` : label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {loading ? (
        <Loading />
      ) : investAllowed && tab === "invest" ? (
        investConversations.length === 0 ? (
          <EmptyState title={t("chatInbox.emptyTitle")} description={t("chatInbox.emptyInvestDescription")} />
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {investConversations.map((conversation) => (
              <Pressable
                key={conversation.id}
                onPress={() => router.push({ pathname: "/invest-chat/[id]", params: { id: conversation.id } })}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.row,
                  { borderColor: theme.border, backgroundColor: theme.card, opacity: pressed ? opacity.pressed : 1 },
                ]}
              >
                <View style={styles.rowTexts}>
                  <View style={styles.titleRow}>
                    <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                      {conversation.investmentTitle}
                    </Text>
                    {conversation.needsReply ? (
                      <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                        <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                          {t("chatInbox.needsReply")}
                        </Text>
                      </View>
                    ) : null}
                  </View>
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
        )
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


const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.sm,
    // 두께를 항상 두고 색만 바꾼다 — 선택될 때만 테두리를 붙이면 글자가 밀린다.
    borderBottomWidth: 2,
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
}));
