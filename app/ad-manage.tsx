import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import type { AdPlacement } from "@/services/ads";
import { listManagedProperties, type ManagedProperty } from "@/services/properties";

/**
 * [2026-09-12 사용자 지시] 유료 노출광고 — 광고를 한곳에서 관리하는 화면.
 *
 * 처음에는 매물 수정 폼 안에, 다음에는 매물 목록 안에 두었는데 둘 다 "무엇을 하는
 * 자리인지"가 흐렸다(폼은 저장해야 반영되는 것처럼 읽히고, 목록은 상태 관리 화면이라
 * 광고가 곁다리로 보였다). 광고는 매물 관리와 목적이 다른 별도 작업이므로 화면을 따로 뒀다.
 *
 * 순서: 위에서 자리를 고르고 → 아래 목록에서 매물을 고른다. 자리를 먼저 고르는 이유는
 * 자리마다 순위표와 최소금액이 달라, 매물을 먼저 고르면 다시 자리를 묻게 되기 때문이다.
 */
export default function AdManageScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  /**
   * [2026-09-12 사용자 지시] 처음에는 아무 자리도 고르지 않은 상태로 연다 —
   * 기본값이 켜져 있으면 어디에 광고하는지 모른 채 매물을 누르게 된다.
   */
  const [placement, setPlacement] = useState<AdPlacement | null>(null);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  /**
   * [2026-09-12 사용자 지시] 자리를 골라도 매물은 아무것도 선택되지 않은 상태로 둔다.
   * 목록 전체가 파랗게 되면 "이미 다 골라진 것"처럼 보여, 매물이 하나뿐이어도 직접
   * 고르게 한다. 파란 테두리는 지금 고른 한 줄에만 붙는다.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setSelectedId(null);
      listManagedProperties().then((list) => {
        if (!active) return;
        // [2026-09-12] 거래완료/보류 매물은 고객 화면에 나오지 않으므로 광고를 걸어도
        // 노출되지 않는다(상태가 active를 벗어나면 트리거가 자리를 반납한다).
        // 목록에 남겨 두면 돈을 넣고도 아무 일도 일어나지 않는 길이 열리므로 여기서 뺀다.
        setProperties(list.filter((p) => p.status === "active"));
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("adManage.title")} leftAction={<BackButton fallback="/my" />} />

      {/* 자리 선택 — 누른 쪽이 파란 버튼이 되고, 아래 목록에서 고른 매물이 그 자리로 간다. */}
      <View style={styles.placementRow}>
        {(["featured", "top10"] as const).map((value) => {
          const active = placement === value;
          return (
            <Pressable
              key={value}
              onPress={() => {
                setPlacement(active ? null : value);
                // 자리를 바꾸면 고르던 매물도 초기화한다 — 다른 자리에 그대로 들어갈
                // 뻔한 선택이 남아 있으면 안 된다.
                setSelectedId(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.placementButton,
                {
                  borderColor: active ? theme.accent : theme.border,
                  backgroundColor: active ? theme.accent : "transparent",
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              {/* Ionicons에 광고를 뜻하는 글자 아이콘이 없어 "AD"를 글자 배지로 그린다. */}
              <View style={[styles.adBadge, { borderColor: active ? theme.onAccent : theme.warning }]}>
                <Text style={[styles.adBadgeText, { color: active ? theme.onAccent : theme.warning }]}>
                  AD
                </Text>
              </View>
              <Text
                style={[
                  textStyles.bodySmall,
                  {
                    color: active ? theme.onAccent : theme.text,
                    fontWeight: typography.weight.medium,
                  },
                ]}
              >
                {t(`adManage.placement.${value}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* [2026-09-12 사용자 지시] 안내는 자리를 고른 뒤에만 — 아무것도 고르지 않은
          상태에서 "매물을 선택하세요"가 떠 있으면 무엇부터 해야 하는지 흐려진다. */}
      {placement ? (
        <Text style={[textStyles.caption, styles.hint, { color: theme.warning }]}>
          {t("adManage.hint")}
        </Text>
      ) : null}

      {loading ? (
        <Loading />
      ) : properties.length === 0 ? (
        <EmptyState title={t("adManage.emptyTitle")} description={t("adManage.emptyDescription")} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {properties.map((property) => (
            <Pressable
              key={property.id}
              onPress={() => {
                if (!placement) {
                  // 자리를 고르지 않았으면 어디로 보낼지 정할 수 없다 — 먼저 고르게 한다.
                  setToast(t("adManage.hint"));
                  setTimeout(() => setToast(null), 1800);
                  return;
                }
                setSelectedId(property.id);
                router.push({ pathname: "/ad-slots", params: { id: property.id, placement } });
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                // [2026-09-12 사용자 지시] 줄 앞 선택 버튼 대신 테두리 자체를 파란 2px로
                // — 자리를 고른 뒤에만 파랗게 해 "지금 고를 수 있다"를 색으로 알린다.
                {
                  // 고른 한 줄만 파란 2px — 처음에는 아무것도 선택돼 있지 않다.
                  borderColor: selectedId === property.id ? theme.accent : theme.border,
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              {property.thumbnailUrl ? (
                <Image source={{ uri: property.thumbnailUrl }} style={styles.thumbnail} />
              ) : (
                <View style={[styles.thumbnail, styles.thumbnailEmpty, { borderColor: theme.border }]}>
                  <Ionicons name="image-outline" size={20} color={theme.secondaryText} />
                </View>
              )}

              <View style={styles.texts}>
                <Text style={[textStyles.bodySmall, { color: theme.text }]} numberOfLines={1}>
                  {property.title}
                </Text>
                {property.address.length > 0 ? (
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                    {property.address}
                  </Text>
                ) : null}
                <Text
                  style={[textStyles.caption, { color: theme.accent, fontWeight: typography.weight.medium }]}
                  numberOfLines={1}
                >
                  {property.price}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // [2026-09-12 사용자 지시] 두 버튼이 가로를 절반씩 나눈다.
  placementRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.md,
    paddingBottom: 10,
  },
  placementButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    // [2026-09-12 사용자 지시] AD 배지와 글자 사이 간격을 한 칸 더.
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
  },
  adBadge: {
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
  adBadgeText: {
    fontSize: 9,
    fontWeight: typography.weight.bold,
    lineHeight: 11,
  },
  hint: {
    paddingHorizontal: spacing.screenPaddingX,
    // 버튼 줄이 이미 아래 여백을 갖고 있어 위에는 붙이지 않는다.
    paddingBottom: 10,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
  },
  thumbnailEmpty: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
});
