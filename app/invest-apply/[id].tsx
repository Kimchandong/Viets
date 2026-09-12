import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import {
  Dimensions,
  Image,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { colors, opacity, radius, spacing, textStyles, typography, ThemeColors, scaleFont } from "@/constants/theme";
import { type MockInvestmentProduct } from "@/constants/mockData";
import { createInvestmentOrder, getInvestmentProductById } from "@/services/investments";
import { VIETNAM_BANKS } from "@/constants/vietnamBanks";
import { getSession, onAuthStateChange } from "@/services/auth";
import { formatVndAmount, splitYieldText } from "@/utils/format";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
// [STEP: 2026-09-09-8] 사용자 요청 — 신청 상품 요약 카드 안에 매물/투자 상세페이지와
// 동일한 이미지 슬라이드 갤러리를 넣는다. 카드 padding(spacing.md)만큼 좌우로
// 음수 마진을 줘 카드 폭에 꽉 차게 보이도록 한다(property-detail/invest-detail의
// 전체화면 갤러리와 달리 카드 내부에 들어가므로 폭 계산이 다르다).
const GALLERY_WIDTH = SCREEN_WIDTH - spacing.screenPaddingX * 2;

// [STEP: 2026-09-09] 사용자 요청 — invest-detail의 "투자 신청" 버튼을 눌렀을 때
// 뜨던 단순 확인 Modal(비고지 문구 + 확인 버튼) 대신, 실제 신청에 필요한 정보를
// 입력받는 전용 신청서 화면을 새로 만든다. DB(investment_orders 등)가 아직 없으므로
// 이 화면도 invest-detail과 동일한 원칙(§6: 실제 금융거래/결제는 구현하지 않는다)을
// 따른다 — 제출 시 실제로 서버에 저장되지 않으며, 상단/하단에 테스트 화면임을
// 명시한다. 다만 "항목별 입력/선택 항목이 잘 배치된" 실제 신청 폼 UI 자체는
// 갖춰서, 이후 investment_orders 테이블/제출 API가 생기면 이 화면의 각 입력
// state를 그대로 payload로 옮기기만 하면 되도록 필드를 구성했다.
//
// 로그인 필요: 실제 자금이 오가는(신청이라도) 화면이라 즐겨찾기(handleFavoritePress,
// invest-detail/[id].tsx)와 동일하게 비로그인 사용자는 이 화면 대신 로그인 유도
// 화면을 본다(전역 이동이 아니라 이 화면 진입 시점에만 개별적으로 확인 — §8 원칙).

type Errors = Partial<
  Record<
    | "amount"
    | "fullName"
    | "phone"
    | "email"
    | "bankName"
    | "accountNumber"
    | "accountHolder"
    | "agreements",
    string
  >
>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InvestApplyScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // [STEP 06] Mock → 실제 investment_products 테이블.
  const [product, setProduct] = useState<MockInvestmentProduct | undefined>(undefined);
  const [productLoading, setProductLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setProductLoading(true);
    if (!id) {
      setProduct(undefined);
      setProductLoading(false);
      return;
    }
    getInvestmentProductById(id).then((result) => {
      if (mounted) {
        setProduct(result);
        setProductLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [id]);

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // [STEP: 2026-09-09-6] 사용자 요청 — "투자신청 클릭 시 로그인이 안 되고 다시
  // 로그인창으로 돌아옴" 버그 수정 — invest-detail/property-detail과 동일한 원인
  // (로컬 session state가 마운트 시 1회 조회 후 갱신되지 않음)이라 동일하게
  // onAuthStateChange 구독을 추가한다.
  useEffect(() => {
    let mounted = true;

    getSession().then((initialSession) => {
      if (mounted) {
        setSession(initialSession);
        setSessionLoading(false);
      }
    });

    const { unsubscribe } = onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // 입력 항목 (필수: 신청 금액/성명/휴대폰번호/이메일/배당금 수령 계좌 3종/약관 2종,
  // 선택: 투자 목적·메모, 마케팅 수신 동의)
  const [amount, setAmount] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [memo, setMemo] = useState("");
  const [agreeRisk, setAgreeRisk] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);

  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  // [STEP 06] 실제 서버 저장 중 상태 — 제출 버튼 중복 탭 방지.
  const [submitting, setSubmitting] = useState(false);

  // [STEP: 2026-09-09-8] 사용자 요청 — 신청 상품 요약 카드 이미지 슬라이드 현재
  // 페이지, "투자신청 전 꼭 확인" 아코디언 펼침 상태, 배당금 수령 계좌 은행
  // 선택 모달 노출 상태.
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [disclaimerExpanded, setDisclaimerExpanded] = useState(false);
  const [bankModalVisible, setBankModalVisible] = useState(false);

  function handleGalleryScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(event.nativeEvent.contentOffset.x / GALLERY_WIDTH);
    setGalleryIndex(index);
  }

  // 로그인 상태가 뒤늦게 확인되는 경우(비동기)에도 이메일 입력값을 한 번 채워준다 —
  // 사용자가 이미 다른 값을 입력한 뒤라면 덮어쓰지 않는다.
  useEffect(() => {
    if (session?.user.email && !email) {
      setEmail(session.user.email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (sessionLoading || productLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("investApply.headerTitle")} leftAction={<BackButton fallback="/invest" />} />
        <Loading fullscreen />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("investApply.headerTitle")} leftAction={<BackButton fallback="/invest" />} />
        <EmptyState
          title={t("common.loginRequired")}
          description={t("investApply.loginRequiredDescription")}
          action={<Button title={t("auth.login.title")} onPress={() => router.push("/login")} />}
        />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("common.notFoundTitle")} leftAction={<BackButton fallback="/invest" />} />
        <EmptyState title={t("common.notFoundTitle")} description={t("common.notFoundDescription")} />
      </SafeAreaView>
    );
  }

  const minAmountVnd = product.minInvestmentValueVnd;
  const amountNumber = Number(amount || "0");
  const expectedReturnParts = splitYieldText(product.expectedReturn);

  const presetAmounts = [minAmountVnd, minAmountVnd * 2, minAmountVnd * 5];

  function handleAmountChange(text: string) {
    setAmount(text.replace(/[^0-9]/g, ""));
  }

  if (submitted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={t("investApply.headerTitle")} leftAction={<BackButton fallback="/invest" />} />
        <View style={styles.successContent}>
          <View style={[styles.successIcon, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Ionicons name="checkmark-circle" size={48} color={theme.accent} />
          </View>
          <Text style={[textStyles.screenTitle, { color: theme.text, textAlign: "center" }]}>
            {t("investApply.successTitle")}
          </Text>
          <Text style={[textStyles.bodySmall, { color: theme.secondaryText, textAlign: "center" }]}>
            {t("investApply.successDescription")}
          </Text>
          <Button
            title={t("investApply.goToProduct")}
            onPress={() => router.replace(`/invest-detail/${product.id}`)}
            style={styles.successButton}
          />
          <Button
            title={t("investApply.goToInvestList")}
            variant="outline"
            onPress={() => router.replace("/invest")}
            style={styles.successButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  async function handleSubmit() {
    const nextErrors: Errors = {};

    if (!amount || amountNumber <= 0) {
      nextErrors.amount = t("investApply.errors.amountRequired");
    } else if (amountNumber < minAmountVnd) {
      nextErrors.amount = t("investApply.errors.amountBelowMin", { minAmount: formatVndAmount(minAmountVnd) });
    }
    if (!fullName.trim()) {
      nextErrors.fullName = t("investApply.errors.nameRequired");
    }
    if (!phone.trim()) {
      nextErrors.phone = t("investApply.errors.phoneRequired");
    }
    if (!email.trim()) {
      nextErrors.email = t("investApply.errors.emailRequired");
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = t("investApply.errors.emailInvalid");
    }
    if (!bankName.trim()) {
      nextErrors.bankName = t("investApply.errors.bankNameRequired");
    }
    if (!accountNumber.trim()) {
      nextErrors.accountNumber = t("investApply.errors.accountNumberRequired");
    }
    if (!accountHolder.trim()) {
      nextErrors.accountHolder = t("investApply.errors.accountHolderRequired");
    }
    if (!agreeRisk || !agreePrivacy) {
      nextErrors.agreements = t("investApply.errors.agreementsRequired");
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    // [STEP 06, 2026-09-10] 실제 저장으로 전환. D10 확정(투자 의향 접수만)에 따라
    // investment_orders에 status='pending' 행을 만든다 — 결제/체결은 없다.
    // 계좌 정보(은행/계좌번호/예금주)는 금융 정보라 이번 범위의 테이블에 저장하지
    // 않는다(DATABASE.md에 해당 컬럼 자체를 두지 않았다) — 담당자가 신청 접수 후
    // 별도 절차로 확인하는 것을 전제로, 화면에서만 입력받는다.
    if (!product) return;

    setSubmitting(true);
    const orderId = await createInvestmentOrder({
      productId: product.id,
      amountVnd: amountNumber,
      contactPhone: phone.trim(),
      note: memo.trim() || undefined,
    });
    setSubmitting(false);

    if (!orderId) {
      setErrors({ agreements: t("investApply.errors.submitFailed") });
      return;
    }
    setSubmitted(true);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={t("investApply.headerTitle")} leftAction={<BackButton fallback="/invest" />} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* [STEP: 2026-09-09-8] 사용자 요청 — 기존 상시노출 테스트 비고지 문구를
              삭제하고, 누르면 펼쳐지는 "투자신청 전 꼭 확인" 아코디언으로 교체한다.
              본문은 사용자가 전달한 법적고지 원문을 6개 언어로 번역해 i18n에 등록했다. */}
          {/* [STEP: 2026-09-09-30] 사용자 제보(스크린샷) — 법적/리스크 고지 아코디언
              헤더(아이콘/타이틀/셰브론/테두리)는 중립 회색이 아니라 경고 색상
              (theme.warning, 주황)이어야 한다 — 본문(펼쳐진 텍스트) 색상은 기존
              회색 그대로 유지. */}
          <Pressable
            onPress={() => setDisclaimerExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: disclaimerExpanded }}
            style={({ pressed }) => [
              styles.disclaimer,
              { backgroundColor: theme.card, borderColor: theme.warning, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Ionicons name="information-circle-outline" size={16} color={theme.warning} />
            <Text style={[textStyles.caption, { color: theme.warning, flex: 1, fontWeight: typography.weight.medium }]}>
              {t("investApply.confirmBeforeApplyTitle")}
            </Text>
            <Ionicons
              name={disclaimerExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.warning}
            />
          </Pressable>
          {disclaimerExpanded ? (
            <View style={[styles.disclaimerBody, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("investApply.confirmBeforeApplyBody")}
              </Text>
            </View>
          ) : null}

          {/* [STEP: 2026-09-09-8] 사용자 요청 — 신청 상품 요약에 상세페이지와 동일한
              이미지 슬라이드 갤러리 + 수익률(한줄) + 최소투자/투자기간/목표
              모집액/배당 주기 전체 지표를 노출한다. */}
          <Card style={styles.summaryCard}>
            {/* [STEP: 2026-09-09-34] 사용자 제보(스크린샷) — 갤러리(summaryGallery)의
                marginTop:-spacing.md는 자신이 Card의 "첫 번째 자식"일 때만 카드
                상단 padding을 정확히 상쇄해 이미지가 카드 위쪽 테두리에 딱 붙는다
                (PropertyCard.tsx와 동일 원리). 원래는 "신청 상품" 라벨 Text가 먼저
                오고 있어, 음수 margin이 카드 padding이 아니라 라벨 쪽으로 끌어올려져
                라벨이 이미지에 가려 안 보이고 이미지 위로는 카드 padding만큼의
                여백이 그대로 남아있었다 — 갤러리를 진짜 첫 번째 자식으로 옮기고
                라벨은 그 아래로 이동해 두 문제를 함께 해결한다. */}
            <View style={styles.summaryGallery}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={handleGalleryScroll}
              >
                {product.images.map((image, index) => (
                  <Image key={index} source={image} style={styles.summaryGalleryImage} resizeMode="cover" />
                ))}
              </ScrollView>
              {/* [STEP: 2026-09-10-1] 사용자 요청 — "신청 상품" 라벨을 이미지 좌상단
                  위에 여백 5px, 흰 배경(라운딩)+파란 글씨 배지로 이동. */}
              <View style={[styles.productSummaryBadge, { backgroundColor: theme.background }]}>
                <Text style={[textStyles.caption, { color: theme.accent }]}>
                  {t("investApply.productSummaryLabel")}
                </Text>
              </View>
              {product.images.length > 1 ? (
                <View style={styles.galleryDots}>
                  {product.images.map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.galleryDot,
                        { backgroundColor: index === galleryIndex ? theme.onAccent : "rgba(255,255,255,0.5)" },
                      ]}
                    />
                  ))}
                </View>
              ) : null}
            </View>
            <Text style={[textStyles.cardTitle, { color: theme.text }]} numberOfLines={2}>
              {product.title}
            </Text>
            <Text style={[textStyles.price, { color: theme.accent }]}>
              {expectedReturnParts.rate}
              {expectedReturnParts.suffix ? (
                <Text style={styles.summarySuffix}>{expectedReturnParts.suffix}</Text>
              ) : null}
            </Text>
            <View style={styles.summaryMetricsGrid}>
              <MetricTile label={t("invest.minInvestmentLabel")} value={product.minInvestment} theme={theme} />
              <MetricTile label={t("invest.periodLabel")} value={product.period} theme={theme} />
              <MetricTile
                label={t("investDetail.targetAmountLabel")}
                value={formatVndAmount(product.targetAmountVnd)}
                splitUnit
                theme={theme}
              />
              <MetricTile
                label={t("investDetail.dividendFrequencyLabel")}
                value={t(`investDetail.dividendFrequency.${product.dividendFrequency}`)}
                theme={theme}
              />
            </View>
          </Card>

          {/* 투자 금액 */}
          <View style={styles.section}>
            <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
              {t("investApply.amountSection.title")}
            </Text>
            <Input
              placeholder={`${t("investApply.amountSection.amountPlaceholder")} *`}
              value={amount}
              onChangeText={handleAmountChange}
              keyboardType="number-pad"
              error={errors.amount}
              // [STEP: 2026-09-09-8] 사용자 요청 — 입력창 내 텍스트는 기본 bold를 쓰지
              // 않고, "입력한 글자"만 bold + 파란색(accent)으로 표시한다(placeholder는
              // 영향받지 않음 — value가 있을 때만 조건부 적용).
              style={amount ? { fontWeight: typography.weight.semibold, color: theme.accent } : undefined}
              helperText={
                errors.amount
                  ? undefined
                  : amountNumber > 0
                    ? `${amountNumber.toLocaleString("vi-VN")} VNĐ`
                    : t("investApply.amountSection.amountHelper", { minAmount: formatVndAmount(minAmountVnd) })
              }
              // [STEP: 2026-09-09-32] 사용자 제보(스크린샷) — "최소 투자금 N" 안내
              // 문구는 회색이 아니라 파란색(accent) + semibold로 강조되어야 한다.
              // 입력값이 있을 때 보여지는 "입력한 금액 VNĐ" 에코 텍스트는 강조 대상이
              // 아니므로(스크린샷엔 등장하지 않는 케이스) 기존 회색 그대로 둔다.
              helperTextStyle={
                !errors.amount && amountNumber <= 0
                  ? { color: theme.accent, fontWeight: typography.weight.semibold }
                  : undefined
              }
            />
            <View style={styles.presetRow}>
              {presetAmounts.map((value, index) => (
                <Chip
                  key={value}
                  label={
                    index === 0
                      ? t("investApply.amountSection.quickMinLabel")
                      : t("investApply.amountSection.quickMultLabel", { multiplier: index === 1 ? 2 : 5 })
                  }
                  active={amountNumber === value}
                  onPress={() => setAmount(String(value))}
                  theme={theme}
                  tone="accent"
                  // [STEP: 2026-09-09-8] 사용자 요청 — "최소금액/최소금액x2/..." 라벨이
                  // 칩 폭보다 길어 잘려 보이는 문제 — 글자크기를 11px로 축소.
                  textStyle={{ fontSize: scaleFont(11) }}
                />
              ))}
            </View>
          </View>

          {/* 신청자 정보 */}
          <View style={styles.section}>
            <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
              {t("investApply.applicantSection.title")}
            </Text>
            <Input
              placeholder={`${t("investApply.applicantSection.namePlaceholder")} *`}
              value={fullName}
              onChangeText={setFullName}
              error={errors.fullName}
              style={fullName ? { fontWeight: typography.weight.semibold, color: theme.accent } : undefined}
            />
            <Input
              placeholder={`${t("investApply.applicantSection.phonePlaceholder")} *`}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              error={errors.phone}
              style={phone ? { fontWeight: typography.weight.semibold, color: theme.accent } : undefined}
            />
            <Input
              placeholder={`${t("investApply.applicantSection.emailPlaceholder")} *`}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              error={errors.email}
              style={email ? { fontWeight: typography.weight.semibold, color: theme.accent } : undefined}
            />
          </View>

          {/* 배당금 수령 계좌 */}
          <View style={styles.section}>
            <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
              {t("investApply.payoutSection.title")}
            </Text>
            <Text style={[textStyles.bodySmall, { color: theme.secondaryText }]}>
              {t("investApply.payoutSection.description")}
            </Text>
            {/* [STEP: 2026-09-09-8] 사용자 요청 — 은행명을 자유 입력이 아니라 베트남
                내 모든 은행 중 셀렉트 방식으로 고르도록 변경. 기존 Input과 시각적
                높이/테두리를 맞춰 폼 리듬이 깨지지 않도록 한다. */}
            <Pressable
              onPress={() => setBankModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={t("investApply.payoutSection.bankNameLabel")}
              style={({ pressed }) => [
                styles.bankSelect,
                {
                  borderColor: errors.bankName ? theme.danger : theme.border,
                  backgroundColor: theme.background,
                  opacity: pressed ? opacity.pressed : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.bankSelectText,
                  bankName
                    ? { color: theme.accent, fontWeight: typography.weight.semibold }
                    : { color: theme.secondaryText },
                ]}
                numberOfLines={1}
              >
                {bankName || `${t("investApply.payoutSection.bankNamePlaceholder")} *`}
              </Text>
              <Ionicons name="chevron-down" size={16} color={theme.secondaryText} />
            </Pressable>
            {errors.bankName ? (
              <Text style={[textStyles.caption, { color: theme.danger }]}>{errors.bankName}</Text>
            ) : null}
            <Input
              placeholder={`${t("investApply.payoutSection.accountNumberPlaceholder")} *`}
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="number-pad"
              error={errors.accountNumber}
              style={accountNumber ? { fontWeight: typography.weight.semibold, color: theme.accent } : undefined}
            />
            <Input
              placeholder={`${t("investApply.payoutSection.accountHolderPlaceholder")} *`}
              value={accountHolder}
              onChangeText={setAccountHolder}
              error={errors.accountHolder}
              style={accountHolder ? { fontWeight: typography.weight.semibold, color: theme.accent } : undefined}
            />
          </View>

          {/* 투자 목적/메모 (선택) */}
          <View style={styles.section}>
            <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
              {t("investApply.noteSection.title")}
            </Text>
            <Input
              placeholder={t("investApply.noteSection.placeholder")}
              value={memo}
              onChangeText={setMemo}
              multiline
              numberOfLines={3}
              style={styles.memoInput}
            />
          </View>

          {/* 약관 동의 */}
          <View style={[styles.section, styles.lastSection]}>
            <Text style={[textStyles.sectionTitle, { color: theme.text }]}>
              {t("investApply.agreementsSection.title")}
            </Text>
            <AgreementRow
              checked={agreeRisk}
              onToggle={() => setAgreeRisk((value) => !value)}
              label={t("investApply.agreementsSection.riskLabel")}
              theme={theme}
            />
            <AgreementRow
              checked={agreePrivacy}
              onToggle={() => setAgreePrivacy((value) => !value)}
              label={t("investApply.agreementsSection.privacyLabel")}
              theme={theme}
            />
            <AgreementRow
              checked={agreeMarketing}
              onToggle={() => setAgreeMarketing((value) => !value)}
              label={t("investApply.agreementsSection.marketingLabel")}
              theme={theme}
            />
            {errors.agreements ? (
              <Text style={[textStyles.caption, { color: theme.danger }]}>{errors.agreements}</Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Button
          title={submitting ? t("investApply.submitting") : t("investApply.submitButton")}
          onPress={handleSubmit}
          disabled={submitting}
          style={styles.footerButton}
        />
      </View>

      {/* [STEP: 2026-09-09-8] 사용자 요청 — 은행명 셀렉트 모달. VIETNAM_BANKS
          (constants/vietnamBanks.ts)는 고유명사라 언어별 번역을 적용하지 않는다. */}
      <Modal
        visible={bankModalVisible}
        onClose={() => setBankModalVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("investApply.payoutSection.bankNameLabel")}
        </Text>
        <ScrollView style={styles.bankList} showsVerticalScrollIndicator={false}>
          {VIETNAM_BANKS.map((bank) => {
            const isSelected = bank === bankName;
            return (
              <Pressable
                key={bank}
                onPress={() => {
                  setBankName(bank);
                  setBankModalVisible(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [
                  styles.bankOption,
                  {
                    backgroundColor: isSelected ? theme.card : "transparent",
                    opacity: pressed ? opacity.pressed : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    textStyles.bodySmall,
                    { color: isSelected ? theme.accent : theme.text, flex: 1 },
                  ]}
                >
                  {bank}
                </Text>
                {isSelected ? <Ionicons name="checkmark" size={16} color={theme.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Modal>
    </SafeAreaView>
  );
}


function AgreementRow({
  checked,
  onToggle,
  label,
  theme,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  theme: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.agreementRow, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={20}
        color={checked ? theme.accent : theme.secondaryText}
      />
      {/* [STEP: 2026-09-09-8] 사용자 요청 — 약관 동의 3개 항목 글자 크기 11px */}
      <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1, fontSize: scaleFont(11) }]}>{label}</Text>
    </Pressable>
  );
}

// [STEP: 2026-09-09-8] 사용자 요청 — 신청 상품 요약 카드에 투자 상세페이지와 동일한
// 지표 타일을 노출한다. app/invest-detail/[id].tsx의 MetricTile과 동일한 시각 규칙
// (숫자:bold/큰 사이즈, 단위:regular/작은 사이즈)을 그대로 따른다.
function MetricTile({
  label,
  value,
  theme,
  splitUnit = false,
}: {
  label: string;
  value: string;
  theme: ThemeColors;
  splitUnit?: boolean;
}) {
  const parts = splitUnit ? splitYieldText(value) : { rate: value, suffix: "" };
  return (
    <View style={[styles.metricTile, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <Text style={[textStyles.caption, { color: theme.secondaryText }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[textStyles.bodySmall, { color: theme.text, fontWeight: "600" }]} numberOfLines={1}>
        {parts.rate}
        {parts.suffix ? <Text style={{ fontWeight: typography.weight.regular }}>{parts.suffix}</Text> : null}
      </Text>
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
  // [STEP: 2026-09-09-6] 사용자 요청 — 영역(신청 상품 요약/투자 금액/신청자 정보/
  // 배당금 수령 계좌/메모/약관 동의)별 상하 간격을 40px로 띄운다.
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: 40,
  },
  disclaimer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  // [STEP: 2026-09-09-31] 사용자 요청 — 아코디언 타이틀과 펼친 본문 사이 간격을
  // 정확히 10px로(content.gap 40 + 이 marginTop -30 = 10).
  disclaimerBody: {
    marginTop: -30,
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  summaryCard: {
    gap: spacing.xs,
  },
  summaryGallery: {
    marginHorizontal: -spacing.md,
    marginTop: -spacing.md,
    height: 160,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    overflow: "hidden",
    // [STEP: 2026-09-10-1] productSummaryBadge(절대배치)가 react-native-web에서
    // 이 컨테이너 기준으로 위치하도록 명시적으로 relative를 준다(다른 곳과 동일한
    // 이유 — 위 STEP 주석들 참고).
    position: "relative",
  },
  // [STEP: 2026-09-10-1] 사용자 요청 — "신청 상품" 라벨을 이미지 좌상단 위에
  // 여백 5px, 흰 배경(라운딩)+파란 글씨 배지로.
  productSummaryBadge: {
    position: "absolute",
    top: 5,
    left: 5,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  summaryGalleryImage: {
    width: GALLERY_WIDTH,
    height: 160,
  },
  galleryDots: {
    position: "absolute",
    bottom: spacing.xs,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  galleryDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
  },
  summaryMetricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metricTile: {
    width: "48%",
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 2,
  },
  summarySuffix: {
    fontWeight: typography.weight.regular,
    fontSize: typography.size.sm,
  },
  bankSelect: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bankSelectText: {
    flex: 1,
    fontSize: typography.size.md,
  },
  bankList: {
    maxHeight: 360,
  },
  bankOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  section: {
    gap: spacing.sm,
  },
  lastSection: {
    paddingBottom: spacing.md,
  },
  presetRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  memoInput: {
    minHeight: 80,
    textAlignVertical: "top",
    paddingTop: spacing.sm,
  },
  agreementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerButton: {
    width: "100%",
  },
  successContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  successButton: {
    width: "100%",
    marginTop: spacing.xs,
  },
});
