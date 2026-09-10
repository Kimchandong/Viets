import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Header } from "@/components/Header";
import { Loading } from "@/components/Loading";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import {
  adminSearchUsers,
  adminSetUserPermission,
  isAdmin,
  type AdminUserSearchResult,
  type UserPermissionType,
} from "@/services/roles";

/**
 * [STEP 05d] 계정별 기능 권한 관리 화면 (admin 전용).
 *
 * 사용자 요구사항(2026-09-10): "권한부여 대상은 직원/운영자/특정 투자자 등 관리자가
 * 지정해 주는 계정" — 지금까지는 SQL로만 부여할 수 있었다.
 *
 * 계정 검색은 DB의 SECURITY DEFINER 함수를 통해서만 가능하다(auth.users는 클라이언트에
 * 노출되지 않는다). 검색어 2자 이상 조건과 관리자 검사 모두 서버가 수행한다.
 */

const MANAGED_PERMISSIONS: UserPermissionType[] = ["investment_manage", "property_manage"];

export default function AdminPermissionsScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [checkingPermission, setCheckingPermission] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<AdminUserSearchResult[]>([]);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  async function handleSearch() {
    const term = search.trim();
    if (term.length < 2) {
      showToast(t("adminPermissions.searchTooShort"));
      return;
    }
    setSearching(true);
    const found = await adminSearchUsers(term);
    setResults(found);
    setSearched(true);
    setSearching(false);
  }

  async function handleToggle(user: AdminUserSearchResult, permission: UserPermissionType) {
    const key = `${user.user_id}:${permission}`;
    const nextEnabled = !user[permission];

    setUpdatingKey(key);
    const ok = await adminSetUserPermission(user.user_id, permission, nextEnabled);
    setUpdatingKey(null);

    if (!ok) {
      showToast(t("adminPermissions.updateFailed"));
      return;
    }
    // 서버 왕복을 한 번 더 돌지 않고 이 행만 갱신한다.
    setResults((prev) =>
      prev.map((item) =>
        item.user_id === user.user_id ? { ...item, [permission]: nextEnabled } : item,
      ),
    );
    showToast(nextEnabled ? t("adminPermissions.granted") : t("adminPermissions.revoked"));
  }

  if (checkingPermission) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("adminPermissions.title")} leftAction={<BackButton onPress={() => router.back()} />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("adminPermissions.title")} leftAction={<BackButton onPress={() => router.back()} />} />
        <EmptyState
          title={t("adminPermissions.noPermissionTitle")}
          description={t("adminPermissions.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("adminPermissions.title")} leftAction={<BackButton onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.searchBar, { borderColor: theme.border }]}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t("adminPermissions.searchPlaceholder")}
            placeholderTextColor={theme.secondaryText}
            style={[textStyles.body, styles.searchInput, { color: theme.text }]}
          />
          <Pressable
            onPress={handleSearch}
            accessibilityRole="button"
            accessibilityLabel={t("adminPermissions.search")}
            hitSlop={8}
            style={({ pressed }) => [styles.searchButton, { opacity: pressed ? opacity.pressed : 1 }]}
          >
            <Ionicons name="search" size={18} color={theme.secondaryText} />
          </Pressable>
        </View>
        <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
          {t("adminPermissions.searchHelper")}
        </Text>

        {searching ? <Loading /> : null}

        {!searching && searched && results.length === 0 ? (
          <EmptyState
            title={t("adminPermissions.noResultsTitle")}
            description={t("adminPermissions.noResultsDescription")}
          />
        ) : null}

        {!searching
          ? results.map((user) => (
              <View key={user.user_id} style={[styles.userCard, { borderColor: theme.border }]}>
                <View style={styles.userHeader}>
                  <View style={styles.userTexts}>
                    <Text style={[textStyles.body, { color: theme.text, fontWeight: typography.weight.medium }]}>
                      {user.display_name || user.email || user.user_id}
                    </Text>
                    {user.email ? (
                      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>{user.email}</Text>
                    ) : null}
                  </View>
                  {user.is_admin ? (
                    <View style={[styles.adminBadge, { backgroundColor: theme.accent }]}>
                      <Text style={[textStyles.caption, { color: theme.onAccent }]}>
                        {t("adminPermissions.adminBadge")}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* 관리자 계정은 이미 모든 권한을 갖고 있어(RLS의 is_admin_or_above)
                    개별 권한 토글이 의미가 없다 — 혼동을 막기 위해 안내만 보여준다. */}
                {user.is_admin ? (
                  <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                    {t("adminPermissions.adminHasAll")}
                  </Text>
                ) : (
                  MANAGED_PERMISSIONS.map((permission) => {
                    const enabled = user[permission];
                    const key = `${user.user_id}:${permission}`;
                    return (
                      <Pressable
                        key={permission}
                        onPress={() => handleToggle(user, permission)}
                        disabled={updatingKey === key}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: enabled }}
                        style={({ pressed }) => [
                          styles.permissionRow,
                          { borderColor: theme.border, opacity: pressed || updatingKey === key ? opacity.pressed : 1 },
                        ]}
                      >
                        <View style={styles.userTexts}>
                          <Text style={[textStyles.body, { color: theme.text }]}>
                            {t(`adminPermissions.permission.${permission}`)}
                          </Text>
                          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                            {t(`adminPermissions.permissionDescription.${permission}`)}
                          </Text>
                        </View>
                        <Ionicons
                          name={enabled ? "toggle" : "toggle-outline"}
                          size={30}
                          color={enabled ? theme.accent : theme.secondaryText}
                        />
                      </Pressable>
                    );
                  })
                )}
              </View>
            ))
          : null}
      </ScrollView>
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
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  searchInput: {
    flex: 1,
    padding: 0,
  },
  searchButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  userCard: {
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  userTexts: {
    flex: 1,
    gap: 2,
  },
  adminBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  permissionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
  },
});
