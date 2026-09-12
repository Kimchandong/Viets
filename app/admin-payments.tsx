import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { formatMoneyAmount } from "@/utils/format";
import {
  getPaymentSettings,
  listPaymentRequests,
  reviewPayment,
  updatePaymentSettings,
  uploadQrImage,
  type PaymentRequest,
  type PaymentRequestStatus,
  type PaymentSettings,
} from "@/services/payments";
import { isAdmin } from "@/services/roles";

/**
 * [2026-09-11 사용자 지시] 입금 관리 — 관리자 전용.
 *
 * 두 가지를 한 화면에서 한다:
 *   · 요금/QR 설정 — 중개업소가 볼 입금액(중개번호 유무별 2종)과 QR, 사용 요금
 *   · 입금 신고 심사 — 실제 입금을 확인하고 승인하면 그 순간 잔액이 생긴다
 *
 * 승인은 되돌릴 수 없다(이미 처리한 신고는 서버가 다시 받지 않는다) — 두 번 눌러
 * 잔액이 두 배가 되는 사고를 막기 위한 설계다.
 */

/** 처리상태 버튼 — 신청(접수) / 확인(입금 확인) / 반려(확인 불가). */
const STATUS_ORDER: PaymentRequestStatus[] = ["pending", "approved", "rejected"];

export default function AdminPaymentsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  // [2026-09-11 사용자 지시 — 3차] 광고비 설정은 평소에 접어 둔다 — 관리자가 이 화면에
  // 들어오는 이유는 대개 정산내역을 보기 위해서고, 설정은 가끔 손댄다.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  /** 승인 확인 모달 — 관리자가 실제 입금액을 적어 넣는다. */
  const [approveTarget, setApproveTarget] = useState<PaymentRequest | null>(null);
  const [approveAmount, setApproveAmount] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // 설정 입력값은 문자열로 들고 있다가 저장할 때 숫자로 바꾼다 — 입력 도중의 빈 칸이나
  // 중간 상태를 숫자로 강제하면 커서가 튄다.
  const [feeAgency, setFeeAgency] = useState("");
  const [feeGeneral, setFeeGeneral] = useState("");
  // [2026-09-12 사용자 지시] 추천/TOP10은 기간제가 아니라 금액 순위다 — 관리자는
  // "그 자리에 들어가려면 최소 얼마"만 정한다.
  const [featuredMinBid, setFeaturedMinBid] = useState("");
  const [top10MinBid, setTop10MinBid] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [qrPreview, setQrPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextSettings, nextRequests] = await Promise.all([
      getPaymentSettings(),
      listPaymentRequests(),
    ]);
    setSettings(nextSettings);
    setRequests(nextRequests);
    if (nextSettings) {
      setFeeAgency(String(nextSettings.registerFeeAgency));
      setFeeGeneral(String(nextSettings.registerFeeGeneral));
      setFeaturedMinBid(String(nextSettings.featuredMinBid));
      setTop10MinBid(String(nextSettings.top10MinBid));
      setBankName(nextSettings.bankName);
      setAccountHolder(nextSettings.accountHolder);
      setAccountNumber(nextSettings.accountNumber);
    }
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

  function toNumber(value: string): number {
    const parsed = Number(value.replace(/[^\d.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function handlePickQr() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("adminPayments.permissionDenied"));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled) return;
    setQrPreview(result.assets[0].uri);
  }

  async function handleSaveSettings() {
    setSavingSettings(true);

    let qrImagePath: string | undefined;
    if (qrPreview) {
      const uploaded = await uploadQrImage(qrPreview);
      if (!uploaded) {
        setSavingSettings(false);
        showToast(t("adminPayments.qrUploadFailed"));
        return;
      }
      qrImagePath = uploaded;
    }

    const ok = await updatePaymentSettings({
      registerFeeAgency: toNumber(feeAgency),
      registerFeeGeneral: toNumber(feeGeneral),
      featuredMinBid: toNumber(featuredMinBid),
      top10MinBid: toNumber(top10MinBid),
      bankName,
      accountHolder,
      accountNumber,
      qrImagePath,
    });

    setSavingSettings(false);
    showToast(ok ? t("adminPayments.saved") : t("adminPayments.saveFailed"));
    if (ok) {
      setQrPreview(null);
      await load();
    }
  }

  /**
   * [2026-09-12 사용자 지시] 승인은 곧바로 처리하지 않고 **실제 입금된 금액**을
   * 확인받는다 — 신고 금액과 송금액이 어긋나는 경우가 있어, 그대로 승인하면
   * 잔액이 실제보다 많거나 적어진다. 기본값은 신고 금액이다.
   */
  function openApprove(request: PaymentRequest) {
    setApproveTarget(request);
    setApproveAmount(String(Math.round(request.amount)));
  }

  async function handleApprove() {
    if (!approveTarget) return;

    const amount = Number(approveAmount.replace(/[^\d]/g, "")) || 0;
    if (amount <= 0) {
      showToast(t("adminPayments.approveAmountRequired"));
      return;
    }

    setBusyId(approveTarget.id);
    const ok = await reviewPayment(approveTarget.id, true, undefined, amount);
    setBusyId(null);
    setApproveTarget(null);
    showToast(ok ? t("adminPayments.approved") : t("adminPayments.actionFailed"));
    if (ok) await load();
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setBusyId(rejectTarget.id);
    const ok = await reviewPayment(rejectTarget.id, false, rejectReason);
    setBusyId(null);
    setRejectTarget(null);
    setRejectReason("");
    showToast(ok ? t("adminPayments.rejected") : t("adminPayments.actionFailed"));
    if (ok) await load();
  }

  const screenTitle = t("adminPayments.title");
  const currency = settings?.currency ?? "VND";

  if (allowed === null || loading) {
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
        <EmptyState
          title={t("adminPayments.noPermissionTitle")}
          description={t("adminPayments.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* [2026-09-11 사용자 지시 — 3차] 광고비 설정 — 눌러서 펼치는 아코디언. */}
        <Pressable
          onPress={() => setSettingsOpen((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded: settingsOpen }}
          style={({ pressed }) => [
            styles.accordionHead,
            { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
          ]}
        >
          <Text style={[textStyles.cardTitle, { color: theme.accent }]}>
            {t("adminPayments.settingsTitle")}
          </Text>
          <Ionicons
            name={settingsOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={theme.secondaryText}
          />
        </Pressable>

        {settingsOpen ? (
          <View style={styles.accordionBody}>
            <Input
              label={t("adminPayments.registerFeeAgency")}
              value={feeAgency}
              onChangeText={setFeeAgency}
              keyboardType="numeric"
              helperText={t("adminPayments.registerFeeHint")}
            />
            <Input
              label={t("adminPayments.registerFeeGeneral")}
              value={feeGeneral}
              onChangeText={setFeeGeneral}
              keyboardType="numeric"
            />
            <Input
              label={t("adminPayments.featuredMinBid")}
              value={featuredMinBid}
              onChangeText={setFeaturedMinBid}
              keyboardType="numeric"
              helperText={t("adminPayments.featuredMinBidHint")}
            />
            <Input
              label={t("adminPayments.top10MinBid")}
              value={top10MinBid}
              onChangeText={setTop10MinBid}
              keyboardType="numeric"
              helperText={t("adminPayments.top10MinBidHint")}
            />

            {/* 계좌는 은행명·예금주를 한 줄에, 계좌번호를 그 아래 한 줄에 둔다. */}
            <View style={styles.bankRow}>
              <Input
                label={t("adminPayments.bankName")}
                value={bankName}
                onChangeText={setBankName}
                containerStyle={styles.bankField}
              />
              <Input
                label={t("adminPayments.accountHolder")}
                value={accountHolder}
                onChangeText={setAccountHolder}
                containerStyle={styles.bankField}
              />
            </View>
            <Input
              label={t("adminPayments.accountNumber")}
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="numeric"
            />

            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("adminPayments.qrHint")}
            </Text>

            <Pressable
              onPress={handlePickQr}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.qrBox,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              {qrPreview || settings?.qrImageUrl ? (
                <Image
                  source={{ uri: qrPreview ?? settings?.qrImageUrl ?? "" }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
              ) : (
                <>
                  <Ionicons name="qr-code-outline" size={28} color={theme.secondaryText} />
                  <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
                    {t("adminPayments.pickQr")}
                  </Text>
                </>
              )}
            </Pressable>

            <Button
              title={t("adminPayments.save")}
              onPress={handleSaveSettings}
              loading={savingSettings}
              style={styles.save}
            />
          </View>
        ) : null}

        <SectionHeader title={t("adminPayments.requestsTitle")} />

        {requests.length === 0 ? (
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
            {t("adminPayments.emptyRequests")}
          </Text>
        ) : (
          requests.map((request) => (
            <View
              key={request.id}
              style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}
            >
              <View style={styles.cardHead}>
                <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                  {request.agencyName}
                </Text>
                <Text style={[textStyles.body, { color: theme.warning, fontWeight: typography.weight.medium }]}>
                  {formatMoneyAmount(request.amount, currency)}
                </Text>
              </View>

              {request.note.length > 0 ? (
                <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
                  {t("adminPayments.noteLabel")}: {request.note}
                </Text>
              ) : null}
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {request.createdAt.slice(0, 16).replace("T", " ")}
              </Text>
              {request.rejectReason.length > 0 ? (
                <Text style={[textStyles.caption, { color: theme.danger }]}>{request.rejectReason}</Text>
              ) : null}

              {/* 처리상태 — 지금 상태가 채워진 버튼으로 보이고, 누르면 그 상태로 바꾼다.
                  확인을 누르는 순간 서버가 신청자 업체 잔액에 그 금액을 더한다(원장에
                  + 한 줄이 들어가므로 기존 금액과 자연히 합산된다). 이미 처리한 건은
                  서버가 다시 받지 않으므로 신청 상태일 때만 누를 수 있게 둔다. */}
              <View style={styles.statusRow}>
                {STATUS_ORDER.map((status) => {
                  const active = request.status === status;
                  const disabled = request.status !== "pending" || status === "pending";
                  return (
                    <Pressable
                      key={status}
                      disabled={disabled}
                      onPress={() => {
                        if (status === "approved") {
                          openApprove(request);
                        } else if (status === "rejected") {
                          setRejectTarget(request);
                          setRejectReason("");
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, disabled }}
                      style={({ pressed }) => [
                        styles.statusPill,
                        {
                          borderColor: active ? statusColor(status, theme) : theme.border,
                          backgroundColor: active ? statusColor(status, theme) : "transparent",
                          opacity: pressed ? opacity.pressed : disabled && !active ? 0.4 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          textStyles.caption,
                          {
                            color: active ? theme.onAccent : theme.secondaryText,
                            fontWeight: typography.weight.medium,
                          },
                        ]}
                      >
                        {t(`adminPayments.status.${status}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* [2026-09-12 사용자 지시] 승인 = 실제 입금액 입력. */}
      <Modal
        visible={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.xs }]}>
          {t("adminPayments.approveTitle")}
        </Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText, marginBottom: spacing.sm }]}>
          {t("adminPayments.approveHint", {
            agency: approveTarget?.agencyName ?? "",
            amount: formatMoneyAmount(approveTarget?.amount ?? 0, currency),
          })}
        </Text>
        <Input
          label={t("adminPayments.approveAmountLabel")}
          value={approveAmount}
          onChangeText={setApproveAmount}
          keyboardType="numeric"
        />
        <Button
          title={t("adminPayments.approve")}
          onPress={handleApprove}
          loading={busyId === approveTarget?.id}
          style={styles.save}
        />
      </Modal>

      <Modal
        visible={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("adminPayments.rejectTitle")}
        </Text>
        <Input
          placeholder={t("adminPayments.rejectReasonPlaceholder")}
          value={rejectReason}
          onChangeText={setRejectReason}
          multiline
        />
        <Button title={t("adminPayments.reject")} onPress={handleReject} style={styles.save} />
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

/** 처리상태 색 — 신청은 주황(처리해야 할 것), 확인은 파랑, 반려는 빨강. */
function statusColor(status: PaymentRequestStatus, theme: typeof colors.light): string {
  if (status === "approved") return theme.accent;
  if (status === "rejected") return theme.danger;
  return theme.warning;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  qrBox: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.sm,
    paddingVertical: spacing.lg,
  },
  qrImage: {
    width: 180,
    height: 180,
  },
  save: {
    marginTop: spacing.xs,
  },
  accordionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  accordionBody: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bankRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  bankField: {
    flex: 1,
  },
  statusRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
});
