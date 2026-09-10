import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { colors, radius, spacing, textStyles, typography } from "@/constants/theme";
import { mapAuthErrorToMessageKey, signUpWithPassword } from "@/services/auth";

// STEP 4-9 범위: email/password 회원가입만 구현한다. profiles/user_roles row는
// 기존 DB trigger가 생성하므로 이 화면에서 직접 INSERT하지 않는다.
// STEP 4-9B: 화면 내 타이포그래피를 textStyles(공통 계층)로 맞추고, Login 화면과
// 동일한 브랜드 로크업을 추가해 전체 앱과 시각적으로 통일했다.
//
// STEP 4-12: 최종 로그인 방식이 Google/Apple 소셜 로그인으로 확정되면서(§3) 별도의
// 이메일 회원가입 화면은 더 이상 필요하지 않다(§5) — app/login.tsx와 app/(tabs)/my.tsx
// 어디에서도 이 화면으로 연결하지 않도록 변경했다. 다만 이 화면을 삭제하면 해당 라우트
// 참조/영향을 완전히 확인하기 전에는 임의로 지우지 않는다는 원칙(§5, §15 파일 안전)에
// 따라, 그리고 이 세션에는 Desktop 파일을 삭제할 수단(shell) 자체가 없어 실제로 삭제할
// 수도 없으므로, 화면 내용은 그대로 두고 "검은색 배경 금지" 요구사항에 맞춰 테마만
// light로 고정했다 — 더 이상 UI에서 연결되지 않는 화면(orphan route)이며, 최종 결과
// 보고서에 그대로 명시한다.
export default function RegisterScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password || !confirmPassword) {
      setErrorKey("auth.errors.missingFields");
      return;
    }
    if (password !== confirmPassword) {
      setErrorKey("auth.errors.passwordMismatch");
      return;
    }

    setErrorKey(null);
    setLoading(true);
    const result = await signUpWithPassword(email.trim(), password);
    setLoading(false);

    if (result.error) {
      setErrorKey(mapAuthErrorToMessageKey(result.error));
      return;
    }

    if (result.session) {
      // 이메일 확인이 꺼져 있는 프로젝트 설정이면 가입과 동시에 로그인된다.
      router.replace("/home");
      return;
    }

    setNeedsEmailConfirmation(true);
    setRegistered(true);
  }

  if (registered) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Header title={t("auth.register.title")} />
        <View style={styles.successContent}>
          <Text style={[textStyles.screenTitle, { color: theme.text, textAlign: "center" }]}>
            {t("auth.register.successTitle")}
          </Text>
          <Text style={[textStyles.body, { color: theme.secondaryText, textAlign: "center" }]}>
            {needsEmailConfirmation
              ? t("auth.register.checkEmail")
              : t("auth.register.successGeneric")}
          </Text>
          <Button
            title={t("auth.register.goToLogin")}
            onPress={() => router.replace("/login")}
            style={styles.submit}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Header title={t("auth.register.title")} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={[styles.brandIcon, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="business" size={22} color={theme.accent} />
            </View>
            <Text style={[textStyles.screenTitle, { color: theme.accent }]}>Viet&apos;s</Text>
            <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
              {t("auth.tagline")}
            </Text>
          </View>
          <Card style={styles.card}>
            <Input
              label={t("auth.fields.email")}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              editable={!loading}
            />
            <Input
              label={t("auth.fields.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password-new"
              editable={!loading}
            />
            <Input
              label={t("auth.fields.confirmPassword")}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password-new"
              editable={!loading}
            />
            {errorKey ? (
              <Text style={[textStyles.bodySmall, { color: theme.danger }]}>{t(errorKey)}</Text>
            ) : null}
            <Button
              title={t("auth.register.submit")}
              onPress={handleSubmit}
              loading={loading}
              disabled={loading}
              style={styles.submit}
            />
          </Card>
          <Link href="/login">
            <Text
              style={[
                textStyles.bodySmall,
                { color: theme.accent, fontWeight: typography.weight.semibold, textAlign: "center" },
              ]}
            >
              {t("auth.register.loginPrompt")}
            </Text>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  brand: {
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.sm,
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
  card: {
    gap: spacing.md,
  },
  submit: {
    marginTop: spacing.xs,
  },
  successContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
});
