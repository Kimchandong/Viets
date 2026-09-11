import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { Toast } from "@/components/Toast";
import {
  colors,
  opacity,
  radius,
  spacing,
  textStyles,
  typography,
  type ThemeColors,
} from "@/constants/theme";
import { getSession, onAuthStateChange } from "@/services/auth";
import { listManagedConversations, type ManagedConversation } from "@/services/chat";
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
 *
 * [2026-09-11 사용자 지시 — 2차] 상태 셀렉트를 입력란 모양에서 **카드 우측 상단 배지**로
 * 바꿨다. 목록에서 알고 싶은 것은 "지금 어떤 상태인가"이고, 바꾸는 일은 그보다 드물다 —
 * 배지는 한 줄을 차지하지 않으면서 색으로 상태를 먼저 읽히게 한다(누르면 선택 모달).
 */

/** 배지 색 — 사용자 지정: 공개 파랑 / 완료 색 없음 / 보류 주황 / 추천 빨강. */
function badgeColors(value: string, theme: ThemeColors): { background: string; text: string; border: string } {
  switch (value) {
    case "public":
      return { background: theme.accent, text: theme.onAccent, border: theme.accent };
    case "hold":
      return { background: theme.warning, text: theme.onAccent, border: theme.warning };
    case "featured":
      return { background: theme.danger, text: theme.onAccent, border: theme.danger };
    // done(완료)과 값 없음(pending_review 등)은 배경 없이 테두리만 — 끝난 매물이
    // 목록에서 색으로 튀어 오를 이유가 없다.
    default:
      return { background: "transparent", text: theme.secondaryText, border: theme.border };
  }
}

const TABS: ManagedPropertyTab[] = ["public", "done", "hold", "featured"];

/** [2026-09-11 사용자 지시 — 2차] 목록 영역 안팎 여백 10px 고정. */
const ROW_PADDING = 10;

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
  // 매물 id → 그 매물에 들어온 고객 상담들. 배지에는 이 중 "답장 안 한" 건수를 띄우고,
  // 배지를 누르면 이 목록으로 대화를 고르게 한다(1건이면 고를 것이 없으니 바로 연다).
  const [conversationsByProperty, setConversationsByProperty] = useState<
    Record<string, ManagedConversation[]>
  >({});
  /** 상담이 2건 이상인 매물의 배지를 눌렀을 때 띄우는 선택 팝업. */
  const [inquiryPicker, setInquiryPicker] = useState<{
    propertyId: string;
    conversations: ManagedConversation[];
  } | null>(null);
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
      // 상담은 매물과 다른 테이블이라 따로 센다. 실패해도 목록 자체는 떠야 하므로
      // 두 요청을 한 Promise로 묶지 않는다(상담 조회가 막혀도 매물은 보인다).
      listManagedConversations().then((conversations) => {
        if (!active) return;
        const grouped: Record<string, ManagedConversation[]> = {};
        for (const conversation of conversations) {
          (grouped[conversation.propertyId] ??= []).push(conversation);
        }
        setConversationsByProperty(grouped);
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

  /** 배지에 띄울 숫자 — 마지막 말이 고객 것인, 즉 아직 답이 나가지 않은 상담 수. */
  function pendingCount(propertyId: string): number {
    return (conversationsByProperty[propertyId] ?? []).filter((c) => c.needsReply).length;
  }

  function openConversation(propertyId: string, conversationId: string) {
    setInquiryPicker(null);
    router.push({
      pathname: "/property-chat/[id]",
      params: { id: propertyId, conversationId },
    });
  }

  /**
   * 알림 배지 누름. 상담이 1건이면 고를 것이 없으니 곧장 그 대화로 들어가고, 여러
   * 건이면 어느 고객의 상담인지 골라야 하므로 목록 팝업을 띄운다. 0건이면 아무 일도
   * 하지 않는다(열 대화가 없다).
   */
  function handleInquiryPress(property: ManagedProperty) {
    const list = conversationsByProperty[property.id] ?? [];
    if (list.length === 0) return;
    if (list.length === 1) {
      openConversation(property.id, list[0].id);
      return;
    }
    setInquiryPicker({ propertyId: property.id, conversations: list });
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

      {/* [2026-09-11 사용자 지시 — 2·4차] 4개 탭이 화면 폭을 정확히 4등분하는 사각 탭.
          선택은 윗변 2px 파란 선으로만 표시한다 — 비활성 탭도 같은 두께의 투명 선을
          두어야 탭을 옮길 때 글자가 아래위로 흔들리지 않는다. */}
      <View style={[styles.tabRow, { borderBottomColor: theme.border }]}>
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
                  borderTopColor: active ? theme.accent : "transparent",
                  opacity: pressed ? opacity.pressed : 1,
                },
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
                {t(`myProperties.tabs.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <Loading />
      ) : visible.length === 0 ? (
        <EmptyState
          title={t("myProperties.emptyTitle")}
          description={t(`myProperties.emptyDescription.${tab}`)}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {visible.map((property, index) => (
            <Fragment key={property.id}>
              <View style={styles.item}>
                {/* 상태 배지는 우측 상단 — 색만 보고도 상태를 읽을 수 있다.
                    그 왼쪽에는 아직 답장하지 않은 고객 문의 수를 같은 모양의 배지로 둔다.
                    [2026-09-11 사용자 지시 — 5차] 0건이어도 배지를 없애지 않고 "-"로
                    표기한다 — 줄마다 배지 자리가 고정돼야 목록이 들쭉날쭉해지지 않는다. */}
                <View style={styles.badgeRow}>
                  <Pressable
                    onPress={() => handleInquiryPress(property)}
                    accessibilityRole="button"
                    accessibilityLabel={t("myProperties.pendingInquiries", {
                      pending: pendingCount(property.id),
                    })}
                    style={({ pressed }) => [
                      styles.badge,
                      { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                    ]}
                  >
                    <Ionicons name="notifications-outline" size={12} color={theme.danger} />
                    <Text
                      style={[
                        textStyles.caption,
                        { color: theme.danger, fontWeight: typography.weight.medium },
                      ]}
                    >
                      {pendingCount(property.id) > 0 ? pendingCount(property.id) : "-"}
                    </Text>
                  </Pressable>

                  <StatusBadge
                    value={currentSelectValue(property)}
                    options={selectOptions}
                    placeholder={t("myProperties.otherStatus")}
                    modalTitle={t("myProperties.changeStatus")}
                    closeLabel={t("common.cancel")}
                    theme={theme}
                    onChange={(next) => handleSelect(property, next)}
                  />
                </View>

                <Pressable
                  onPress={() => router.push(`/property-detail/${property.id}`)}
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
              </View>

              {/* 구분선은 줄 **사이**에만 둔다 — 마지막 줄 아래에 그으면 목록이 끝났는데
                  다음이 있는 것처럼 보인다. 줄의 자식이 아니라 형제로 두어야 위아래 10px
                  여백이 선을 기준으로 대칭이 된다. */}
              {index < visible.length - 1 ? <View style={styles.separator} /> : null}
            </Fragment>
          ))}
        </ScrollView>
      )}

      {/* [2026-09-11 사용자 지시 — 6차] 한 매물에 여러 고객이 상담을 걸었을 때
          어느 대화로 들어갈지 고르는 팝업. 상담이 1건이면 이 팝업을 거치지 않는다. */}
      <Modal
        visible={!!inquiryPicker}
        onClose={() => setInquiryPicker(null)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("chatInbox.title")}
        </Text>
        <ScrollView style={styles.pickerList}>
          {(inquiryPicker?.conversations ?? []).map((conversation) => (
            <Pressable
              key={conversation.id}
              onPress={() => openConversation(inquiryPicker!.propertyId, conversation.id)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.option,
                { borderBottomColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <View style={styles.pickerTexts}>
                <Text style={[textStyles.body, { color: theme.text }]} numberOfLines={1}>
                  {conversation.lastMessageText || t("chatInbox.imageMessage")}
                </Text>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                  {conversation.lastMessageAt.slice(0, 10)}
                </Text>
              </View>
              {conversation.needsReply ? (
                <View style={[styles.pickerBadge, { backgroundColor: theme.danger }]}>
                  <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                    {t("chatInbox.needsReply")}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

/**
 * 상태 배지 겸 선택 버튼. components/Select.tsx를 쓰지 않는 이유는 그쪽이 "라벨 + 한 줄
 * 입력란" 모양을 전제로 하기 때문이다 — 여기서는 카드 구석의 작은 배지가 트리거이고,
 * 열리는 목록은 같다.
 */
function StatusBadge({
  value,
  options,
  placeholder,
  modalTitle,
  closeLabel,
  theme,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  modalTitle: string;
  closeLabel: string;
  theme: ThemeColors;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const palette = badgeColors(value, theme);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={modalTitle}
        accessibilityValue={{ text: selected?.label }}
        style={({ pressed }) => [
          styles.badge,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            opacity: pressed ? opacity.pressed : 1,
          },
        ]}
      >
        <Text
          style={[textStyles.caption, { color: palette.text, fontWeight: typography.weight.medium }]}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={12} color={palette.text} />
      </Pressable>

      <Modal visible={open} onClose={() => setOpen(false)} accessibilityLabel={closeLabel}>
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {modalTitle}
        </Text>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                setOpen(false);
                onChange(option.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.option,
                { borderBottomColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text style={[textStyles.body, { color: active ? theme.accent : theme.text }]}>
                {option.label}
              </Text>
              {active ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
            </Pressable>
          );
        })}
      </Modal>
    </>
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
  // 4칸 고정 — 각 탭이 가로 폭을 정확히 25%씩 나눠 갖는다(사각 탭이라 간격 없이 붙인다).
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  // [2026-09-11 사용자 지시 — 3차] 목록은 여백도 배경도 없이 화면 폭을 그대로 쓰고,
  // 줄 사이만 점선으로 나눈다.
  content: {
    paddingHorizontal: ROW_PADDING,
  },
  item: {
    paddingVertical: ROW_PADDING,
    gap: spacing.xs,
  },
  // RN에서 borderStyle은 네 변에 함께 적용되므로, 한 변짜리 점선은 높이 0짜리
  // View의 윗변으로 만든다(웹/네이티브 모두 같은 모양으로 그려진다).
  separator: {
    height: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
    borderColor: "#ddd",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerList: {
    maxHeight: 320,
  },
  pickerTexts: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  pickerBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.full,
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
