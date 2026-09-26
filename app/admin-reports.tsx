import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles, typography, scaleFont } from "@/constants/theme";
import { sendNotificationPush } from "@/services/notifications";
import { isAdmin } from "@/services/roles";
import {
  listPropertyReports,
  resolvePropertyReports,
  type PropertyReportGroup,
} from "@/services/reports";

/**
 * [2026-09-12 사용자 지시] 허위매물 신고 목록 — 관리자 전용.
 *
 * 미처리(open)가 위로 오도록 서버에서 정렬해 온다. 관리자가 매물을 직접 보고 판단해야
 * 하므로 줄을 누르면 그 매물 상세로 간다 — 목록에서 제목만 보고는 허위인지 알 수 없다.
 */
export default function AdminReportsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<PropertyReportGroup[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await listPropertyReports();
    setReports(list);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      isAdmin().then(async (ok) => {
        if (!active) return;
        setAllowed(ok);
        if (!ok) {
          setLoading(false);
          return;
        }
        await load();
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

  async function handleResolve(report: PropertyReportGroup) {
    setBusyId(report.propertyId);
    const resolvedIds = await resolvePropertyReports(report.propertyId);
    setBusyId(null);
    const ok = resolvedIds !== null;
    showToast(ok ? t("adminReports.resolved") : t("adminReports.actionFailed"));
    if (!ok) return;

    // [2026-09-16 2차 검토에서 발견 — 결함] 수신함에만 들어가고 푸시는 나가지 않았다.
    //
    // 승인·반려·QA 답변 화면은 모두 누른 직후 sendNotificationPush를 부르는데 이
    // 화면만 빠져 있었다. 신고 한 건마다 알림이 하나씩 생기므로(한 매물에 여러 명이
    // 신고할 수 있다) 처리된 id마다 한 번씩 부른다. 실패해도 무시한다 — 처리는 이미
    // 끝났고 알림은 수신함에 남아 있다.
    for (const id of resolvedIds) {
      void sendNotificationPush("report_resolved", id);
    }

    await load();
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("adminReports.title")} leftAction={<BackButton fallback="/my" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("adminReports.title")} leftAction={<BackButton fallback="/my" />} />
        <EmptyState
          title={t("adminReports.noPermissionTitle")}
          description={t("adminReports.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("adminReports.title")} leftAction={<BackButton fallback="/my" />} />

      {reports.length === 0 ? (
        <EmptyState
          title={t("adminReports.emptyTitle")}
          description={t("adminReports.emptyDescription")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {reports.map((report) => {
            const open = report.openCount > 0;
            return (
              <View
                key={report.propertyId}
                style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}
              >
                <View style={styles.headRow}>
                  <View style={styles.headLeft}>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: open ? theme.danger : theme.border },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          { color: open ? theme.onAccent : theme.secondaryText },
                        ]}
                      >
                        {t(`adminReports.status.${open ? "open" : "resolved"}`)}
                      </Text>
                    </View>
                    {/* [2026-09-12 사용자 결정] 같은 매물을 여러 사람이 신고할 수 있으므로
                        건수를 함께 보여 준다 — 여러 명이 신고한 매물이 더 의심스럽다. */}
                    <Text style={[textStyles.caption, { color: theme.danger }]}>
                      {t("adminReports.count", { count: report.count })}
                    </Text>
                  </View>
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                    {report.latestAt.slice(0, 10)}
                  </Text>
                </View>

                <Pressable
                  onPress={() => router.push(`/property-detail/${report.propertyId}`)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.titleRow, { opacity: pressed ? opacity.pressed : 1 }]}
                >
                  <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]} numberOfLines={2}>
                    {report.propertyTitle || t("adminReports.deletedProperty")}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />
                </Pressable>

                {open ? (
                  <Button
                    size="small"
                    variant="outline"
                    title={t("adminReports.resolve")}
                    onPress={() => handleResolve(report)}
                    disabled={busyId === report.propertyId}
                  />
                ) : null}
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
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: scaleFont(10),
    fontWeight: typography.weight.medium,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
}));
