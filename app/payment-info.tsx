import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { formatMoneyAmount } from "@/utils/format";
import { getMyAgency, type MyAgency } from "@/services/agencies";
import {
  getAgencyBalance,
  getPaymentSettings,
  listPaymentRequests,
  submitPaymentRequest,
  type AgencyBalance,
  type PaymentRequest,
  type PaymentSettings,
} from "@/services/payments";

/**
 * [2026-09-11 사용자 지시] 결제 정보 — MY의 결제 버튼에서 들어온다.
 *
 * 보여 주는 것: 업체명(자동), 입금할 금액, 관리자가 미리 등록해 둔 QR.
 * 입금액은 관리자가 정한 고정액이고 **중개번호 유무에 따라 두 가지** 중 하나가 된다 —
 * 신청 때 적은 중개번호가 있으면 with, 없으면 without.
 *
 * 입금 자체는 은행에서 일어나므로 앱이 할 수 있는 것은 "입금했습니다" 신고를 받는
 * 것까지다. 잔액은 관리자가 실제 입금을 확인해 승인할 때 생긴다 — 신고만으로 잔액이
 * 늘면 아무나 돈을 만들 수 있다.
 */

export default function PaymentInfoScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [agency, setAgency] = useState<MyAgency | null>(null);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [balance, setBalance] = useState<AgencyBalance | null>(null);
  const [pending, setPending] = useState<PaymentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextAgency, nextSettings] = await Promise.all([getMyAgency(), getPaymentSettings()]);
    setAgency(nextAgency);
    setSettings(nextSettings);

    if (nextAgency && nextAgency.approvalStatus === "approved") {
      const [nextBalance, requests] = await Promise.all([
        getAgencyBalance(nextAgency.id),
        listPaymentRequests(),
      ]);
      setBalance(nextBalance);
      setPending(requests.find((request) => request.status === "pending") ?? null);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load().catch(() => {
        if (active) setLoading(false);
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

  const currency = settings?.currency ?? "VND";
  // 중개번호를 적어 낸 업체인지로 금액이 갈린다(사용자 결정).
  const hasLicense = (agency?.registrationNo.length ?? 0) > 0;
  const depositAmount = settings
    ? hasLicense
      ? settings.depositWithLicense
      : settings.depositWithoutLicense
    : 0;

  async function handleSubmit() {
    if (submitting || depositAmount <= 0) return;
    setSubmitting(true);
    const result = await submitPaymentRequest(depositAmount, note);
    setSubmitting(false);

    if (!result.ok) {
      showToast(
        result.reason === "already-pending"
          ? t("payment.alreadyPending")
          : result.reason === "not-approved-agency"
            ? t("payment.notApproved")
            : t("payment.submitFailed"),
      );
      return;
    }
    setNote("");
    showToast(t("payment.submitted"));
    await load();
  }

  const screenTitle = t("payment.title");

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!agency || agency.approvalStatus !== "approved") {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />
        <EmptyState title={t("payment.notApprovedTitle")} description={t("payment.notApproved")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 업체명은 신청 때 적은 값을 그대로 쓴다 — 입금자명을 업체명으로 맞춰 달라고
            안내해야 관리자가 은행 내역과 짝지을 수 있다. */}
        <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("payment.agencyLabel")}
          </Text>
          <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{agency.name}</Text>

          <View style={styles.divider} />

          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("payment.amountLabel")}
          </Text>
          <Text style={[styles.amount, { color: theme.warning }]}>
            {depositAmount > 0 ? formatMoneyAmount(depositAmount, currency) : t("payment.amountNotSet")}
          </Text>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {hasLicense ? t("payment.withLicense") : t("payment.withoutLicense")}
          </Text>
        </View>

        <SectionHeader title={t("payment.qrTitle")} />
        {settings?.qrImageUrl ? (
          <View style={styles.qrBox}>
            <Image source={{ uri: settings.qrImageUrl }} style={styles.qrImage} resizeMode="contain" />
          </View>
        ) : (
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
            {t("payment.qrNotSet")}
          </Text>
        )}

        {settings && settings.bankInfo.length > 0 ? (
          <Text style={[textStyles.bodySmall, { color: theme.text }]}>{settings.bankInfo}</Text>
        ) : null}

        <SectionHeader title={t("payment.balanceTitle")} />
        <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <Row
            label={t("payment.available")}
            value={formatMoneyAmount(balance?.available ?? 0, currency)}
            emphasis
          />
          <Row label={t("payment.totalDeposited")} value={formatMoneyAmount(balance?.totalDeposited ?? 0, currency)} />
          <Row label={t("payment.totalSpent")} value={formatMoneyAmount(balance?.totalSpent ?? 0, currency)} />
        </View>

        {/* 심사 중인 신고가 있으면 또 내지 못한다 — 관리자가 어느 입금인지 가릴 수 없다. */}
        {pending ? (
          <View style={[styles.pendingBox, { borderColor: theme.warning }]}>
            <Ionicons name="time-outline" size={18} color={theme.warning} />
            <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]}>
              {t("payment.pendingNotice", { amount: formatMoneyAmount(pending.amount, currency) })}
            </Text>
          </View>
        ) : (
          <>
            <SectionHeader title={t("payment.declareTitle")} />
            <Input
              label={t("payment.noteLabel")}
              placeholder={t("payment.notePlaceholder")}
              value={note}
              onChangeText={setNote}
            />
            <Button
              title={t("payment.declare")}
              onPress={handleSubmit}
              loading={submitting}
              disabled={depositAmount <= 0}
              style={styles.submit}
            />
            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("payment.declareHint")}
            </Text>
          </>
        )}
      </ScrollView>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  const theme = colors.light;
  return (
    <View style={styles.row}>
      <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>{label}</Text>
      <Text
        style={[
          textStyles.body,
          {
            color: emphasis ? theme.warning : theme.text,
            fontWeight: emphasis ? typography.weight.medium : typography.weight.regular,
          },
        ]}
      >
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
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E5E5",
    marginVertical: spacing.sm,
  },
  amount: {
    fontSize: 24,
    fontWeight: typography.weight.bold,
  },
  qrBox: {
    alignItems: "center",
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  pendingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  submit: {
    marginTop: spacing.xs,
  },
});
