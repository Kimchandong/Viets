import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Image, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { colors, radius, spacing, textStyles, typography } from "@/constants/theme";
import { GOOGLE_ICON_URI } from "@/constants/icons";
import { mapAuthErrorToMessageKey, signInWithApple, signInWithGoogle } from "@/services/auth";

export type LoginPromptModalProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * 팝업 본문 문구(선택). 화면마다 문맥에 맞는 안내를 전달할 수 있다 — 전달하지
   * 않으면 공통 문구(common.loginPromptBody)를 쓴다.
   */
  description?: string;
};

/**
 * [STEP: 2026-09-09] 사용자 요청 — 부동산상세 "문의하기" / 투자상세 "투자 신청"처럼
 * 로그인이 필요한 동작을 비로그인 상태에서 눌렀을 때, 전체 화면 전환(/login으로
 * router.push) 대신 팝업(Modal)으로 Google/Apple 로그인을 바로 띄운다(다국어 지원 —
 * 기존 i18n 텍스트 키를 그대로 재사용해 새 언어별 분기 없이 5→6개 언어 모두 대응).
 *
 * [STEP: 2026-09-09-3] 사용자 요청 — 로그인 성공 후 이동 경로 수정: "로그인을
 * 요청한 페이지에서 로그인하면 로그인 요청한 페이지로 다시 돌아와야 함". 이 팝업은
 * 애초에 현재 화면(문의하기를 누른 부동산상세, 투자 신청을 누른 투자상세 등) 위에
 * 뜨는 오버레이라, 로그인 성공 시 그냥 팝업만 닫으면 사용자는 이미 그 페이지에
 * 그대로 남아있다 — 이전처럼 MY 탭으로 강제 이동시키지 않는다(그 동작은 이제
 * onClose()만으로 충분하다).
 *
 * app/(tabs)/my.tsx의 handleSocialLogin/버튼 마크업과 동일한 스타일(흰 배경, Google
 * 4색 아이콘, Apple 흑색 심볼)을 그대로 재사용한다 — GOOGLE_ICON_URI는
 * constants/icons.ts로 공용 추출한 것을 함께 쓴다(두 화면에서 아이콘 값이 갈라지지
 * 않도록 단일 소스 유지).
 */
export function LoginPromptModal({ visible, onClose, description }: LoginPromptModalProps) {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();

  const [loadingProvider, setLoadingProvider] = useState<"google" | "apple" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSocialLogin(provider: "google" | "apple") {
    if (loadingProvider) {
      return;
    }
    setErrorMessage(null);
    setLoadingProvider(provider);
    const signIn = provider === "google" ? signInWithGoogle : signInWithApple;
    const result = await signIn();
    setLoadingProvider(null);

    if (result.error) {
      setErrorMessage(t(mapAuthErrorToMessageKey(result.error)));
      return;
    }
    if (result.session) {
      // [STEP: 2026-09-09-3] 로그인 요청 페이지에 그대로 남는다 — 별도 navigation 없음.
      onClose();
    }
    // result.session도 error도 없는 경우 = 사용자가 브라우저 세션을 취소함 —
    // services/auth.ts와 동일한 원칙으로 에러 취급하지 않고 팝업을 그대로 유지한다.
  }

  function handleClose() {
    setErrorMessage(null);
    onClose();
  }

  return (
    <Modal visible={visible} onClose={handleClose} accessibilityLabel={t("common.cancel")}>
      <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.xs }]}>
        {t("common.loginRequired")}
      </Text>
      <Text style={[textStyles.bodySmall, { color: theme.secondaryText, marginBottom: spacing.lg }]}>
        {description ?? t("common.loginPromptBody")}
      </Text>
      <View style={styles.authButtons}>
        <Button
          size="small"
          onPress={() => handleSocialLogin("google")}
          loading={loadingProvider === "google"}
          disabled={!!loadingProvider}
          style={[styles.authButton, { borderColor: theme.border }]}
        >
          <Image source={{ uri: GOOGLE_ICON_URI }} style={styles.googleIcon} />
          <Text style={[textStyles.buttonLabel, styles.authButtonLabel, { color: theme.text }]}>
            {t("auth.login.submit")}
          </Text>
        </Button>
        <Button
          size="small"
          variant="outline"
          onPress={() => handleSocialLogin("apple")}
          loading={loadingProvider === "apple"}
          disabled={!!loadingProvider}
          style={[styles.authButton, { borderColor: theme.border }]}
        >
          <Ionicons name="logo-apple" size={24} color={theme.text} style={styles.appleIcon} />
          <Text style={[textStyles.buttonLabel, styles.authButtonLabel, { color: theme.text }]}>
            {t("auth.login.submit")}
          </Text>
        </Button>
      </View>
      {errorMessage ? (
        <Text style={[textStyles.caption, styles.errorText, { color: "#B6010C" }]}>{errorMessage}</Text>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  authButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  authButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderRadius: radius.full,
  },
  authButtonLabel: {
    fontSize: typography.size.sm,
  },
  googleIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
  },
  appleIcon: {
    marginRight: 2,
  },
  errorText: {
    marginTop: spacing.sm,
  },
});
