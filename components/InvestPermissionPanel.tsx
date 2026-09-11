import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Loading } from "@/components/Loading";
import { SectionHeader } from "@/components/SectionHeader";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import {
  adminSearchUsers,
  adminSetUserPermission,
  type AdminUserSearchResult,
} from "@/services/roles";

/**
 * [2026-09-11 사용자 지시 — 4차] 투자등록 권한관리 — 투자상품 등록 화면 하단.
 *
 * 왜 여기에 있는가: 이 권한(`investment_manage`)이 실제로 쓰이는 화면이 여기다.
 * MY의 "계정 권한 관리"에 매물·투자 권한을 함께 묶어 두었더니 부동산 등록신청 심사와
 * 역할이 겹쳐 보였다(사용자 지적) — 매물 쪽은 등록신청 심사로 합치고, 투자 쪽은
 * 이 화면으로 내렸다.
 *
 * 계정은 소셜 로그인 이메일로 찾는다. 남의 계정 정보는 RLS로 막혀 있어 직접 조회할 수
 * 없고, 서버의 SECURITY DEFINER 함수(admin_search_users)가 관리자 여부를 확인한 뒤
 * 결과를 돌려준다. 이 컴포넌트를 그리는 쪽에서 관리자인지 이미 확인하지만, 그것은
 * UI 가드일 뿐이고 실제 차단은 서버가 한다.
 */

export function InvestPermissionPanel() {
  const theme = colors.light;
  const { t } = useTranslation();

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<AdminUserSearchResult[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSearch() {
    const term = search.trim();
    if (term.length < 2) return;
    setSearching(true);
    const found = await adminSearchUsers(term);
    setResults(found);
    setSearched(true);
    setSearching(false);
  }

  async function handleToggle(user: AdminUserSearchResult) {
    setBusyId(user.user_id);
    const next = !user.investment_manage;
    const ok = await adminSetUserPermission(user.user_id, "investment_manage", next);
    setBusyId(null);
    if (!ok) return;
    // 서버가 받아들였을 때만 화면 값을 바꾼다 — 먼저 바꿔 두면 실패했을 때
    // 권한이 켜진 것처럼 보인다.
    setResults((prev) =>
      prev.map((item) =>
        item.user_id === user.user_id ? { ...item, investment_manage: next } : item,
      ),
    );
  }

  return (
    <View style={styles.container}>
      <SectionHeader title={t("investRegister.permissionSection")} />

      <View style={[styles.searchBar, { borderColor: theme.border }]}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t("investRegister.permissionSearchPlaceholder")}
          placeholderTextColor={theme.secondaryText}
          style={[textStyles.body, styles.searchInput, { color: theme.text }]}
        />
        <Pressable
          onPress={handleSearch}
          accessibilityRole="button"
          accessibilityLabel={t("investRegister.permissionSearch")}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? opacity.pressed : 1 }]}
        >
          <Ionicons name="search" size={18} color={theme.secondaryText} />
        </Pressable>
      </View>

      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
        {t("investRegister.permissionHelper")}
      </Text>

      {searching ? <Loading /> : null}

      {!searching && searched && results.length === 0 ? (
        <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
          {t("investRegister.permissionNoResults")}
        </Text>
      ) : null}

      {!searching
        ? results.map((user) => (
            <View key={user.user_id} style={[styles.userRow, { borderColor: theme.border }]}>
              <View style={styles.userTexts}>
                <Text
                  style={[textStyles.body, { color: theme.text, fontWeight: typography.weight.medium }]}
                  numberOfLines={1}
                >
                  {user.email || user.display_name || user.user_id}
                </Text>
                {user.is_admin ? (
                  <Text style={[textStyles.caption, { color: theme.accent }]}>
                    {t("investRegister.permissionAdminBadge")}
                  </Text>
                ) : null}
              </View>

              <Pressable
                onPress={() => handleToggle(user)}
                disabled={busyId === user.user_id}
                accessibilityRole="switch"
                accessibilityState={{ checked: user.investment_manage }}
                style={({ pressed }) => [
                  styles.toggle,
                  {
                    borderColor: user.investment_manage ? theme.accent : theme.border,
                    backgroundColor: user.investment_manage ? theme.accent : "transparent",
                    opacity: pressed ? opacity.pressed : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    textStyles.caption,
                    {
                      color: user.investment_manage ? theme.onAccent : theme.secondaryText,
                      fontWeight: typography.weight.medium,
                    },
                  ]}
                >
                  {t(
                    user.investment_manage
                      ? "investRegister.permissionOn"
                      : "investRegister.permissionOff",
                  )}
                </Text>
              </Pressable>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  userTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  toggle: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
});
