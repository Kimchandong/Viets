import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Select } from "@/components/Select";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import { getSession, onAuthStateChange } from "@/services/auth";
import {
  listManagedProperties,
  updatePropertyStatus,
  MANAGED_STATUS_BY_TAB,
  type ManagedProperty,
  type ManagedPropertyTab,
} from "@/services/properties";
import { canRegisterProperty } from "@/services/roles";

/**
 * [2026-09-11 사용자 지시] 등록 매물 목록 — MY > 매물 정보.
 *
 * 상단 탭 4종은 서로 다른 두 축을 한 줄에 섞어 놓은 것이다:
 *   공개/완료/보류 → properties.status (active / sold / draft)
 *   추천          → properties.featured (유료 서비스 플래그)
 * 한 매물이 "공개"이면서 동시에 "추천"일 수 있으므로(추천은 상태가 아니다) 추천 탭은
 * 상태와 무관하게 featured=true인 매물을 보여준다.
 *
 * 각 줄의 셀렉트로 상태를 바꾼다. 단, **추천을 고르면 상태를 바꾸지 않고 매물 상세로
 * 보낸다** — 추천은 유료 서비스라 결제 흐름을 거쳐야 하고, 그 결제/기간 설계는 아직
 * 없다. 여기서 featured를 그냥 켜면 돈을 받지 않고 추천 노출을 주는 셈이 된다.
 */

const TABS: ManagedPropertyTab[] = ["public", "done", "hold", "featured"];

/** 셀렉트에 현재 값으로 표시할 항목. 추천이 상태보다 우선한다(유료 진행 중임을 먼저 알린다). */
function currentSelectValue(property: ManagedProperty): string {
  if (property.featured) return "featured";
  const entry = (Object.keys(MANAGED_STATUS_BY_TAB) as ("public" | "done" | "hold")[]).find(
    (key) => MANAGED_STATUS_BY_TAB[key] === property.status,
  );
  // pending_review/off_market/archived 등은 이 화면이 다루는 3종에 없다 —
  // 임의로 하나로 접어서 보여주면 거짓말이 되므로 빈 값(placeholder)으로 둔다.
  return entry ?? "";
}

export default function MyPropertiesScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ManagedPropertyTab>("public");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getSession().then((initial) => {
      if (mounted) {
        setSession(initial);
        setSessionLoading(false);
      }
    });
    const { unsubscribe } = onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!session) {
      setAllowed(false);
      setCheckingPermission(false);
      return;
    }
    canRegisterProperty().then((ok) => {
      if (mounted) {
        setAllowed(ok);
        setCheckingPermission(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [session]);

  // 매물 등록/수정 화면에서 돌아왔을 때 목록이 옛날 그대로면 방금 바꾼 내용이
  // 반영되지 않는다 — 화면에 들어올 때마다 다시 불러온다.
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      listManagedProperties().then((result) => {
        if (!active) return;
        setProperties(result);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [session]),
  );

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1600);
  }

  async function handleSelect(property: ManagedProperty, next: string) {
    if (next === "featured") {
      // 유료 서비스 — 상태를 바꾸지 않고 매물 상세로 보낸다(결제 유도 지점).
      router.push(`/property-detail/${property.id}`);
      return;
    }

    const status = MANAGED_STATUS_BY_TAB[next as "public" | "done" | "hold"];
    if (!status || status === property.status) return;

    const ok = await updatePropertyStatus(property.id, status);
    if (!ok) {
      showToast(t("myProperties.changeFailed"));
      return;
    }
    setProperties((prev) =>
      prev.map((item) => (item.id === property.id ? { ...item, status } : item)),
    );
    showToast(t("myProperties.changed"));
  }

  const screenTitle = t("myProperties.title");
  const selectOptions = TABS.map((key) => ({ value: key, label: t(`myProperties.tabs.${key}`) }));

  const visible = properties.filter((property) =>
    tab === "featured" ? property.featured : property.status === MANAGED_STATUS_BY_TAB[tab],
  );

  if (sessionLoading || checkingPermission) {
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
          title={t("myProperties.noPermissionTitle")}
          description={t("myProperties.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton onPress={() => router.back()} />} />

      {/* 탭은 4개지만 언어에 따라 라벨 길이가 크게 달라(th/ja) 가로 스크롤로 둔다. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
      >
        {TABS.map((key) => {
          const active = key === tab;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.tab,
                {
                  borderColor: active ? theme.accent : theme.border,
                  backgroundColor: active ? theme.accent : theme.card,
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Text
                style={[
                  textStyles.bodySmall,
                  { color: active ? theme.onAccent : theme.text, fontWeight: typography.weight.medium },
                ]}
                numberOfLines={1}
              >
                {t(`myProperties.tabs.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <EmptyState
          title={t("myProperties.emptyTitle")}
          description={t(`myProperties.emptyDescription.${tab}`)}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {visible.map((property) => (
            <View
              key={property.id}
              style={[styles.row, { borderColor: theme.border, backgroundColor: theme.card }]}
            >
              <Pressable
                onPress={() =>
                  router.push(`/property-detail/${property.id}`)
                }
                accessibilityRole="button"
                style={({ pressed }) => [styles.rowMain, { opacity: pressed ? opacity.pressed : 1 }]}
              >
                {property.thumbnailUrl ? (
                  <Image source={{ uri: property.thumbnailUrl }} style={styles.thumbnail} />
                ) : (
                  <View style={[styles.thumbnail, styles.thumbnailEmpty, { borderColor: theme.border }]}>
                    <Ionicons name="image-outline" size={20} color={theme.secondaryText} />
                  </View>
                )}

                <View style={styles.rowTexts}>
                  <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                    {property.title}
                  </Text>
                  {property.address.length > 0 ? (
                    <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                      {property.address}
                    </Text>
                  ) : null}
                  <Text
                    style={[textStyles.bodySmall, { color: theme.accent, fontWeight: typography.weight.medium }]}
                    numberOfLines={1}
                  >
                    {property.price}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color={theme.secondaryText} />
              </Pressable>

              <Select
                value={currentSelectValue(property)}
                options={selectOptions}
                onChange={(next) => handleSelect(property, next)}
                theme={theme}
                modalTitle={t("myProperties.changeStatus")}
                placeholder={t("myProperties.otherStatus")}
                closeLabel={t("common.cancel")}
              />
            </View>
          ))}
        </ScrollView>
      )}

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
  tabRow: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  tab: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  row: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
  },
  thumbnailEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  rowTexts: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
});
