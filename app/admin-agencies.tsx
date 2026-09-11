import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import {
  getAgencyDocumentUrl,
  listAgencyApplications,
  reviewAgency,
  type AdminAgency,
  type AgencyApprovalStatus,
} from "@/services/agencies";
import { isAdmin } from "@/services/roles";

/**
 * [2026-09-11 사용자 지시] 부동산 등록신청 심사 — 관리자 전용.
 *
 * 승인은 상태만 바꾸는 일이 아니다. 서버 함수(admin_review_agency)가 승인과 동시에
 * property_listing/chat/account_active 권한을 켜 준다 — 화면은 승인/반려 의사만 보낸다.
 *
 * 중개번호 첨부는 비공개 버킷에 있어 URL을 그냥 만들 수 없다. 볼 때마다 10분짜리
 * 서명 URL을 새로 받아 연다.
 */

const STATUS_ORDER: AgencyApprovalStatus[] = ["pending", "approved", "rejected", "suspended"];

export default function AdminAgenciesScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [agencies, setAgencies] = useState<AdminAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AgencyApprovalStatus>("pending");
  const [rejectTarget, setRejectTarget] = useState<AdminAgency | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
        const result = await listAgencyApplications();
        if (!active) return;
        setAgencies(result);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function refresh() {
    setAgencies(await listAgencyApplications());
  }

  async function handleApprove(agency: AdminAgency) {
    setBusyId(agency.id);
    const ok = await reviewAgency(agency.id, true);
    setBusyId(null);
    showToast(ok ? t("adminAgencies.approved") : t("adminAgencies.actionFailed"));
    if (ok) await refresh();
  }

  async function handleReject() {
    if (!rejectTarget) return;
    const target = rejectTarget;
    setBusyId(target.id);
    const ok = await reviewAgency(target.id, false, rejectReason);
    setBusyId(null);
    setRejectTarget(null);
    setRejectReason("");
    showToast(ok ? t("adminAgencies.rejected") : t("adminAgencies.actionFailed"));
    if (ok) await refresh();
  }

  async function handleOpenDocument(agency: AdminAgency) {
    const url = await getAgencyDocumentUrl(agency.licenseFilePath);
    if (!url) {
      showToast(t("adminAgencies.documentFailed"));
      return;
    }
    Linking.openURL(url);
  }

  const screenTitle = t("adminAgencies.title");
  const visible = agencies.filter((agency) => agency.approvalStatus === statusFilter);

  if (allowed === null || loading) {
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
        <EmptyState
          title={t("adminAgencies.noPermissionTitle")}
          description={t("adminAgencies.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />

      <View style={[styles.tabRow, { borderBottomColor: theme.border }]}>
        {STATUS_ORDER.map((status) => {
          const active = status === statusFilter;
          const count = agencies.filter((agency) => agency.approvalStatus === status).length;
          return (
            <Pressable
              key={status}
              onPress={() => setStatusFilter(status)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.tab,
                { borderTopColor: active ? theme.accent : "transparent", opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text
                style={[
                  textStyles.bodySmall,
                  {
                    color: active ? theme.accent : theme.secondaryText,
                    fontWeight: active ? typography.weight.medium : typography.weight.regular,
                  },
                ]}
                numberOfLines={1}
              >
                {`${t(`adminAgencies.status.${status}`)} ${count}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {visible.length === 0 ? (
        <EmptyState title={t("adminAgencies.emptyTitle")} description={t("adminAgencies.emptyDescription")} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {visible.map((agency) => (
            <View
              key={agency.id}
              style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}
            >
              <Text style={[textStyles.cardTitle, { color: theme.text }]}>{agency.name}</Text>

              <Field label={t("agencyApply.region")} value={agency.region} />
              <Field label={t("agencyApply.contactName")} value={agency.contactName} />
              <Field label={t("agencyApply.phone")} value={agency.phone} />
              <Field label={t("agencyApply.address")} value={agency.address} />
              <Field
                label={t("agencyApply.registrationNo")}
                value={agency.registrationNo || t("agencyApply.noLicense")}
              />

              {agency.licenseFilePath.length > 0 ? (
                <Pressable
                  onPress={() => handleOpenDocument(agency)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.docRow, { opacity: pressed ? opacity.pressed : 1 }]}
                >
                  <Ionicons name="document-attach-outline" size={16} color={theme.accent} />
                  <Text style={[textStyles.bodySmall, { color: theme.accent }]}>
                    {t("adminAgencies.viewDocument")}
                  </Text>
                </Pressable>
              ) : null}

              {agency.approvalStatus === "rejected" && agency.rejectionReason.length > 0 ? (
                <Text style={[textStyles.caption, { color: theme.danger }]}>
                  {agency.rejectionReason}
                </Text>
              ) : null}

              {/* 승인된 신청도 반려로 되돌릴 수 있어야 한다(잘못 승인했을 때) —
                  반려는 권한까지 함께 내리므로 실질적인 정지 수단이다. */}
              <View style={styles.actions}>
                {agency.approvalStatus !== "approved" ? (
                  <Button
                    title={t("adminAgencies.approve")}
                    size="small"
                    onPress={() => handleApprove(agency)}
                    loading={busyId === agency.id}
                    style={styles.actionButton}
                  />
                ) : null}
                {agency.approvalStatus !== "rejected" ? (
                  <Button
                    title={t("adminAgencies.reject")}
                    size="small"
                    variant="secondary"
                    onPress={() => {
                      setRejectTarget(agency);
                      setRejectReason("");
                    }}
                    style={styles.actionButton}
                  />
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal
        visible={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("adminAgencies.rejectTitle")}
        </Text>
        <Input
          placeholder={t("adminAgencies.rejectReasonPlaceholder")}
          value={rejectReason}
          onChangeText={setRejectReason}
          multiline
        />
        <Button
          title={t("adminAgencies.reject")}
          onPress={handleReject}
          style={styles.modalButton}
        />
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const theme = colors.light;
  if (value.length === 0) return null;
  return (
    <View style={styles.field}>
      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{label}</Text>
      <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1, textAlign: "right" }]}>
        {value}
      </Text>
    </View>
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
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionButton: {
    flex: 1,
  },
  modalButton: {
    marginTop: spacing.md,
  },
});
