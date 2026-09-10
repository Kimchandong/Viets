import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Header } from "@/components/Header";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles } from "@/constants/theme";
import { GOOGLE_ICON_URI } from "@/constants/icons";
import { mapAuthErrorToMessageKey, signInWithApple, signInWithGoogle } from "@/services/auth";

// STEP 4-9 범위: email/password 로그인만 구현했었다(이후 STEP 4-12에서 최종
// 로그인 방식이 확정되며 제거됨).
//
// STEP 4-12 — 최종 서비스 로그인 방식을 Google/Apple 소셜 로그인으로 확정했다(§3).
// 이메일/비밀번호 입력 UI(Input×2, 회원가입 이동 Link)를 모두 제거하고 소셜 로그인
// 중심의 단순한 모바일 UI로 교체했다(§4).
//
// STEP 4-13 — 실제 Supabase OAuth 연동. handleSocialLogin은 더 이상 안내 Toast만
// 띄우지 않고 services/auth.ts의 signInWithGoogle/signInWithApple을 호출한다.
// 성공 시 이 화면은 어떤 네비게이션도 직접 수행하지 않는다 — session이 만들어지면
// app/_layout.tsx의 기존 Auth Guard(useAuthGuard)가 session && inAuthScreens 조건에
// 따라 자동으로 /home으로 돌려보낸다(STEP 4-10 구조 재사용, 새 리스너/네비게이션
// 로직을 추가하지 않는다). 실패(또는 provider 미설정) 시에는 기존 Toast +
// auth.errors.* i18n key를 그대로 재사용해 에러를 보여준다. 사용자가 브라우저
// 세션을 취소한 경우(error === null)에는 아무 것도 표시하지 않는다.
//
// 이 화면은 더 이상 앱 시작 화면이 아니다(app/_layout.tsx의 Auth Guard가 항상
// "/"→"/home"으로 보낸다, STEP 4-12 §1). 회원 전용 기능을 이용하려는 비로그인
// 사용자가 접근했을 때만 표시되는 화면이다.

export default function LoginScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<"google" | "apple" | null>(null);

  async function handleSocialLogin(provider: "google" | "apple") {
    if (loadingProvider) {
      return;
    }
    setLoadingProvider(provider);
    const signIn = provider === "google" ? signInWithGoogle : signInWithApple;
    const result = await signIn();
    setLoadingProvider(null);

    if (result.error) {
      setToast(t(mapAuthErrorToMessageKey(result.error)));
      setTimeout(() => setToast(null), 1600);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header
        title={t("auth.login.title")}
        leftAction={
          router.canGoBack() ? (
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t("common.cancel")}
              style={({ pressed }) => ({ opacity: pressed ? opacity.pressed : 1 })}
            >
              <Ionicons name="chevron-back" size={22} color={theme.text} />
            </Pressable>
          ) : null
        }
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={[styles.brandIcon, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="business" size={22} color={theme.accent} />
          </View>
          <Text style={[textStyles.screenTitle, { color: theme.accent }]}>Viet&apos;s</Text>
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>{t("auth.tagline")}</Text>
        </View>

        <View style={styles.socialButtons}>
          {/* [STEP: 2026-09-09-6] 사용자 요청 — 구글 컬러아이콘 적용. my.tsx/
              LoginPromptModal.tsx와 동일하게 흰 배경 + 옅은 테두리 버튼 위에
              Google 브랜드 4색 아이콘(GOOGLE_ICON_URI)을 쓴다(Ionicons의
              "logo-google"은 단색 글리프라 브랜드 컬러를 표현할 수 없다). */}
          <Button
            onPress={() => handleSocialLogin("google")}
            loading={loadingProvider === "google"}
            disabled={!!loadingProvider}
            style={[styles.socialButton, styles.googleButton, { borderColor: theme.border }]}
          >
            <Image source={{ uri: GOOGLE_ICON_URI }} style={styles.googleIcon} />
            <Text style={[textStyles.buttonLabel, { color: theme.text }]}>{t("auth.login.google")}</Text>
          </Button>
          <Button
            variant="outline"
            onPress={() => handleSocialLogin("apple")}
            loading={loadingProvider === "apple"}
            disabled={!!loadingProvider}
            style={styles.socialButton}
          >
            <Ionicons name="logo-apple" size={18} color={theme.accent} style={styles.socialIcon} />
            <Text style={[textStyles.buttonLabel, { color: theme.accent }]}>{t("auth.login.apple")}</Text>
          </Button>
        </View>

        <Text style={[textStyles.caption, { color: theme.secondaryText, textAlign: "center" }]}>
          {t("auth.login.termsNotice")}
        </Text>
      </ScrollView>
      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.xl,
  },
  brand: {
    alignItems: "center",
    gap: spacing.xs,
  },
  brandIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  socialButtons: {
    gap: spacing.sm,
  },
  socialButton: {
    width: "100%",
  },
  // [STEP: 2026-09-09-6] 사용자 요청 — 구글 버튼을 흰 배경 + 테두리로 (Google 브랜드
  // 가이드라인 표준 스타일, my.tsx/LoginPromptModal.tsx와 동일).
  googleButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
  },
  socialIcon: {
    marginRight: spacing.sm,
  },
  googleIcon: {
    width: 18,
    height: 18,
    marginRight: spacing.sm,
  },
});
