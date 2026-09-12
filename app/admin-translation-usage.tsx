import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { createScaledStyles, colors, radius, spacing, textStyles, typography, FONT_FACTOR, scaleFont } from "@/constants/theme";
import {
  fetchTranslationUsage,
  fetchTranslationUsageMonthly,
  type TranslationUsage,
  type TranslationUsageMonth,
  type TranslationUsagePeriod,
} from "@/services/chat";
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

  const [checkingPermission, setCheckingPermission] = useState(true);
  const [allowed, setAllowed] = useState(false);
  // [2026-09-11 사용자 지시 — 4차] 오늘/이번주/이번달/전체.
  const [period, setPeriod] = useState<TranslationUsagePeriod>("month");
  const [monthly, setMonthly] = useState<TranslationUsageMonth[]>([]);
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
    // "전체"에서만 1년 추이를 함께 불러온다 — 다른 기간에는 그래프를 그리지 않는다.
    if (period === "all") {
      fetchTranslationUsageMonthly().then(setMonthly);
    }
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
        <Header title={t("translationUsage.title")} leftAction={<BackButton fallback="/my" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("translationUsage.title")} leftAction={<BackButton fallback="/my" />} />
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
      <Header title={t("translationUsage.title")} leftAction={<BackButton fallback="/my" />} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.chipRow}>
          {(["today", "week", "month", "all"] as TranslationUsagePeriod[]).map((item) => (
            <Chip
              key={item}
              label={t(`translationUsage.period.${item}`)}
              active={period === item}
              onPress={() => setPeriod(item)}
              theme={theme}
              tone="accent"
            />
          ))}
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

            {/* [2026-09-11 사용자 지시 — 4차] 전체 탭에서는 최근 1년을 막대로 본다.
                차트 라이브러리를 새로 들이지 않고, 가장 큰 달을 100%로 잡아 높이만
                비율로 그린다 — 값 자체는 막대 위 숫자로 읽는다. */}
            {period === "all" && monthly.length > 0 ? (
              <View style={styles.chartCard}>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                  {t("translationUsage.chartTitle")}
                </Text>
                <View style={styles.chartRow}>
                  {monthly.map((point) => {
                    const max = Math.max(...monthly.map((item) => item.billable_chars), 1);
                    const ratio = point.billable_chars / max;
                    return (
                      <View key={point.month} style={styles.chartCol}>
                        <View style={styles.chartBarArea}>
                          <View
                            style={[
                              styles.chartBar,
                              {
                                backgroundColor: point.billable_chars > 0 ? theme.accent : theme.border,
                                // 값이 0이어도 바닥선이 보이도록 최소 높이를 둔다.
                                height: Math.max(2, Math.round(ratio * 80)),
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.chartLabel, { color: theme.secondaryText }]} numberOfLines={1}>
                          {point.month.slice(5, 7)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                  {t("translationUsage.chartHelper", {
                    max: Math.max(...monthly.map((item) => item.billable_chars), 0).toLocaleString("en-US"),
                  })}
                </Text>
              </View>
            ) : null}

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

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  chartCard: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  chartCol: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  chartBarArea: {
    height: 80,
    justifyContent: "flex-end",
    width: "100%",
    alignItems: "center",
  },
  chartBar: {
    width: "70%",
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  chartLabel: {
    fontSize: scaleFont(10),
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
    fontSize: scaleFont(44, FONT_FACTOR.TITLE),
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
}));
