import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { fetchTranslationUsage, type TranslationUsage } from "@/services/chat";
import { isAdmin } from "@/services/roles";

/**
 * [STEP T-2] 번역 사용량/비용 모니터링 화면 (admin 전용, 지시서 §16·§17).
 *
 * 단가는 코드에 고정하지 않는다 — Google Cloud Translation 요금은 변경될 수 있어
 * 아래 상수로 분리해 두고, 실제 청구서와 어긋나면 이 값만 고친다.
 */

/** Google Cloud Translation v2 기준(2026-09 확인 시점): 월 50만 문자 무료, 이후 100만 문자당 $20. */
const FREE_CHARS_PER_MONTH = 500_000;
const USD_PER_MILLION_CHARS = 20;

export default function AdminTranslationUsageScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [checkingPermission, setCheckingPermission] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [period, setPeriod] = useState<"today" | "month">("month");
  const [usage, setUsage] = useState<TranslationUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    isAdmin().then((ok) => {
      if (mounted) {
        setAllowed(ok);
        setCheckingPermission(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!allowed) return;
    setLoading(true);
    fetchTranslationUsage(period).then((result) => {
      if (mounted) {
        setUsage(result);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [allowed, period]);

  if (checkingPermission) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("translationUsage.title")} leftAction={<BackButton onPress={() => router.back()} />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("translationUsage.title")} leftAction={<BackButton onPress={() => router.back()} />} />
        <EmptyState
          title={t("translationUsage.noPermissionTitle")}
          description={t("translationUsage.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  // 과금 대상 = 실제 API 호출 문자 수에서 월 무료분을 뺀 값(오늘 기준일 때는 무료분을
  // 적용하지 않는다 — 무료 한도는 월 단위이기 때문).
  const billable = usage?.billable_chars ?? 0;
  const chargeable = period === "month" ? Math.max(0, billable - FREE_CHARS_PER_MONTH) : billable;
  const estimatedCost = (chargeable / 1_000_000) * USD_PER_MILLION_CHARS;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("translationUsage.title")} leftAction={<BackButton onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.chipRow}>
          <Chip
            label={t("translationUsage.periodToday")}
            active={period === "today"}
            onPress={() => setPeriod("today")}
            theme={theme}
            tone="accent"
          />
          <Chip
            label={t("translationUsage.periodMonth")}
            active={period === "month"}
            onPress={() => setPeriod("month")}
            theme={theme}
            tone="accent"
          />
        </View>

        {loading ? (
          <Loading />
        ) : !usage ? (
          <EmptyState
            title={t("translationUsage.loadFailedTitle")}
            description={t("translationUsage.loadFailedDescription")}
          />
        ) : (
          <>
            {/* 이 화면의 핵심 지표 — 캐시가 실제로 비용을 얼마나 막고 있는지. */}
            <View style={[styles.heroCard, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("translationUsage.cacheHitRate")}
              </Text>
              <Text style={[styles.heroValue, { color: theme.accent }]}>
                {usage.cache_hit_rate}
                <Text style={styles.heroUnit}>%</Text>
              </Text>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("translationUsage.cacheHitRateHelper", {
                  saved: usage.cache_hits,
                  total: usage.cache_hits + usage.api_calls,
                })}
              </Text>
            </View>

            <View style={styles.statGrid}>
              <StatBox label={t("translationUsage.apiCalls")} value={String(usage.api_calls)} theme={theme} />
              <StatBox label={t("translationUsage.cacheHits")} value={String(usage.cache_hits)} theme={theme} />
              <StatBox label={t("translationUsage.skipped")} value={String(usage.skipped)} theme={theme} />
              <StatBox label={t("translationUsage.failures")} value={String(usage.failures)} theme={theme} />
            </View>

            <View style={[styles.costCard, { borderColor: theme.border }]}>
              <CostRow
                label={t("translationUsage.billableChars")}
                value={billable.toLocaleString("en-US")}
                theme={theme}
              />
              {period === "month" ? (
                <CostRow
                  label={t("translationUsage.freeChars")}
                  value={FREE_CHARS_PER_MONTH.toLocaleString("en-US")}
                  theme={theme}
                />
              ) : null}
              <CostRow
                label={t("translationUsage.chargeableChars")}
                value={chargeable.toLocaleString("en-US")}
                theme={theme}
              />
              <CostRow
                label={t("translationUsage.estimatedCost")}
                value={`$${estimatedCost.toFixed(2)}`}
                theme={theme}
                emphasis
              />
            </View>

            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("translationUsage.priceNotice", { price: USD_PER_MILLION_CHARS })}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, theme }: { label: string; value: string; theme: typeof colors.light }) {
  return (
    <View style={[styles.statBox, { borderColor: theme.border }]}>
      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{label}</Text>
      <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function CostRow({
  label,
  value,
  theme,
  emphasis,
}: {
  label: string;
  value: string;
  theme: typeof colors.light;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.costRow}>
      <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>{label}</Text>
      <Text
        style={[
          textStyles.body,
          { color: emphasis ? theme.accent : theme.text, fontWeight: emphasis ? typography.weight.bold : typography.weight.regular },
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
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  heroCard: {
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  heroValue: {
    fontSize: 44,
    fontWeight: typography.weight.bold,
  },
  heroUnit: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.regular,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statBox: {
    flexGrow: 1,
    flexBasis: "45%",
    gap: 2,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  costCard: {
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  costRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
});
