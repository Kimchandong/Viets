import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import { listManagedConversations, type ManagedConversation } from "@/services/chat";
import { listInvestConversations, type InvestConversation } from "@/services/investChat";

/**
 * [2026-09-28 사용자 지시] MY > 나의활동 > 채팅상담 정보.
 *
 * "내가 건 상담"을 한자리에 모은다 — 매물 상세에서 문의한 것(매물 탭)과 투자
 * 상품에서 상담한 것(투자 탭).
 *
 * app/chat-inbox.tsx와 헷갈리기 쉬운데 방향이 반대다: chat-inbox는 **담당자가
 * 받은** 상담이고(권한 없으면 못 들어간다), 이 화면은 **내가 건** 상담이다.
 * 그래서 두 목록 모두 onlyMine으로 요청한다 — 중개업소 계정이면 RLS만으로는
 * 자기가 담당하는 남의 문의까지 함께 돌아와 이 화면의 뜻이 달라진다.
 */

type TabKey = "property" | "invest";

export default function ChatConsultsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("property");
  const [propertyRows, setPropertyRows] = useState<ManagedConversation[]>([]);
  const [investRows, setInvestRows] = useState<InvestConversation[]>([]);
  const [loading, setLoading] = useState(true);

  // 화면에 들어올 때마다 다시 불러온다 — 대화를 보고 돌아왔을 때 목록이 옛날
  // 그대로면 방금 읽은 상담이 그대로 남아 있는 것처럼 보인다.
  // 두 탭을 함께 불러온다: 탭을 옮길 때마다 기다리게 하지 않으려는 것이고,
  // 어느 쪽에 대화가 있는지도 들어오자마자 보인다.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([
        listManagedConversations({ onlyMine: true }),
        listInvestConversations({ onlyMine: true }),
      ]).then(([properties, investments]) => {
        if (!active) return;
        setPropertyRows(properties);
        setInvestRows(investments);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  function renderTabButton(key: TabKey, label: string, count: number) {
    const active = tab === key;
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
  }

  const rows = tab === "property" ? propertyRows : investRows;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("chatConsults.title")} leftAction={<BackButton fallback="/my" />} />

      <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
        {renderTabButton("property", t("chatConsults.tabProperty"), propertyRows.length)}
        {renderTabButton("invest", t("chatConsults.tabInvest"), investRows.length)}
      </View>

      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("chatConsults.emptyTitle")}
          description={
            tab === "property"
              ? t("chatConsults.emptyPropertyDescription")
              : t("chatConsults.emptyInvestDescription")
          }
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {tab === "property"
            ? propertyRows.map((row) => (
                <ConsultRow
                  key={row.id}
                  title={row.propertyTitle}
                  subtitle={row.propertyAddress}
                  lastText={row.lastMessageText}
                  // 내가 건 상담이므로 "답장 필요"는 상대(담당자)가 아직 말이
                  // 없을 때가 아니라, 담당자가 마지막으로 말했을 때 알려 준다.
                  highlight={row.lastSenderType === "agent"}
                  onPress={() =>
                    router.push({
                      pathname: "/property-chat/[id]",
                      params: { id: row.propertyId, conversationId: row.id },
                    })
                  }
                />
              ))
            : investRows.map((row) => (
                <ConsultRow
                  key={row.id}
                  title={row.investmentTitle}
                  subtitle=""
                  lastText={row.lastMessageText}
                  highlight={row.lastSenderType === "agent"}
                  onPress={() => router.push({ pathname: "/invest-chat/[id]", params: { id: row.id } })}
                />
              ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ConsultRow({
  title,
  subtitle,
  lastText,
  highlight,
  onPress,
}: {
  title: string;
  subtitle: string;
  lastText: string;
  highlight: boolean;
  onPress: () => void;
}) {
  const theme = colors.light;
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.border, backgroundColor: theme.card, opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      <View style={styles.rowTexts}>
        <View style={styles.titleRow}>
          <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          {highlight ? (
            <View style={[styles.badge, { backgroundColor: theme.accent }]}>
              <Text style={[textStyles.caption, { color: theme.onAccent }]}>{t("chatConsults.newReply")}</Text>
            </View>
          ) : null}
        </View>

        {subtitle.length > 0 ? (
          <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}

        <Text
          style={[textStyles.bodySmall, { color: lastText ? theme.text : theme.secondaryText }]}
          numberOfLines={1}
        >
          {lastText || t("chatInbox.imageMessage")}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />
    </Pressable>
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
    // 선택 표시는 밑줄이다. 두께를 항상 두고 색만 바꾼다 — 선택될 때만 테두리를
    // 붙이면 그 순간 글자가 2px 밀린다.
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
