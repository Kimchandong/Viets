import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { formatMoneyAmount } from "@/utils/format";
import { getMyAgency, type MyAgency } from "@/services/agencies";
import {
  getPaymentSettings,
  listBalanceEntries,
  listPaymentRequests,
  submitPaymentRequest,
  type BalanceEntry,
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

  const [agency, setAgency] = useState<MyAgency | null>(null);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [pending, setPending] = useState<PaymentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState("");
  // [2026-09-11 사용자 지시 — 3차] 입금액은 신청자가 직접 적는다(충전식) — 관리자가
  // 정해 둔 금액은 "등록비"이지 입금액이 아니다.
  const [amountText, setAmountText] = useState("");
  // [2026-09-11 사용자 지시 — 5차] 광고비 정산은 접어 둔다 — 이 화면에 들어오는
  // 이유는 대개 "얼마가 어디에 쓰였나"를 보기 위해서다.
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [entries, setEntries] = useState<BalanceEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextAgency, nextSettings] = await Promise.all([getMyAgency(), getPaymentSettings()]);
    setAgency(nextAgency);
    setSettings(nextSettings);

    if (nextAgency && nextAgency.approvalStatus === "approved") {
      const [requests, nextEntries] = await Promise.all([
        listPaymentRequests(),
        listBalanceEntries(nextAgency.id),
      ]);
      setPending(requests.find((request) => request.status === "pending") ?? null);
      setEntries(nextEntries);
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
  const amount = Number(amountText.replace(/[^\d]/g, "")) || 0;

  /** [2026-09-12 사용자 지시] 최소 충전액. 상한은 없다. */
  const minDeposit = settings?.minDeposit ?? 0;

  async function handleSubmit() {
    if (submitting) return;
    if (amount <= 0) {
      showToast(t("payment.amountRequired"));
      return;
    }
    // 서버도 같은 조건을 확인하지만, 보내기 전에 알려 주는 편이 낫다.
    if (minDeposit > 0 && amount < minDeposit) {
      showToast(t("payment.belowMinDeposit", { amount: formatMoneyAmount(minDeposit, currency) }));
      return;
    }
    setSubmitting(true);
    const result = await submitPaymentRequest(amount, note);
    setSubmitting(false);

    if (!result.ok) {
      showToast(
        result.reason === "already-pending"
          ? t("payment.alreadyPending")
          : result.reason === "not-approved-agency"
            ? t("payment.notApproved")
            : result.reason === "below-min-deposit"
              ? t("payment.belowMinDeposit", {
                  amount: formatMoneyAmount(minDeposit, currency),
                })
              : t("payment.submitFailed"),
      );
      return;
    }
    setNote("");
    setAmountText("");
    showToast(t("payment.submitted"));
    await load();
  }

  const screenTitle = t("payment.title");

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!agency || agency.approvalStatus !== "approved") {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />
        <EmptyState title={t("payment.notApprovedTitle")} description={t("payment.notApproved")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/my" />} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 광고비 정산 — 아코디언. 펼치면 입금자명(업체명)·입금액·QR·계좌가 나온다. */}
        <Pressable
          onPress={() => setSettlementOpen((prev) => !prev)}
          accessibilityRole="button"
          accessibilityState={{ expanded: settlementOpen }}
          style={({ pressed }) => [
            styles.accordionHead,
            { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
          ]}
        >
          <Text style={[textStyles.cardTitle, { color: theme.accent }]}>
            {t("payment.settlementTitle")}
          </Text>
          <Ionicons
            name={settlementOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={theme.secondaryText}
          />
        </Pressable>

        {settlementOpen ? (
          <View style={styles.accordionBody}>
            {/* 입금자명은 신청 때 적은 업체명을 그대로 쓴다 — 은행 내역과 이름이
                같아야 관리자가 어느 업체의 입금인지 짝지을 수 있다. */}
            <View>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("payment.depositorLabel")}
              </Text>
              <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{agency.name}</Text>
            </View>

            {pending ? (
              <View style={[styles.pendingBox, { borderColor: theme.warning }]}>
                <Ionicons name="time-outline" size={18} color={theme.warning} />
                <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]}>
                  {t("payment.pendingNotice", {
                    amount: formatMoneyAmount(pending.amount, currency),
                  })}
                </Text>
              </View>
            ) : (
              <>
                <Input
                  label={t("payment.amountInputLabel")}
                  placeholder={t("payment.amountInputPlaceholder")}
                  value={amountText}
                  onChangeText={setAmountText}
                  keyboardType="numeric"
                  helperText={
                    minDeposit > 0
                      ? t("payment.minDepositHint", {
                          amount: formatMoneyAmount(minDeposit, currency),
                        })
                      : undefined
                  }
                />
                <Input
                  label={t("payment.noteLabel")}
                  placeholder={t("payment.notePlaceholder")}
                  value={note}
                  onChangeText={setNote}
                />
                <Button title={t("payment.declare")} onPress={handleSubmit} loading={submitting} />
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                  {t("payment.declareHint")}
                </Text>
                {/* [2026-09-12 사용자 지시] 중복 클릭 과금 규칙을 광고비를 내는
                    사람이 보는 자리에 주황색으로 명시한다 — 클릭 수와 청구액이
                    다를 때 "왜 덜 빠졌나"를 묻기 전에 읽히도록. */}
                <Text style={[textStyles.caption, { color: theme.warning }]}>
                  {t("payment.duplicateClickNotice")}
                </Text>
              </>
            )}

            {settings?.qrImageUrl ? (
              <View style={styles.qrBox}>
                <Image source={{ uri: settings.qrImageUrl }} style={styles.qrImage} resizeMode="contain" />
              </View>
            ) : (
              <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
                {t("payment.qrNotSet")}
              </Text>
            )}

            {/* QR 아래 — 은행명·예금주 한 줄, 계좌번호 한 줄(사용자 지시). */}
            {settings && (settings.bankName.length > 0 || settings.accountNumber.length > 0) ? (
              <View style={styles.bankBox}>
                <Text style={[textStyles.bodySmall, { color: theme.text }]}>
                  {[settings.bankName, settings.accountHolder].filter(Boolean).join(" / ")}
                </Text>
                <Text style={[textStyles.body, { color: theme.text, fontWeight: typography.weight.medium }]}>
                  {settings.accountNumber}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* 광고내역 — 매물명(좌) / 차감액(우). 입금(+)은 정산 쪽 이야기라 여기서는
            사용 내역만 보여 준다. */}
        <SectionHeader title={t("payment.historyTitle")} />
        {entries.filter((entry) => entry.amount < 0).length === 0 ? (
          // [2026-09-11 사용자 지시] 내용이 없을 때의 문구는 앱 전체에서 11px·굵기
          // 없음으로 통일한다(components/EmptyState.tsx와 같은 규칙). 여기만
          // bodySmall(13px)이라 다른 화면의 빈 상태보다 커 보였다.
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText, fontSize: typography.size.xs }]}>
            {t("payment.historyEmpty")}
          </Text>
        ) : (
          entries
            .filter((entry) => entry.amount < 0)
            .map((entry) => (
              <View key={entry.id} style={[styles.historyRow, { borderBottomColor: theme.border }]}>
                <View style={styles.historyTexts}>
                  <Text style={[textStyles.body, { color: theme.text }]} numberOfLines={1}>
                    {entry.propertyTitle || t(`payment.entryKind.${entry.kind}`)}
                  </Text>
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                    {entry.createdAt.slice(0, 10)} · {t(`payment.entryKind.${entry.kind}`)}
                  </Text>
                </View>
                <Text
                  style={[textStyles.body, { color: theme.danger, fontWeight: typography.weight.medium }]}
                >
                  -{formatMoneyAmount(Math.abs(entry.amount), currency)}
                </Text>
              </View>
            ))
        )}
      </ScrollView>

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
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  qrBox: {
    alignItems: "center",
  },
  qrImage: {
    width: 220,
    height: 220,
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
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  bankBox: {
    gap: 2,
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
});
