import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import {
  deleteNotification,
  listDisabledNotificationKinds,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationKindEnabled,
  NOTIFICATION_KINDS,
  type AppNotification,
} from "@/services/notifications";

/**
 * [2026-09-12 사용자 지시] 알림 수신함.
 *
 * 지금까지 알림은 흘러가기만 했다 — 푸시는 알림창을 지우면 끝이고, MY 토스트는 몇 초
 * 뒤 사라졌다. 광고비가 소진돼 순위에서 빠졌다는 알림을 놓치면 왜 노출이 멈췄는지
 * 알 방법이 없었다.
 *
 * 문구는 서버가 아니라 여기서 만든다. 서버는 종류(kind)와 값(params)만 남긴다 —
 * 앱이 6개 언어라 문장을 저장하면 다른 언어 사용자가 남의 언어를 읽게 되고, 사용자가
 * 언어를 바꿔도 지난 알림은 그대로 남는다.
 *
 * 설정(종류별 켜기/끄기)을 같은 화면에 둔 이유: 알림이 성가셔서 끄려는 사람은 알림을
 * 보고 있는 순간에 그렇게 생각한다. 설정 화면을 따로 찾아가게 하면 대신 앱 전체의
 * 알림을 꺼 버린다.
 */
export default function NotificationsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [disabledKinds, setDisabledKinds] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, disabled] = await Promise.all([
      listNotifications(),
      listDisabledNotificationKinds(),
    ]);
    setItems(list);
    setDisabledKinds(disabled);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().then(() => {
        if (!active) return;
      });
      return () => {
        active = false;
      };
    }, [load]),
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  /**
   * 알림을 누르면 읽음으로 바꾸고 목적지로 간다.
   *
   * 읽음 표시를 기다리지 않는 이유: 목적지로 가는 것이 사용자가 원한 일이고, 읽음은
   * 그 부수 효과다. 서버 왕복 때문에 화면 전환이 늦어지면 안 된다.
   */
  function openNotification(item: AppNotification) {
    if (!item.readAt) {
      void markNotificationRead(item.id);
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row,
        ),
      );
    }
    if (item.link) router.push(item.link as "/my");
  }

  async function handleMarkAll() {
    await markAllNotificationsRead();
    setItems((prev) => prev.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })));
    showToast(t("notifications.allReadDone"));
  }

  async function handleDelete(id: string) {
    const ok = await deleteNotification(id);
    if (!ok) {
      showToast(t("notifications.actionFailed"));
      return;
    }
    setItems((prev) => prev.filter((row) => row.id !== id));
  }

  async function toggleKind(kind: string) {
    const nowDisabled = disabledKinds.includes(kind);
    // 화면을 먼저 바꾸고 서버에 보낸다 — 토글은 눌렀을 때 즉시 움직여야 눌린 느낌이 난다.
    setDisabledKinds((prev) => (nowDisabled ? prev.filter((k) => k !== kind) : [...prev, kind]));
    const ok = await setNotificationKindEnabled(kind, nowDisabled);
    if (!ok) {
      setDisabledKinds((prev) => (nowDisabled ? [...prev, kind] : prev.filter((k) => k !== kind)));
      showToast(t("notifications.actionFailed"));
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header
        title={t("notifications.title")}
        leftAction={<BackButton fallback="/my" />}
        rightAction={
          <Pressable
            onPress={() => setShowSettings((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={t("notifications.settings")}
            style={({ pressed }) => [{ opacity: pressed ? opacity.pressed : 1 }]}
          >
            <Ionicons
              name={showSettings ? "close" : "options-outline"}
              size={22}
              color={theme.text}
            />
          </Pressable>
        }
      />

      {showSettings ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("notifications.settingsHint")}
          </Text>
          {NOTIFICATION_KINDS.map((kind) => {
            const enabled = !disabledKinds.includes(kind);
            return (
              <Pressable
                key={kind}
                onPress={() => toggleKind(kind)}
                accessibilityRole="switch"
                accessibilityState={{ checked: enabled }}
                style={({ pressed }) => [
                  styles.settingRow,
                  { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                ]}
              >
                <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]}>
                  {t(`notifications.kind.${kind}.title`)}
                </Text>
                <Ionicons
                  name={enabled ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={enabled ? theme.accent : theme.secondaryText}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("notifications.emptyTitle")}
          description={t("notifications.emptyDescription")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {items.some((item) => !item.readAt) ? (
            <Pressable
              onPress={handleMarkAll}
              accessibilityRole="button"
              style={({ pressed }) => [styles.markAll, { opacity: pressed ? opacity.pressed : 1 }]}
            >
              <Text style={[textStyles.caption, { color: theme.accent }]}>
                {t("notifications.markAllRead")}
              </Text>
            </Pressable>
          ) : null}

          {items.map((item) => {
            const unread = !item.readAt;
            return (
              <View
                key={item.id}
                style={[
                  styles.card,
                  {
                    borderColor: unread ? theme.accent : theme.border,
                    backgroundColor: theme.card,
                  },
                ]}
              >
                <Pressable
                  onPress={() => openNotification(item)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.cardBody, { opacity: pressed ? opacity.pressed : 1 }]}
                >
                  <View style={styles.titleRow}>
                    {/* 안 읽은 것에만 점을 찍는다 — 배지를 두 번 그리지 않는다. */}
                    {unread ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
                    <Text
                      style={[
                        textStyles.bodySmall,
                        {
                          color: theme.text,
                          flex: 1,
                          fontWeight: unread ? typography.weight.medium : typography.weight.regular,
                        },
                      ]}
                    >
                      {t(`notifications.kind.${item.kind}.title`)}
                    </Text>
                    <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                      {item.createdAt.slice(5, 10)}
                    </Text>
                  </View>

                  <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                    {t(`notifications.kind.${item.kind}.body`, item.params)}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => handleDelete(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t("notifications.deleteOne")}
                  hitSlop={8}
                  style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? opacity.pressed : 1 }]}
                >
                  <Ionicons name="close" size={16} color={theme.secondaryText} />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
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
  markAll: {
    alignSelf: "flex-end",
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  deleteButton: {
    paddingTop: 2,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
