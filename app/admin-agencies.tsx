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

/** 상단 사각 탭 — 신청 / 승인 / 반려. */
const STATUS_ORDER: AgencyApprovalStatus[] = ["pending", "approved", "rejected"];

export default function AdminAgenciesScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [agencies, setAgencies] = useState<AdminAgency[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AgencyApprovalStatus>("pending");
  // [2026-09-11 사용자 지시 — 4차] 목록은 업체명·지역·중개업 여부만 보여 주고,
  // 줄을 누르면 신청 내역 전체와 승인/반려 버튼이 나온다 — 목록에 모든 항목을
  // 펼쳐 두면 신청이 몇 건만 쌓여도 훑기 어렵다.
  const [detail, setDetail] = useState<AdminAgency | null>(null);
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
    if (ok) {
      setDetail(null);
      await refresh();
    }
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
    if (ok) {
      setDetail(null);
      await refresh();
    }
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
            <Pressable
              key={agency.id}
              onPress={() => setDetail(agency)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                { borderColor: theme.border, backgroundColor: theme.card, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <View style={styles.rowTexts}>
                <View style={styles.titleRow}>
                  <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                    {agency.name}
                  </Text>
                  {/* 중개번호가 있으면 "중개업"이라고만 알린다(번호 자체는 상세에서). */}
                  {agency.registrationNo.length > 0 ? (
                    <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                      <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                        {t("adminAgencies.licensedBadge")}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                  {agency.region || "-"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* 신청 내역 — 줄을 눌렀을 때만 뜬다. 승인/반려도 여기서 한다. */}
      <Modal visible={!!detail} onClose={() => setDetail(null)} accessibilityLabel={t("common.cancel")}>
        {detail ? (
          <>
            <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
              {detail.name}
            </Text>

            <Field label={t("agencyApply.region")} value={detail.region} />
            <Field label={t("agencyApply.contactName")} value={detail.contactName} />
            <Field label={t("agencyApply.phone")} value={detail.phone} />
            <Field label={t("agencyApply.address")} value={detail.address} />
            <Field
              label={t("agencyApply.registrationNo")}
              value={detail.registrationNo || t("agencyApply.noLicense")}
            />

            {detail.licenseFilePath.length > 0 ? (
              <Pressable
                onPress={() => handleOpenDocument(detail)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.docRow, { opacity: pressed ? opacity.pressed : 1 }]}
              >
                <Ionicons name="document-attach-outline" size={16} color={theme.accent} />
                <Text style={[textStyles.bodySmall, { color: theme.accent }]}>
                  {t("adminAgencies.viewDocument")}
                </Text>
              </Pressable>
            ) : null}

            {detail.approvalStatus === "rejected" && detail.rejectionReason.length > 0 ? (
              <Text style={[textStyles.caption, { color: theme.danger }]}>{detail.rejectionReason}</Text>
            ) : null}

            {/* 승인된 신청도 반려로 되돌릴 수 있어야 한다(잘못 승인했을 때) —
                반려는 권한까지 함께 내리므로 실질적인 정지 수단이다. */}
            <View style={styles.actions}>
              {detail.approvalStatus !== "approved" ? (
                <Button
                  title={t("adminAgencies.approve")}
                  size="small"
                  onPress={() => handleApprove(detail)}
                  loading={busyId === detail.id}
                  style={styles.actionButton}
                />
              ) : null}
              {detail.approvalStatus !== "rejected" ? (
                <Button
                  title={t("adminAgencies.reject")}
                  size="small"
                  variant="secondary"
                  onPress={() => {
                    setRejectTarget(detail);
                    setRejectReason("");
                  }}
                  style={styles.actionButton}
                />
              ) : null}
            </View>
          </>
        ) : null}
      </Modal>

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
