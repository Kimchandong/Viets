import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Toast } from "@/components/Toast";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles, typography, scaleFont } from "@/constants/theme";
import {
  AD_SLOT_CAPACITY,
  getMyBid,
  listAdSlots,
  setAdBid,
  type AdPlacement,
  type AdSlot,
} from "@/services/ads";
import { getMyBalance, getPaymentSettings, type AgencyBalance } from "@/services/payments";
import { listManagedProperties, type ManagedProperty } from "@/services/properties";
import { formatMoneyAmount } from "@/utils/format";

/**
 * [2026-09-12 사용자 지시] 광고 자리 구매 — 추천매물 / TOP10.
 *
 * 오버추어식 **클릭당 과금**이다: 순위에 적는 금액은 고객이 그 매물을 한 번 눌렀을
 * 때 빠져나가는 금액이고, 자리에 들어갈 때는 차감되지 않는다. 원하는 순위를 누르면
 * 그 자리 금액보다 높은 값이 채워지고, 밀려난 매물은 한 칸 내려간다. 노출 자리 수
 * (추천 5 / TOP10 10) 아래로 밀리면 보이지 않으므로 클릭도 과금도 없다.
 *
 * 화면을 property-register 안의 모달이 아니라 별도 화면으로 둔 이유: 순위표 + 잔액 +
 * 금액 입력이 한 화면치 정보량이고, 매물을 저장한 뒤에만 설정할 수 있어(매물 id가
 * 있어야 한다) 등록 폼과 생애주기가 다르다.
 */

/** 진입 금액의 최소 증분 — 같은 금액이면 순위가 갈리지 않으므로 1이라도 더 내야 한다. */
const BID_STEP = 1;

export default function AdSlotsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; placement?: string }>();

  /**
   * [2026-09-12 사용자 제보] 매물이 여러 개면 "지금 어느 매물을 올리는 것인지"를
   * 알 수 없었다. 목록에서 넘어온 id를 시작값으로 두되, 이 화면 안에서도 대상을
   * 바꿀 수 있게 상태로 들고 있는다.
   */
  const [propertyId, setPropertyId] = useState(params.id ?? "");
  const placement: AdPlacement = params.placement === "top10" ? "top10" : "featured";

  /** 내가 관리하는 매물 — 대상 변경 팝업에 쓴다. */
  const [myProperties, setMyProperties] = useState<ManagedProperty[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const targetProperty = myProperties.find((property) => property.id === propertyId) ?? null;

  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [minBid, setMinBid] = useState(0);
  const [myBid, setMyBid] = useState(0);
  const [balance, setBalance] = useState<AgencyBalance | null>(null);
  const [currency, setCurrency] = useState("VND");

  /** 구매 확인 모달 — null이면 닫힘. targetRank는 안내 문구에만 쓴다. */
  const [target, setTarget] = useState<{ rank: number; required: number } | null>(null);
  /** 노출되는 자리 수 — 이 아래 순위는 보이지 않으므로 클릭도 과금도 없다. */
  const capacity = AD_SLOT_CAPACITY[placement];
  const [amountDraft, setAmountDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextSlots, settings, nextBid, nextBalance, nextProperties] = await Promise.all([
      listAdSlots(placement),
      getPaymentSettings(),
      propertyId ? getMyBid(propertyId, placement) : Promise.resolve(0),
      getMyBalance(),
      listManagedProperties(),
    ]);
    setSlots(nextSlots);
    setMyProperties(nextProperties);
    // 목록에서 넘어오지 않았거나(주소로 직접 진입) 지워진 매물이면 첫 매물로 맞춘다.
    if (!propertyId && nextProperties.length > 0) {
      setPropertyId(nextProperties[0].id);
    }
    setMinBid(
      settings ? (placement === "top10" ? settings.top10MinBid : settings.featuredMinBid) : 0,
    );
    setCurrency(settings?.currency ?? "VND");
    setMyBid(nextBid);
    setBalance(nextBalance);
    setLoading(false);
  }, [placement, propertyId]);

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

  /**
   * [2026-09-12 사용자 제보] 뒤로가기가 동작하지 않는 경우가 있었다.
   *
   * router.back()은 **되돌아갈 기록이 있을 때만** 동작한다. 이 화면은 매물 수정에서
   * 밀어 올려 여는 것이 정상 경로지만, 새로고침(웹 미리보기의 리로드)이나 푸시
   * 알림으로 이 주소에 바로 들어오면 스택이 비어 있어 아무 일도 일어나지 않는다.
   * 그럴 때는 원래 있어야 할 화면(그 매물의 수정 화면)으로 대신 보낸다.
   */
  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (propertyId) {
      router.replace({ pathname: "/property-register", params: { id: propertyId } });
      return;
    }
    router.replace("/my");
  }

  function showToast(message: string, ms = 1800) {
    setToast(message);
    setTimeout(() => setToast(null), ms);
  }

  /**
   * 그 순위로 들어가는 데 필요한 최소 금액.
   *
   * 비어 있는 자리는 관리자가 정한 최소금액, 누가 있는 자리는 그 금액 + 1.
   * 내 매물 줄을 누른 경우는 "금액 변경"이라 최소금액만 넘으면 된다 —
   * [2026-09-12 사용자 지시] 순위를 올리는 것뿐 아니라 내리는 것도 가능해야 한다.
   */
  function requiredFor(slot: AdSlot | null): number {
    if (slot && slot.propertyId === propertyId) return minBid;
    return Math.max(slot ? slot.clickFee + BID_STEP : minBid, minBid);
  }

  function openPurchase(rank: number, slot: AdSlot | null) {
    if (!propertyId) {
      showToast(t("adSlots.needProperty"));
      return;
    }
    if (minBid <= 0) {
      showToast(t("adSlots.minBidNotSet"));
      return;
    }
    const required = requiredFor(slot);
    setTarget({ rank, required });
    // 내 줄을 눌렀으면 지금 금액을 채워 둔다 — 올릴지 내릴지는 사용자가 정한다.
    setAmountDraft(String(slot?.propertyId === propertyId && myBid > 0 ? myBid : required));
  }

  async function handlePurchase() {
    if (!target || submitting) return;

    const amount = Number(amountDraft.replace(/[^0-9]/g, ""));
    // [2026-09-16 확정 7] 화면에서 미리 막는 것은 **최소금액**까지만이다.
    //
    // 예전에는 target.required(= 누른 줄 금액 + 1)로 막았는데, 그 값은 목록을 읽은
    // 시점의 것이라 그 사이 그 업체가 금액을 내리면 서버라면 통과했을 입찰을 화면이
    // 거절했다(불일치-목록 4①). 최소금액은 관리자 설정값이라 그런 경쟁이 없다.
    // 순위 판정은 서버가 한다 — 서버만이 지금 순간의 판을 안다.
    if (!Number.isFinite(amount) || amount < minBid) {
      showToast(t("adSlots.belowMin", { amount: formatMoneyAmount(minBid, currency) }), 3000);
      return;
    }

    setSubmitting(true);
    // [2026-09-16 확정-결정사항 6] 목표 순위를 함께 보낸다 — 서버가 "N위를 산다"는
    // 약속을 검사한다. 내 줄을 눌러 금액만 바꾸는 경우는 순위 약속이 아니므로
    // null을 보낸다(서버도 자리를 가진 매물은 순위를 검사하지 않는다).
    const isMyRow = myBid > 0 && slots.some((slot) => slot.propertyId === propertyId);
    const { code, requiredAmount } = await setAdBid(
      propertyId,
      placement,
      amount,
      isMyRow ? null : target.rank,
    );
    setSubmitting(false);

    if (code === "ok") {
      setTarget(null);
      showToast(t("adSlots.saved"));
      // [2026-09-12 실기기 테스트에서 발견] 저장 뒤에도 이 화면에 남아 있으면,
      // 아래 "내 광고비 변경" 버튼이 그대로 보여서 **저장이 안 된 것처럼** 읽혔다.
      // 저장했으면 하던 일이 끝난 것이므로 매물 목록으로 돌려보낸다 — 토스트를
      // 읽을 시간만 잠깐 둔다.
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace("/ad-manage");
      }, 900);
      return;
    }
    // [2026-09-16 확정 7] 안내 금액은 **서버가 준 값**을 쓴다. 화면이 계산한
    // target.required는 목록을 읽은 시점의 값이라, 그 사이 다른 업체가 금액을 바꾸면
    // 틀린 숫자를 안내하게 된다.
    const requiredText = formatMoneyAmount(requiredAmount ?? target.required, currency);

    if (code === "below-min") {
      showToast(t("adSlots.belowMin", { amount: requiredText }), 3000);
      return;
    }
    // [확정 6] 그 순위를 다른 업체가 먼저 채웠다. 사용자 결정에 따라 자동으로 아래
    // 순위에 넣지 않고 거절한 뒤, **자리 목록을 다시 읽어** 현재 판을 보여 준다.
    // 모달은 열어 둔다 — 새 금액으로 바로 다시 시도할 수 있어야 한다.
    if (code === "outbid") {
      showToast(t("adSlots.outbid", { amount: requiredText }), 3500);
      if (requiredAmount != null) {
        setTarget({ rank: target.rank, required: requiredAmount });
        setAmountDraft(String(requiredAmount));
      }
      await load().catch(() => undefined);
      return;
    }
    if (code === "no-balance") {
      showToast(t("adSlots.noBalance"));
      return;
    }
    if (code === "no-agency") {
      showToast(t("adSlots.noAgency"), 3000);
      return;
    }
    // 거래완료·보류로 바꾼 매물 — 광고를 걸어도 고객 화면에 나오지 않는다.
    if (code === "not-active") {
      showToast(t("adSlots.notActive"), 3000);
      return;
    }
    // 자리 수를 넘는 순위 — 화면에서는 고를 수 없는 값이라 여기 오면 목록이
    // 오래된 것이다. 다시 읽어 맞춘다.
    if (code === "rank-invalid") {
      showToast(t("adSlots.failed"));
      await load().catch(() => undefined);
      return;
    }
    showToast(t("adSlots.failed"));
  }

  /**
   * 자리 수만큼은 비어 있어도 순위로 보여 준다("몇 위가 비었는지"가 구매 판단의
   * 핵심), 그 아래로 밀린 매물은 노출되지 않는다는 표시와 함께 이어 붙인다.
   */
  const rows: { rank: number; slot: AdSlot | null }[] = [
    ...Array.from({ length: capacity }, (_, index) => ({
      rank: index + 1,
      slot: slots[index] ?? null,
    })),
    ...slots.slice(capacity).map((slot) => ({ rank: slot.rank, slot })),
  ];

  const title = t(placement === "top10" ? "adSlots.top10Title" : "adSlots.featuredTitle");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header
        title={title}
        leftAction={
          <Pressable onPress={goBack} accessibilityRole="button" hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
        }
      />

      {loading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Card style={styles.summary}>
            {/* [2026-09-12 사용자 제보] 어느 매물의 광고인지 맨 위에 못박는다. */}
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.targetRow,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <View style={styles.targetTexts}>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                  {t("adSlots.targetProperty")}
                </Text>
                {/* [2026-09-12 사용자 지시] 매물명 한 단계 크게(bodySmall → body). */}
                <Text style={[textStyles.body, { color: theme.text }]} numberOfLines={1}>
                  {targetProperty?.title ?? t("adSlots.targetUnknown")}
                </Text>
              </View>
              <Text style={[textStyles.caption, { color: theme.accent }]}>
                {t("adSlots.changeTarget")}
              </Text>
            </Pressable>

            <View style={styles.summaryRow}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("adSlots.minBid")}
              </Text>
              <Text style={[textStyles.bodySmall, { color: theme.text }]}>
                {formatMoneyAmount(minBid, currency)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("adSlots.myBid")}
              </Text>
              <Text style={[textStyles.bodySmall, { color: theme.text }]}>
                {myBid > 0 ? formatMoneyAmount(myBid, currency) : t("adSlots.noBid")}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("adSlots.available")}
              </Text>
              <Text style={[textStyles.bodySmall, { color: theme.accent }]}>
                {formatMoneyAmount(balance?.available ?? 0, currency)}
              </Text>
            </View>
            <Text style={[textStyles.caption, styles.hint, { color: theme.secondaryText }]}>
              {t("adSlots.hint", { count: capacity })}
            </Text>
          </Card>

          {rows.length === 0 ? (
            <EmptyState title={t("adSlots.emptyTitle")} description={t("adSlots.emptyDescription")} />
          ) : (
            <Card style={styles.listCard}>
              {rows.map(({ rank, slot }, index) => {
                const isMine = slot?.propertyId === propertyId;
                return (
                  <Pressable
                    key={`${rank}-${slot?.propertyId ?? "empty"}`}
                    onPress={() => openPurchase(rank, slot)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.row,
                      index < rows.length - 1 && {
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: theme.border,
                      },
                      { opacity: pressed ? opacity.pressed : 1 },
                    ]}
                  >
                    <View
                      style={[
                        styles.rankBadge,
                        // 노출되는 자리만 강조한다 — 그 아래는 보이지 않는 순위다.
                        { backgroundColor: rank <= capacity ? theme.accent : theme.surfaceMuted },
                      ]}
                    >
                      <Text
                        style={[
                          styles.rankText,
                          { color: rank <= capacity ? theme.onAccent : theme.secondaryText },
                        ]}
                      >
                        {rank}
                      </Text>
                    </View>

                    <View style={styles.rowTexts}>
                      <Text
                        style={[textStyles.bodySmall, { color: slot ? theme.text : theme.secondaryText }]}
                        numberOfLines={1}
                      >
                        {slot ? slot.title : t("adSlots.emptySlot")}
                      </Text>
                      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                        {t("adSlots.perClick", {
                          amount: formatMoneyAmount(slot ? slot.clickFee : minBid, currency),
                        })}
                        {isMine ? ` · ${t("adSlots.mine")}` : ""}
                        {rank > capacity ? ` · ${t("adSlots.notShown")}` : ""}
                      </Text>
                    </View>

                    <Text style={[textStyles.caption, { color: theme.accent }]}>
                      {t("adSlots.enter")}
                    </Text>
                  </Pressable>
                );
              })}
            </Card>
          )}

          {/* [2026-09-12 사용자 지시] 이미 광고 중이면 금액을 올리거나 내릴 수 있다.
              순위표에서 내 줄을 눌러도 되지만, 자리 밖으로 밀려 목록에 없을 수도 있어
              별도 버튼을 둔다. */}
          {myBid > 0 ? (
            <Button
              variant="outline"
              title={t("adSlots.changeBid")}
              onPress={() => {
                if (minBid <= 0) {
                  showToast(t("adSlots.minBidNotSet"));
                  return;
                }
                setTarget({ rank: 0, required: minBid });
                setAmountDraft(String(myBid));
              }}
            />
          ) : (
            <Button
              variant="outline"
              title={t("adSlots.joinNew")}
              onPress={() => openPurchase(slots.length + 1, null)}
            />
          )}
        </ScrollView>
      )}

      {/* 대상 매물 변경 */}
      <Modal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("adSlots.pickTargetTitle")}
        </Text>
        <ScrollView style={styles.pickerList}>
          {myProperties.map((property) => (
            <Pressable
              key={property.id}
              onPress={() => {
                setPropertyId(property.id);
                setPickerOpen(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.pickerItem,
                { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text
                style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]}
                numberOfLines={1}
              >
                {property.title}
              </Text>
              {property.id === propertyId ? (
                <Ionicons name="checkmark" size={18} color={theme.accent} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </Modal>

      <Modal visible={!!target} onClose={() => setTarget(null)} accessibilityLabel={t("common.cancel")}>
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.xs }]}>
          {target?.rank ? t("adSlots.purchaseTitle", { rank: target.rank }) : t("adSlots.changeBid")}
        </Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText, marginBottom: spacing.sm }]}>
          {t("adSlots.purchaseHint", {
            amount: formatMoneyAmount(target?.required ?? 0, currency),
          })}
        </Text>
        <Input value={amountDraft} onChangeText={setAmountDraft} keyboardType="numeric" />
        {/* 금액을 내리면 순위도 내려가고, 자리 수 밖으로 밀리면 노출이 끊긴다.
            누르기 전에 알려 줘야 "왜 사라졌는지"를 나중에 묻지 않는다. */}
        {myBid > 0 && Number(amountDraft.replace(/[^0-9]/g, "")) < myBid ? (
          <Text style={[textStyles.caption, styles.lowerWarning, { color: theme.warning }]}>
            {t("adSlots.lowerWarning")}
          </Text>
        ) : null}
        <View style={styles.modalActions}>
          <Button
            style={styles.modalButton}
            variant="outline"
            title={t("common.cancel")}
            onPress={() => setTarget(null)}
          />
          <Button
            style={styles.modalButton}
            title={submitting ? t("adSlots.saving") : t("common.save")}
            onPress={handlePurchase}
            disabled={submitting}
          />
        </View>
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.screenPaddingX,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  summary: {
    gap: spacing.xs,
  },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
  },
  targetTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pickerList: {
    maxHeight: 280,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hint: {
    marginTop: spacing.xs,
  },
  listCard: {
    padding: 0,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontSize: scaleFont(12),
    fontWeight: typography.weight.bold,
  },
  rowTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  lowerWarning: {
    marginTop: spacing.xs,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalButton: {
    flex: 1,
  },
}));
