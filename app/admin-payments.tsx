import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
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

const STATUS_ORDER: PaymentRequestStatus[] = ["pending", "approved", "rejected"];

export default function AdminPaymentsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<PaymentRequestStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  // 설정 입력값은 문자열로 들고 있다가 저장할 때 숫자로 바꾼다 — 입력 도중의 빈 칸이나
  // 중간 상태를 숫자로 강제하면 커서가 튄다.
  const [withLicense, setWithLicense] = useState("");
  const [withoutLicense, setWithoutLicense] = useState("");
  const [registerFee, setRegisterFee] = useState("");
  const [featuredFee, setFeaturedFee] = useState("");
  const [bankInfo, setBankInfo] = useState("");
  const [qrPreview, setQrPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextSettings, nextRequests] = await Promise.all([
      getPaymentSettings(),
      listPaymentRequests(),
    ]);
    setSettings(nextSettings);
    setRequests(nextRequests);
    if (nextSettings) {
      setWithLicense(String(nextSettings.depositWithLicense));
      setWithoutLicense(String(nextSettings.depositWithoutLicense));
      setRegisterFee(String(nextSettings.propertyRegisterFee));
      setFeaturedFee(String(nextSettings.featuredDailyFee));
      setBankInfo(nextSettings.bankInfo);
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
      depositWithLicense: toNumber(withLicense),
      depositWithoutLicense: toNumber(withoutLicense),
      propertyRegisterFee: toNumber(registerFee),
      featuredDailyFee: toNumber(featuredFee),
      bankInfo,
      qrImagePath,
    });

    setSavingSettings(false);
    showToast(ok ? t("adminPayments.saved") : t("adminPayments.saveFailed"));
    if (ok) {
      setQrPreview(null);
      await load();
    }
  }

  async function handleApprove(request: PaymentRequest) {
    setBusyId(request.id);
    const ok = await reviewPayment(request.id, true);
    setBusyId(null);
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
  const visible = requests.filter((request) => request.status === statusFilter);

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
          title={t("adminPayments.noPermissionTitle")}
          description={t("adminPayments.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <SectionHeader title={t("adminPayments.settingsTitle")} />

        <Input
          label={t("adminPayments.depositWithLicense")}
          value={withLicense}
          onChangeText={setWithLicense}
          keyboardType="numeric"
        />
        <Input
          label={t("adminPayments.depositWithoutLicense")}
          value={withoutLicense}
          onChangeText={setWithoutLicense}
          keyboardType="numeric"
        />
        <Input
          label={t("adminPayments.registerFee")}
          value={registerFee}
          onChangeText={setRegisterFee}
          keyboardType="numeric"
          helperText={t("adminPayments.registerFeeHint")}
        />
        <Input
          label={t("adminPayments.featuredFee")}
          value={featuredFee}
          onChangeText={setFeaturedFee}
          keyboardType="numeric"
          helperText={t("adminPayments.featuredFeeHint")}
        />
        <Input
          label={t("adminPayments.bankInfo")}
          value={bankInfo}
          onChangeText={setBankInfo}
          placeholder={t("adminPayments.bankInfoPlaceholder")}
          multiline
        />

        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
          {t("adminPayments.qrHint")}
        </Text>

        <Pressable
          onPress={handlePickQr}
          accessibilityRole="button"
          style={({ pressed }) => [styles.qrBox, { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 }]}
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

        <SectionHeader title={t("adminPayments.requestsTitle")} />

        <View style={[styles.tabRow, { borderBottomColor: theme.border }]}>
          {STATUS_ORDER.map((status) => {
            const active = status === statusFilter;
            const count = requests.filter((request) => request.status === status).length;
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
                  {`${t(`adminPayments.status.${status}`)} ${count}`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {visible.length === 0 ? (
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
            {t("adminPayments.emptyRequests")}
          </Text>
        ) : (
          visible.map((request) => (
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

              {request.status === "pending" ? (
                <View style={styles.actions}>
                  <Button
                    title={t("adminPayments.approve")}
                    size="small"
                    onPress={() => handleApprove(request)}
                    loading={busyId === request.id}
                    style={styles.actionButton}
                  />
                  <Button
                    title={t("adminPayments.reject")}
                    size="small"
                    variant="secondary"
                    onPress={() => {
                      setRejectTarget(request);
                      setRejectReason("");
                    }}
                    style={styles.actionButton}
                  />
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>

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
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
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
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  actionButton: {
    flex: 1,
  },
});
