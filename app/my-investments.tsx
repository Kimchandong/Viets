import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { InvestmentCard } from "@/components/InvestmentCard";
import { Loading } from "@/components/Loading";
import { colors, radius, spacing, textStyles, typography } from "@/constants/theme";
import { getSession } from "@/services/auth";
import { isFundraisingOpen, listMyInvestments, type MyInvestment } from "@/services/investments";
import { formatVndAmount } from "@/utils/format";

/**
 * [2026-09-16 확정-결정사항 5] 내 투자 — MY > 내 투자.
 *
 * 왜 이 화면이 필요한가: 모집이 끝난 투자상품은 투자 탭(T3) 목록에서 사라진다.
 * 그런데 이미 투자한 사람에게 그 상품은 여전히 자기 자산이다. 사용자 결정 —
 * "모집이 마감된 상품은 목록에서 숨기지만, 투자자는 자신의 투자상품의 목록을 볼 수
 * 있도록". 이 화면이 그 "볼 수 있는 곳"이다.
 *
 * 그전에는 MY의 "내 투자" 타일이 투자 탭으로 보냈다. 기간 필터가 붙은 뒤로는 그
 * 목록에 자기 상품이 없을 수 있어, 타일을 이 화면으로 돌렸다.
 *
 * 모집 기간을 보지 않는다 — listMyInvestments가 내 주문에 있는 상품을 무조건
 * 가져온다. 대신 카드 아래에 "모집 마감"을 적어 지금 상태를 알려 준다.
 */
export default function MyInvestmentsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [items, setItems] = useState<MyInvestment[]>([]);

  // 탭에서 들어왔다 나갔다 하는 화면이라 포커스마다 다시 읽는다 — 투자 신청을 하고
  // 돌아오면 바로 보여야 한다(my.tsx가 useFocusEffect를 쓰는 이유와 같다).
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      setLoading(true);

      getSession().then((session) => {
        if (!mounted) return;
        if (!session) {
          setSignedIn(false);
          setItems([]);
          setLoading(false);
          return;
        }
        setSignedIn(true);
        listMyInvestments().then((list) => {
          if (!mounted) return;
          setItems(list);
          setLoading(false);
        });
      });

      return () => {
        mounted = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("myInvestments.title")} leftAction={<BackButton fallback="/my" />} />

      {loading ? (
        <Loading />
      ) : !signedIn ? (
        <EmptyState
          title={t("myInvestments.signedOutTitle")}
          description={t("myInvestments.signedOutDescription")}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={t("myInvestments.emptyTitle")}
          description={t("myInvestments.emptyDescription")}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((item) => {
            const open = isFundraisingOpen(item.product);
            return (
              <View key={item.product.id} style={styles.row}>
                <InvestmentCard
                  product={item.product}
                  variant="list"
                  onPress={() => router.push(`/invest-detail/${item.product.id}`)}
                />
                {/* 카드는 상품 정보만 보여 준다. 여기서만 아는 것 — 내가 얼마를
                    넣었는지, 그리고 지금도 모집 중인지 — 를 아래에 붙인다. */}
                <View style={[styles.myRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                    {t("myInvestments.myAmountLabel")}
                  </Text>
                  <Text
                    style={[
                      textStyles.bodySmall,
                      { color: theme.text, fontWeight: typography.weight.semibold },
                    ]}
                  >
                    {formatVndAmount(item.totalAmount)}
                    {item.orders.length > 1
                      ? ` · ${t("myInvestments.orderCount", { count: item.orders.length })}`
                      : ""}
                  </Text>
                </View>
                {!open ? (
                  <Text style={[textStyles.caption, styles.closedNote, { color: theme.secondaryText }]}>
                    {t("myInvestments.closedNote")}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    gap: spacing.xs,
  },
  myRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  closedNote: {
    paddingHorizontal: spacing.xs,
  },
});
