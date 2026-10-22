import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Toast } from "@/components/Toast";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import {
  addAgencyStaff,
  listAgencyStaff,
  removeAgencyStaff,
  searchAgencyCandidates,
  type AgencyStaff,
  type AgencyUserSearchResult,
} from "@/services/agencyStaff";

/**
 * [2026-10-22 사용자 지시] 직원관리 — 내 업체 소속 직원 추가/삭제.
 *
 * owner만 들어온다(목록 RPC가 owner가 아니면 예외를 던진다 — 빈 목록으로 조용히
 * 넘어가지 않게 서버에서 끊는다). staff·admin에게는 호출부에서 메뉴를 숨긴다.
 */
export default function AgencyStaffScreen() {
  const theme = colors.light;
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<AgencyStaff[]>([]);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<AgencyUserSearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStaff(await listAgencyStaff());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1600);
  }

  async function handleSearch() {
    const term = search.trim();
    if (term.length < 2) {
      showToast(t("agencyStaff.searchTooShort"));
      return;
    }
    setSearching(true);
    setResults(await searchAgencyCandidates(term));
    setSearched(true);
    setSearching(false);
  }

  async function handleAdd(user: AgencyUserSearchResult) {
    setBusyId(user.userId);
    const ok = await addAgencyStaff(user.userId);
    setBusyId(null);
    if (!ok) {
      showToast(t("agencyStaff.addFailed"));
      return;
    }
    // 추가된 사람은 검색 결과에서 지운다 — 서버가 중복을 막으므로 다시 눌러도 실패만 한다.
    setResults((prev) => prev.filter((item) => item.userId !== user.userId));
    showToast(t("agencyStaff.added"));
    void load();
  }

  async function handleRemove(member: AgencyStaff) {
    setBusyId(member.memberId);
    const ok = await removeAgencyStaff(member.memberId);
    setBusyId(null);
    if (!ok) {
      showToast(t("agencyStaff.removeFailed"));
      return;
    }
    showToast(t("agencyStaff.removed"));
    void load();
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("agencyStaff.title")} leftAction={<BackButton fallback="/my" />} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 추가 — 이메일이나 이름으로 계정을 찾아 넣는다. */}
        <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("agencyStaff.addTitle")}</Text>
        <View style={[styles.searchBar, { borderColor: theme.border }]}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t("agencyStaff.searchPlaceholder")}
            placeholderTextColor={theme.secondaryText}
            style={[textStyles.body, styles.searchInput, { color: theme.text }]}
          />
          <Pressable
            onPress={handleSearch}
            accessibilityRole="button"
            accessibilityLabel={t("agencyStaff.search")}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? opacity.pressed : 1 }]}
          >
            <Ionicons name="search" size={18} color={theme.secondaryText} />
          </Pressable>
        </View>

        {searching ? <ActivityIndicator color={theme.accent} /> : null}
        {!searching && searched && results.length === 0 ? (
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("agencyStaff.noResults")}
          </Text>
        ) : null}
        {results.map((user) => (
          <View key={user.userId} style={[styles.row, { borderColor: theme.border }]}>
            <View style={styles.rowText}>
              <Text style={[textStyles.body, { color: theme.text }]} numberOfLines={1}>
                {user.displayName ?? user.email}
              </Text>
              {user.displayName ? (
                <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => handleAdd(user)}
              disabled={busyId === user.userId}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: theme.buttonPrimary, opacity: busyId === user.userId ? opacity.disabled : pressed ? opacity.pressed : 1 },
              ]}
            >
              <Text style={[textStyles.caption, { color: theme.onAccent }]}>{t("agencyStaff.add")}</Text>
            </Pressable>
          </View>
        ))}

        {/* 현재 소속 */}
        <Text style={[textStyles.sectionTitle, styles.listTitle, { color: theme.text }]}>
          {t("agencyStaff.listTitle")}
        </Text>
        {loading ? (
          <ActivityIndicator color={theme.accent} />
        ) : staff.length === 0 ? (
          <EmptyState title={t("agencyStaff.empty")} />
        ) : (
          staff.map((member) => (
            <View key={member.memberId} style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.rowText}>
                <Text style={[textStyles.body, { color: theme.text }]} numberOfLines={1}>
                  {member.displayName ?? member.email}
                </Text>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
                  {member.email} · {t(`agencyStaff.role.${member.role}`)}
                </Text>
              </View>
              {/* owner 행에는 삭제 버튼을 두지 않는다 — 서버도 막지만, 누를 수 없는
                  버튼을 보여 주면 "왜 안 되지"를 사용자가 떠안는다. */}
              {member.role === "staff" ? (
                <Pressable
                  onPress={() => handleRemove(member)}
                  disabled={busyId === member.memberId}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.action,
                    { backgroundColor: theme.danger, opacity: busyId === member.memberId ? opacity.disabled : pressed ? opacity.pressed : 1 },
                  ]}
                >
                  <Text style={[textStyles.caption, { color: theme.onAccent }]}>{t("agencyStaff.remove")}</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
      <Toast visible={!!toast} message={toast ?? ""} />
    </SafeAreaView>
  );
}

const styles = createScaledStyles(() => ({
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  searchInput: { flex: 1, padding: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, minWidth: 0 },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  listTitle: { marginTop: spacing.lg },
}));
