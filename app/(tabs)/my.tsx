import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { InvestmentCard } from "@/components/InvestmentCard";
import { Modal } from "@/components/Modal";
import { PropertyCard } from "@/components/PropertyCard";
import { SectionHeader } from "@/components/SectionHeader";
import { StatTile } from "@/components/StatTile";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, ThemeColors, typography } from "@/constants/theme";
import { GOOGLE_ICON_URI } from "@/constants/icons";
import {
  findMockInvestmentProduct,
  findMockProperty,
  type MockInvestmentProduct,
  type MockProperty,
} from "@/constants/mockData";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "@/i18n";
import {
  getSession,
  mapAuthErrorToMessageKey,
  onAuthStateChange,
  signInWithApple,
  signInWithGoogle,
} from "@/services/auth";
import { useFavoritesStore } from "@/store/useFavoritesStore";
import { useLocaleStore } from "@/store/useLocaleStore";
// [STEP: 2026-09-09] 사용자 요청 — MY > 통화 설정에서 베트남/달러를 실제로 선택할 수
// 있게 한다. useLocaleStore(언어)와 동일한 패턴의 새 store.
import { SUPPORTED_CURRENCIES, useCurrencyStore } from "@/store/useCurrencyStore";

// STEP 4-9B — My(계정) UI 레이아웃 기반.
// 로그인 상태는 STEP 4-8에서 만든 services/auth.ts의 getSession/onAuthStateChange를
// 이 화면에서 "직접" 호출해 로컬 state로만 보관한다 — 새 Context/useAuth hook/전역
// store는 만들지 않는다(요구사항 준수, app/_layout.tsx의 세션 wiring과 동일한 패턴).
// 언어 변경만 기존 store/useLocaleStore.ts를 그대로 재사용해 실제로 동작한다 —
// 그 외(알림/통화/고객지원)는 백엔드가 없으므로 자리표시(Toast)로만 반응한다.
//
// STEP 4-12: 최종 로그인 방식을 Google/Apple 소셜 로그인으로 확정 —
// 비로그인 상태의 CTA를 기존 이메일 로그인/회원가입 버튼에서 Google/Apple 버튼으로
// 교체한다(app/login.tsx와 동일한 두 버튼).
//
// STEP 4-13 — 실제 Supabase OAuth 연동. handleSocialLogin은 app/login.tsx와 동일하게
// services/auth.ts의 signInWithGoogle/signInWithApple을 호출한다. 이 화면은 로그인
// 화면이 아니라 (tabs) 그룹의 일반 화면이므로 app/_layout.tsx의 Auth Guard는 여기서
// 아무 네비게이션도 하지 않는다(Guard는 /login·/register에서만 세션 유무로 리다이렉트,
// STEP 4-12 §1) — 로그인 성공 후에도 이 화면에 그대로 머무르며, 이미 이 화면이 갖고
// 있던 로컬 getSession/onAuthStateChange 구독(위 useEffect, STEP 4-9B부터 존재)이
// 새 세션을 받아 isLoggedIn을 true로 갱신해 화면이 자동으로 로그인 상태 UI로
// 전환된다 — 이 STEP에서 새 auth 리스너를 추가하지 않았다.
//
// [FULL-DEV] "관심 매물"/"관심 투자상품" 섹션을 추가했다 — store/useFavoritesStore.ts
// (메모리 상태)에서 property/investment_product 즐겨찾기 id를 읽어 constants/mockData.ts의
// findMockProperty/findMockInvestmentProduct로 실제 항목을 조회한다. 즐겨찾기 자체는
// app/property-detail·app/invest-detail의 하트 버튼에서 로그인 상태일 때만 추가된다
// (§8 Auth/User State 통합 원칙). 그 외 기존 섹션(프로필/활동/설정/언어 모달)은 전혀
// 바꾸지 않았다(기존 기능 보존 원칙).

// [STEP: 2026-09-09] 사용자 요청 — GOOGLE_ICON_URI를 constants/icons.ts로 공용 추출했다
// (components/LoginPromptModal.tsx도 동일 아이콘을 쓴다). 값/배경은 그대로, 위치만 옮김.
const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  vi: "Tiếng Việt",
  ko: "한국어",
  en: "English",
  zh: "中文",
  ja: "日本語",
  // [STEP: 2026-09-09] 사용자 요청 — 태국어 추가(다른 항목과 동일하게 해당 언어
  // 자체의 표기로 표시).
  th: "ภาษาไทย",
};

export default function MyScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지)
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLocaleStore((state) => state.language);
  const setLanguage = useLocaleStore((state) => state.setLanguage);
  const favorites = useFavoritesStore((state) => state.favorites);
  // [STEP: 2026-09-09] 사용자 요청 — 통화(베트남/달러) 선택
  const currency = useCurrencyStore((state) => state.currency);
  const setCurrency = useCurrencyStore((state) => state.setCurrency);

  const [session, setSession] = useState<Session | null>(null);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<"google" | "apple" | null>(null);

  useEffect(() => {
    let mounted = true;

    getSession().then((initialSession) => {
      if (mounted) {
        setSession(initialSession);
      }
    });

    const { unsubscribe } = onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setSession(nextSession);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const favoriteProperties = useMemo(() => {
    const prefix = "property:";
    return Object.keys(favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => findMockProperty(key.slice(prefix.length)))
      .filter((property): property is MockProperty => !!property);
  }, [favorites]);

  const favoriteInvestments = useMemo(() => {
    const prefix = "investment_product:";
    return Object.keys(favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => findMockInvestmentProduct(key.slice(prefix.length)))
      .filter((product): product is MockInvestmentProduct => !!product);
  }, [favorites]);

  function showComingSoon() {
    setToast(t("common.comingSoon"));
    setTimeout(() => setToast(null), 1600);
  }

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

  const isLoggedIn = !!session;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("my.title")} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.profileCard}>
          {isLoggedIn ? (
            <>
              {/* 사용자이미지(avatar) 영역은 로그인 상태에서만 표시한다 — 비로그인
                  상태는 아래에서 별도 렌더링(사용자 요청: 좌측 사용자이미지 영역 삭제) */}
              <View style={[styles.avatar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <Ionicons name="person-outline" size={28} color={theme.secondaryText} />
              </View>
              <View style={styles.profileText}>
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                  {t("my.signedInLabel")}
                </Text>
                <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                  {session?.user.email ?? "—"}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.profileText}>
              <Text style={[textStyles.cardTitle, { color: theme.text }]}>{t("my.guestTitle")}</Text>
              <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
                {t("my.guestDescription")}
              </Text>
              {/* 사용자 요청: Google/Apple 아이콘 추가, 버튼 문구는 "~로 계속하기" 대신
                  기존 auth.login.submit 키("로그인", 다국어 대응 완료)를 재사용한다 —
                  제공자 구분은 아이콘으로, 텍스트는 공통 "로그인" 동작을 나타낸다. */}
              {/* 사용자 요청: 아이콘 크기 50% 확대(기존 16 → 24) — Google은 브랜드
                  컬러 아이콘(GOOGLE_ICON_URI), Apple은 공식 컬러 로고가 없어
                  기존 단색 심볼(Ionicons)을 그대로 유지하고 크기만 키웠다. */}
              {/* [STEP: 2026-09-09] 사용자 요청 — 두 버튼 모두 배경 흰색 + 옅은 테두리로
                  통일하고, 아이콘은 "컬러"로 보이게 한다: Google은 이미 브랜드 4색
                  아이콘(GOOGLE_ICON_URI)이라 그대로 두고, Apple은 기존 앱 accent(남색)
                  대신 Apple 고유의 검정 심볼 색으로 바꾼다(흰 배경 위 공식 Apple 버튼
                  스타일과 동일). 버튼 글자("로그인")도 기존보다 한 단계 작게(15→13px). */}
              <View style={styles.authButtons}>
                <Button
                  size="small"
                  onPress={() => handleSocialLogin("google")}
                  loading={loadingProvider === "google"}
                  disabled={!!loadingProvider}
                  style={[styles.authButton, styles.socialButton, { borderColor: theme.border }]}
                >
                  <Image source={{ uri: GOOGLE_ICON_URI }} style={styles.googleIcon} />
                  <Text style={[textStyles.buttonLabel, styles.socialButtonLabel, { color: theme.text }]}>
                    {t("auth.login.submit")}
                  </Text>
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onPress={() => handleSocialLogin("apple")}
                  loading={loadingProvider === "apple"}
                  disabled={!!loadingProvider}
                  style={[styles.authButton, styles.socialButton, { borderColor: theme.border }]}
                >
                  <Ionicons name="logo-apple" size={24} color={theme.text} style={styles.authIcon} />
                  <Text style={[textStyles.buttonLabel, styles.socialButtonLabel, { color: theme.text }]}>
                    {t("auth.login.submit")}
                  </Text>
                </Button>
              </View>
            </View>
          )}
        </Card>

        <View style={styles.section}>
          <SectionHeader title={t("my.activityTitle")} />
          {/* [STEP: 2026-09-09] 사용자 요청 — "나의 활동" 숫자만 20px로. StatTile은
              invest.tsx 투자개요와 공유하는 컴포넌트라 valueStyle로 이 화면에서만
              오버라이드한다(라벨 크기는 그대로 유지 — 숫자만 지정됨). */}
          <Card style={styles.statsCard}>
            <StatTile
              label={t("my.stats.reservations")}
              value="0"
              onPress={showComingSoon}
              valueStyle={styles.activityValue}
            />
            <StatTile
              label={t("my.stats.investments")}
              value={String(favoriteInvestments.length)}
              onPress={() => router.push("/invest")}
              valueStyle={styles.activityValue}
            />
            <StatTile
              label={t("my.stats.propertyActivity")}
              value={String(favoriteProperties.length)}
              onPress={() => router.push("/property")}
              valueStyle={styles.activityValue}
            />
          </Card>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("my.favoritesTitle")} />
          <View style={styles.favoritesStack}>
            <View style={styles.favoritesBlock}>
              <Text style={[textStyles.bodySmall, { color: theme.secondaryText, fontWeight: "600" }]}>
                {t("my.favoritePropertiesTitle")}
              </Text>
              {favoriteProperties.length === 0 ? (
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                  {t("my.noFavoriteProperties")}
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.favoritesRow}>
                  {favoriteProperties.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={property}
                      variant="featured"
                      onPress={() => router.push(`/property-detail/${property.id}`)}
                    />
                  ))}
                </ScrollView>
              )}
            </View>

            <View style={styles.favoritesBlock}>
              <Text style={[textStyles.bodySmall, { color: theme.secondaryText, fontWeight: "600" }]}>
                {t("my.favoriteInvestmentsTitle")}
              </Text>
              {favoriteInvestments.length === 0 ? (
                <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                  {t("my.noFavoriteInvestments")}
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.favoritesRow}>
                  {favoriteInvestments.map((product) => (
                    <InvestmentCard
                      key={product.id}
                      product={product}
                      variant="featured"
                      onPress={() => router.push(`/invest-detail/${product.id}`)}
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </View>

        <View style={[styles.section, styles.lastSection]}>
          <SectionHeader title={t("my.settingsTitle")} />
          <Card style={styles.rowsCard}>
            <SettingsRow
              icon="notifications-outline"
              label={t("my.rows.notifications")}
              onPress={showComingSoon}
              theme={theme}
            />
            <SettingsRow
              icon="language-outline"
              label={t("my.rows.language")}
              valueLabel={LANGUAGE_LABELS[language]}
              onPress={() => setLanguageModalVisible(true)}
              theme={theme}
            />
            {/* [STEP: 2026-09-09] 사용자 요청 — 통화를 베트남/달러 중 실제로 선택
                가능하게 한다(기존 "준비 중" 토스트 대신 언어 선택과 동일한 패턴의
                Modal). */}
            <SettingsRow
              icon="cash-outline"
              label={t("my.rows.currency")}
              valueLabel={currency}
              onPress={() => setCurrencyModalVisible(true)}
              theme={theme}
            />
            <SettingsRow
              icon="help-buoy-outline"
              label={t("my.rows.support")}
              onPress={showComingSoon}
              theme={theme}
              last
            />
          </Card>
        </View>
      </ScrollView>

      <Modal
        visible={languageModalVisible}
        onClose={() => setLanguageModalVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("my.languageModalTitle")}
        </Text>
        {SUPPORTED_LANGUAGES.map((code) => (
          <Pressable
            key={code}
            onPress={() => {
              setLanguage(code);
              setLanguageModalVisible(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.languageOption,
              { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text style={[textStyles.body, { color: theme.text }]}>{LANGUAGE_LABELS[code]}</Text>
            {code === language ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
          </Pressable>
        ))}
      </Modal>

      {/* [STEP: 2026-09-09] 사용자 요청 — 통화 선택 Modal(베트남 동/달러), 위 언어
          선택 Modal과 동일한 패턴. */}
      <Modal
        visible={currencyModalVisible}
        onClose={() => setCurrencyModalVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("my.currencyModalTitle")}
        </Text>
        {SUPPORTED_CURRENCIES.map((code) => (
          <Pressable
            key={code}
            onPress={() => {
              setCurrency(code);
              setCurrencyModalVisible(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.languageOption,
              { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text style={[textStyles.body, { color: theme.text }]}>
              {t(`my.currency.${code.toLowerCase()}`)}
            </Text>
            {code === currency ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : null}
          </Pressable>
        ))}
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

type SettingsRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  valueLabel?: string;
  onPress: () => void;
  theme: ThemeColors;
  last?: boolean;
};

function SettingsRow({ icon, label, valueLabel, onPress, theme, last }: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        { opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.secondaryText} style={styles.rowIcon} />
      <Text style={[textStyles.body, { color: theme.text, flex: 1 }]}>{label}</Text>
      {valueLabel ? (
        <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>{valueLabel}</Text>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={theme.secondaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // [STEP: 2026-09-09-7] 사용자 재확인 — home/property/invest 3개 탭 화면과
  // 동일한 영역 간 간격(md=16)으로 통일해, 5개 탭 화면이 모두 같은 기준으로
  // "영역과 영역 사이"가 구분되도록 한다(영역 내부 간격은 sm=8로 공통).
  content: {
    // 사용자 요청: 화면 좌우 여백을 10px로 변경(세로 여백/gap은 기존 유지)
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  authButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  authButton: {
    flex: 1,
  },
  authIcon: {
    marginRight: spacing.xs,
  },
  // 사용자 요청: 아이콘 크기 50% 확대(16 → 24) — Image는 Ionicons와 달리 명시적
  // width/height가 필요하다.
  googleIcon: {
    width: 24,
    height: 24,
    marginRight: spacing.xs,
  },
  // [STEP: 2026-09-09] 사용자 요청 — 구글/애플 로그인 버튼 배경을 흰색 + 옅은
  // 테두리로 통일
  socialButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
  },
  // [STEP: 2026-09-09] 사용자 요청 — 버튼 글자("로그인") 조금 작게(15→13px)
  socialButtonLabel: {
    fontSize: typography.size.sm,
  },
  section: {
    gap: spacing.sm,
  },
  lastSection: {
    marginBottom: spacing.lg,
  },
  statsCard: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  // [STEP: 2026-09-09] 사용자 요청 — "나의 활동" 숫자 20px
  activityValue: {
    fontSize: typography.size.xl,
  },
  favoritesStack: {
    gap: spacing.md,
  },
  favoritesBlock: {
    gap: spacing.xs,
  },
  favoritesRow: {
    gap: spacing.md,
    paddingRight: spacing.md,
    paddingTop: spacing.xs,
  },
  rowsCard: {
    padding: 0,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  rowIcon: {
    width: 22,
  },
  languageOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
