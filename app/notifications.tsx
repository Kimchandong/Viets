import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { createScaledStyles, colors, describeTypographyScale, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
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
import { getPushRegistrationStatus, registerPushToken } from "@/services/push";
import { checkAndApplyUpdate, describeUpdateRuntime, getUpdateStatus } from "@/services/updates";

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
  const [pushStatus, setPushStatus] = useState(getPushRegistrationStatus());
  const [updateStatus, setUpdateStatus] = useState(getUpdateStatus());
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
      // [2026-09-26] 화면에 들어올 때마다 푸시 등록 상태를 다시 읽는다.
      // 사용자가 휴대폰 설정에서 권한을 켜고 돌아오면 그 결과가 바로 보여야 한다.
      void registerPushToken().then(() => {
        if (active) setPushStatus(getPushRegistrationStatus());
      });
      if (active) setUpdateStatus(getUpdateStatus());
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

          {/* [2026-09-26] 이 기기가 푸시를 받을 수 있는 상태인지 한 줄로 보여 준다.
              왜 넣었나: 등록이 실패해도 앱은 아무 말 없이 넘어가도록 만들어져 있어
              (알림 하나 때문에 로그인이 막히면 안 되므로) **실패를 알 방법이 없었다.**
              실제로 관리자 계정에 토큰이 끝내 생기지 않았는데 원인을 화면에서도
              로그에서도 확인할 수 없었다. 여기 한 줄이면 사용자가 바로 읽고 말해 줄 수 있다.

              눌러서 다시 시도할 수 있게 둔다 — 권한을 켜고 돌아왔을 때 앱을 다시
              켜지 않아도 되도록. */}
          <Pressable
            testID="push-status-row"
            onPress={async () => {
              await registerPushToken();
              setPushStatus(getPushRegistrationStatus());
            }}
            style={({ pressed }) => [styles.pushStatus, { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 }]}
          >
            <Ionicons
              name={
                pushStatus.state === "ok"
                  ? "checkmark-circle-outline"
                  : pushStatus.state === "failed"
                    ? "alert-circle-outline"
                    : "information-circle-outline"
              }
              size={16}
              color={pushStatus.state === "failed" ? theme.danger : theme.secondaryText}
            />
            <Text
              style={[
                textStyles.caption,
                styles.pushStatusText,
                { color: pushStatus.state === "failed" ? theme.danger : theme.secondaryText },
              ]}
            >
              {pushStatus.reason}
            </Text>
            <Ionicons name="refresh-outline" size={14} color={theme.secondaryText} />
          </Pressable>

          {/* [2026-09-26 사용자 지시] 이 앱이 OTA를 제대로 물고 있는지 **눈으로 확인**하는 줄.
              빌드하고 나서 "업데이트가 왜 안 오지"를 추측으로 풀지 않기 위한 것이다.
              채널이 비어 있으면 eas update를 올려도 이 앱에는 오지 않는다 — 그걸 여기서 본다.
              눌러서 지금 바로 확인할 수 있다(새 번들이 있으면 받아서 앱이 재시작된다). */}
          <Pressable
            testID="ota-status-row"
            onPress={async () => {
              setUpdateStatus({ state: "checking", reason: "업데이트 확인 중…" });
              setUpdateStatus(await checkAndApplyUpdate());
            }}
            style={({ pressed }) => [styles.pushStatus, { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 }]}
          >
            <Ionicons
              name={
                updateStatus.state === "failed"
                  ? "alert-circle-outline"
                  : updateStatus.state === "latest"
                    ? "checkmark-circle-outline"
                    : "cloud-download-outline"
              }
              size={16}
              color={updateStatus.state === "failed" ? theme.danger : theme.secondaryText}
            />
            <View style={styles.pushStatusText}>
              <Text
                style={[
                  textStyles.caption,
                  { color: updateStatus.state === "failed" ? theme.danger : theme.secondaryText },
                ]}
              >
                {updateStatus.reason}
              </Text>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                {describeUpdateRuntime()}
              </Text>
              {/* [2026-09-26] 글자 크기 진단 — 기기마다 글자가 다르게 보일 때
                  추측하지 않고 숫자를 읽기 위한 줄이다. */}
              <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                {describeTypographyScale()}
              </Text>
            </View>
            <Ionicons name="refresh-outline" size={14} color={theme.secondaryText} />
          </Pressable>
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

const styles = createScaledStyles(() => ({
  // 푸시 등록 상태 한 줄. 테두리만 두고 배경은 두지 않는다 — 알림 목록이 주인공이고
  // 이 줄은 문제가 있을 때만 눈에 걸리면 된다.
  pushStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pushStatusText: {
    flex: 1,
  },
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
}));
