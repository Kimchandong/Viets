import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { BackButton } from "@/components/BackButton";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { Loading } from "@/components/Loading";
import { Modal } from "@/components/Modal";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { colors, opacity, radius, spacing, textStyles, typography } from "@/constants/theme";
import type { InvestImageCategory } from "@/constants/mockImages";
import { MOCK_REGIONS } from "@/constants/mockData";
import {
  closeInvestmentProduct,
  createInvestmentProduct,
  deleteInvestmentProductPermanently,
  getInvestmentProductForEdit,
  updateInvestmentProduct,
  type NewInvestmentProductInput,
} from "@/services/investments";
import {
  getPropertyOption,
  listPropertyOptions,
  type PropertyOption,
} from "@/services/properties";
import { canManageInvestment, isAdmin } from "@/services/roles";
import { InvestPermissionPanel } from "@/components/InvestPermissionPanel";

/**
 * [STEP 06] 투자상품 등록/수정 화면.
 *
 * 사용자 요구사항(2026-09-10): "투자등록은 관리자와 권한부여받은 계정만 등록/수정/삭제
 * 가능" — 진입 시 services/roles.ts의 canManageInvestment()로 admin 계열 또는
 * `user_permissions.investment_manage` 보유 여부를 확인한다. 실제 차단은
 * investment_products RLS가 서버에서 수행하므로 이 검사는 UI 가드일 뿐이다.
 *
 * `?id=<상품id>`로 진입하면 수정 모드가 된다(매물 등록 화면과 동일한 구조).
 * 상품 사진 테이블은 아직 없어(투자상품은 카테고리 기본 이미지 사용) 사진 첨부는 없다.
 */

const CATEGORIES: InvestImageCategory[] = [
  "land",
  "building",
  "commercial",
  "residential",
  "industrial",
  "warehouse",
  "other",
];

const PRODUCT_TYPES = ["reit_share", "co_investment", "fund", "bond_like"] as const;
const RISK_LEVELS = ["low", "medium", "high"] as const;
const DIVIDEND_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;

type ProductType = (typeof PRODUCT_TYPES)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];
type DividendFrequency = (typeof DIVIDEND_FREQUENCIES)[number];

export default function InvestRegisterScreen() {
  const theme = colors.light;
  const { t } = useTranslation();
  const router = useRouter();

  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id;
  const isEditing = !!editingId;

  const [checkingPermission, setCheckingPermission] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(!!editingId);
  const [canHardDelete, setCanHardDelete] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<InvestImageCategory>("residential");
  const [productType, setProductType] = useState<ProductType>("reit_share");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("medium");
  // [2026-09-11 사용자 지시 — 4차] 지역 — 매물/등록신청과 같은 목록을 쓴다.
  const [region, setRegion] = useState("");
  const [riskPickerVisible, setRiskPickerVisible] = useState(false);
  const [dividendFrequency, setDividendFrequency] = useState<DividendFrequency>("quarterly");
  const [targetAmount, setTargetAmount] = useState("");
  const [minimumInvestment, setMinimumInvestment] = useState("");
  const [raisedAmount, setRaisedAmount] = useState("0");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [periodMonths, setPeriodMonths] = useState("");
  const [publishNow, setPublishNow] = useState(true);

  // [STEP 06-매물연결] 연계 매물(investment_products.property_id). 선택 사항이다 —
  // 여러 매물을 묶은 펀드형 상품처럼 특정 매물 하나에 대응하지 않는 상품도 있다.
  // 연결하면 상품 목록/상세에 그 매물의 주소가 표시된다(services/investments.ts mapRow).
  const [linkedProperty, setLinkedProperty] = useState<PropertyOption | null>(null);
  const [propertyPickerVisible, setPropertyPickerVisible] = useState(false);
  const [propertyQuery, setPropertyQuery] = useState("");
  const [propertyOptions, setPropertyOptions] = useState<PropertyOption[]>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ title?: string; target?: string; minimum?: string }>({});

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 1800);
  }

  useEffect(() => {
    let mounted = true;
    canManageInvestment().then((ok) => {
      if (mounted) {
        setAllowed(ok);
        setCheckingPermission(false);
      }
    });
    isAdmin().then((ok) => {
      if (mounted) setCanHardDelete(ok);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!editingId) return;

    getInvestmentProductForEdit(editingId).then((existing) => {
      if (!mounted) return;
      if (!existing) {
        setLoadingExisting(false);
        showToast(t("investRegister.loadFailed"));
        return;
      }
      setTitle(existing.title);
      setDescription(existing.description ?? "");
      setCategory(existing.category ?? "residential");
      setProductType(existing.product_type);
      setRiskLevel(existing.risk_level);
      setRegion(existing.region ?? "");
      setDividendFrequency(existing.dividend_frequency ?? "quarterly");
      setTargetAmount(String(existing.target_amount));
      setMinimumInvestment(String(existing.minimum_investment));
      setRaisedAmount(String(existing.raised_amount ?? 0));
      setExpectedReturn(existing.expected_return !== null ? String(existing.expected_return) : "");
      setPeriodMonths(
        existing.investment_period_months !== null ? String(existing.investment_period_months) : "",
      );
      setPublishNow(existing.status === "open");
      setLoadingExisting(false);

      // 연결된 매물이 있으면 이름을 한 번 더 조회해 화면에 보여준다. 그 사이 매물이
      // 삭제됐거나 볼 권한이 없으면 null이 돌아오고 "연결된 매물 없음"으로 표시된다
      // — 이때 저장하면 연결이 실제로 해제되므로, 그 편이 화면과 DB가 어긋나는 것보다 낫다.
      if (existing.property_id) {
        getPropertyOption(existing.property_id).then((option) => {
          if (mounted) setLinkedProperty(option);
        });
      }
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // 매물 선택 모달이 열려 있는 동안에만 검색한다. 타자 한 글자마다 요청하지 않도록
  // 300ms 쉬었을 때만 보낸다(선택 모달을 닫으면 타이머도 함께 정리된다).
  useEffect(() => {
    if (!propertyPickerVisible) return;

    let mounted = true;
    setLoadingProperties(true);
    const timer = setTimeout(() => {
      listPropertyOptions(propertyQuery).then((options) => {
        if (!mounted) return;
        setPropertyOptions(options);
        setLoadingProperties(false);
      });
    }, 300);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [propertyPickerVisible, propertyQuery]);

  function parseNumber(value: string): number | null {
    const cleaned = value.replace(/[,\s]/g, "");
    if (cleaned.length === 0) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async function handleSubmit() {
    const nextErrors: { title?: string; target?: string; minimum?: string } = {};
    if (title.trim().length === 0) {
      nextErrors.title = t("investRegister.errorTitleRequired");
    }
    const targetValue = parseNumber(targetAmount);
    if (targetValue === null || targetValue <= 0) {
      nextErrors.target = t("investRegister.errorTargetRequired");
    }
    const minimumValue = parseNumber(minimumInvestment);
    if (minimumValue === null || minimumValue <= 0) {
      nextErrors.minimum = t("investRegister.errorMinimumRequired");
    } else if (targetValue !== null && minimumValue > targetValue) {
      nextErrors.minimum = t("investRegister.errorMinimumTooLarge");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: NewInvestmentProductInput = {
      title: title.trim(),
      description: description.trim(),
      category,
      product_type: productType,
      target_amount: targetValue as number,
      minimum_investment: minimumValue as number,
      expected_return: parseNumber(expectedReturn),
      investment_period_months: parseNumber(periodMonths),
      dividend_frequency: dividendFrequency,
      risk_level: riskLevel,
      region,
      property_id: linkedProperty?.id ?? null,
      raised_amount: parseNumber(raisedAmount) ?? 0,
      status: publishNow ? "open" : "draft",
    };

    setSubmitting(true);
    const savedId = isEditing
      ? (await updateInvestmentProduct(editingId as string, payload))
        ? (editingId as string)
        : null
      : await createInvestmentProduct(payload);
    setSubmitting(false);

    if (!savedId) {
      showToast(t("investRegister.submitFailed"));
      return;
    }

    if (publishNow) {
      router.replace(`/invest-detail/${savedId}`);
    } else {
      showToast(t("investRegister.savedAsDraft"));
      router.back();
    }
  }

  async function handleClose() {
    if (!editingId) return;
    setDeleteModalVisible(false);
    setSubmitting(true);
    const ok = await closeInvestmentProduct(editingId);
    setSubmitting(false);
    if (!ok) {
      showToast(t("investRegister.deleteFailed"));
      return;
    }
    showToast(t("investRegister.closed"));
    router.replace("/invest");
  }

  async function handleHardDelete() {
    if (!editingId) return;
    setDeleteModalVisible(false);
    setSubmitting(true);
    const ok = await deleteInvestmentProductPermanently(editingId);
    setSubmitting(false);
    if (!ok) {
      // 신청 이력이 있으면 FK(ON DELETE RESTRICT)로 거부된다 — 소프트 삭제를 안내한다.
      showToast(t("investRegister.hardDeleteBlocked"));
      return;
    }
    showToast(t("investRegister.deleted"));
    router.replace("/invest");
  }

  const screenTitle = isEditing ? t("investRegister.editTitle") : t("investRegister.title");

  if (checkingPermission || loadingExisting) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/invest" />} />
        <Loading />
      </SafeAreaView>
    );
  }

  if (!allowed) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
        <Header title={screenTitle} leftAction={<BackButton fallback="/invest" />} />
        <EmptyState
          title={t("investRegister.noPermissionTitle")}
          description={t("investRegister.noPermissionDescription")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={["bottom"]}>
      <Header title={screenTitle} leftAction={<BackButton fallback="/invest" />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* [2026-09-11 사용자 지시 — 4차] 지역 — 컨텐츠 맨 위, 가로 슬라이드. */}
        <Text style={[styles.smallLabel, { color: theme.secondaryText, marginTop: spacing.sm }]}>
          {t("investRegister.regionLabel")}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.slideRow}
        >
          {MOCK_REGIONS.map((item) => (
            <Chip
              key={item}
              label={item}
              active={region === item}
              onPress={() => setRegion(region === item ? "" : item)}
              theme={theme}
              tone="accent"
            />
          ))}
        </ScrollView>

        <View style={styles.section}>
          <SectionHeader title={t("investRegister.categorySection")} />

          {/* 분류 — 가로 슬라이드. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.slideRow}
          >
            {CATEGORIES.map((item) => (
              <Chip
                key={item}
                label={t(`categories.invest.${item}`)}
                active={category === item}
                onPress={() => setCategory(item)}
                theme={theme}
                tone="accent"
              />
            ))}
          </ScrollView>

          {/* 상품구조(좌, 가로 슬라이드) + 위험도(우, 테두리 없는 셀렉트).
              위험도는 값이 셋뿐이고 색으로 읽히는 값이라 칩을 늘어놓기보다
              한 칸짜리 셀렉트가 자리를 덜 먹는다. */}
          <View style={styles.structureRow}>
            <View style={styles.structureCol}>
              <Text style={[styles.smallLabel, { color: theme.secondaryText }]}>
                {t("investRegister.productTypeLabel")}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.slideRowTight}
              >
                {PRODUCT_TYPES.map((item) => (
                  <Chip
                    key={item}
                    label={t(`investRegister.productType.${item}`)}
                    active={productType === item}
                    onPress={() => setProductType(item)}
                    theme={theme}
                    tone="accent"
                  />
                ))}
              </ScrollView>
            </View>

            <View style={styles.riskCol}>
              <Text style={[styles.smallLabel, { color: theme.secondaryText }]}>
                {t("investRegister.riskLabel")}
              </Text>
              <Pressable
                onPress={() => setRiskPickerVisible(true)}
                accessibilityRole="button"
                accessibilityValue={{ text: t(`invest.risk.${riskLevel}`) }}
                style={({ pressed }) => [
                  styles.riskField,
                  { opacity: pressed ? opacity.pressed : 1 },
                ]}
              >
                <Text
                  style={[
                    textStyles.bodySmall,
                    { color: riskColor(riskLevel, theme), fontWeight: typography.weight.medium },
                  ]}
                  numberOfLines={1}
                >
                  {t(`invest.risk.${riskLevel}`)}
                </Text>
                <Ionicons name="chevron-down" size={16} color={theme.secondaryText} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("investRegister.basicSection")} />
          <Input
            label={t("investRegister.titleLabel")}
            value={title}
            onChangeText={setTitle}
            error={errors.title}
          />
          <Input
            label={t("investRegister.descriptionLabel")}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            style={styles.multiline}
          />
        </View>

        <View style={styles.section}>
          <Input
            label={t("investRegister.targetAmountLabel")}
            value={targetAmount}
            onChangeText={setTargetAmount}
            keyboardType="numeric"
            error={errors.target}
            helperText={t("investRegister.amountHelper")}
          />
          <Input
            label={t("investRegister.minimumLabel")}
            value={minimumInvestment}
            onChangeText={setMinimumInvestment}
            keyboardType="numeric"
            error={errors.minimum}
          />
          <Input
            label={t("investRegister.raisedAmountLabel")}
            value={raisedAmount}
            onChangeText={setRaisedAmount}
            keyboardType="numeric"
            helperText={t("investRegister.raisedAmountHelper")}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader title={t("investRegister.returnSection")} />
          <View style={styles.row}>
            <Input
              label={t("investRegister.expectedReturnLabel")}
              value={expectedReturn}
              onChangeText={setExpectedReturn}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
            />
            <Input
              label={t("investRegister.periodLabel")}
              value={periodMonths}
              onChangeText={setPeriodMonths}
              keyboardType="numeric"
              containerStyle={styles.rowItem}
            />
          </View>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("investRegister.dividendLabel")}
          </Text>
          {/* 배당주기는 셋뿐이라 가로를 3등분해 한 줄에 채운다. */}
          <View style={styles.thirdsRow}>
            {DIVIDEND_FREQUENCIES.map((item) => {
              const active = dividendFrequency === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setDividendFrequency(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.thirdsButton,
                    {
                      borderColor: active ? theme.accent : theme.border,
                      backgroundColor: active ? theme.accent : "transparent",
                      opacity: pressed ? opacity.pressed : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      textStyles.bodySmall,
                      {
                        color: active ? theme.onAccent : theme.text,
                        fontWeight: typography.weight.medium,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {t(`investDetail.dividendFrequency.${item}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Pressable
            onPress={() => setPublishNow((prev) => !prev)}
            accessibilityRole="switch"
            accessibilityState={{ checked: publishNow }}
            style={({ pressed }) => [
              styles.toggleRow,
              { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <View style={styles.toggleTexts}>
              <Text style={[textStyles.body, { color: theme.text, fontWeight: typography.weight.medium }]}>
                {t("investRegister.publishLabel")}
              </Text>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {t("investRegister.publishDescription")}
              </Text>
            </View>
            <Ionicons
              name={publishNow ? "checkmark-circle" : "ellipse-outline"}
              size={24}
              color={publishNow ? theme.accent : theme.secondaryText}
            />
          </Pressable>
        </View>

        {/* [STEP 06-매물연결] 연계 매물 — 선택 사항. 연결하면 상품 목록/상세에 해당
            매물의 주소가 함께 표시되고, 상세 화면에서 매물로 이동할 수 있다. */}
        <View style={styles.section}>
          <SectionHeader title={t("investRegister.propertySection")} />
          <Pressable
            onPress={() => {
              setPropertyQuery("");
              setPropertyPickerVisible(true);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.toggleRow,
              { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <View style={styles.toggleTexts}>
              <Text
                style={[
                  textStyles.body,
                  {
                    color: linkedProperty ? theme.text : theme.secondaryText,
                    fontWeight: typography.weight.medium,
                  },
                ]}
              >
                {linkedProperty ? linkedProperty.title : t("investRegister.propertyNone")}
              </Text>
              <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                {linkedProperty && linkedProperty.address.length > 0
                  ? linkedProperty.address
                  : t("investRegister.propertySelectHint")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.secondaryText} />
          </Pressable>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("investRegister.propertyHelper")}
          </Text>
        </View>

        <Button
          title={
            submitting
              ? t("investRegister.submitting")
              : isEditing
                ? t("investRegister.save")
                : t("investRegister.submit")
          }
          onPress={handleSubmit}
          disabled={submitting}
          style={styles.submitButton}
        />

        {isEditing ? (
          <Button
            title={t("investRegister.delete")}
            variant="outline"
            onPress={() => setDeleteModalVisible(true)}
            disabled={submitting}
            style={styles.submitButton}
          />
        ) : null}

        {/* [2026-09-11 사용자 지시 — 4차] 투자등록 권한관리 — 관리자만 보인다.
            MY의 "계정 권한 관리"에 묻혀 있던 기능을, 실제로 그 권한을 쓰는 화면
            아래로 옮겼다(소셜 로그인 이메일로 계정을 찾아 켜고 끈다). */}
        {canHardDelete ? <InvestPermissionPanel /> : null}
      </ScrollView>

      <Modal
        visible={riskPickerVisible}
        onClose={() => setRiskPickerVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("investRegister.riskLabel")}
        </Text>
        {RISK_LEVELS.map((item) => (
          <Pressable
            key={item}
            onPress={() => {
              setRiskLevel(item);
              setRiskPickerVisible(false);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: riskLevel === item }}
            style={({ pressed }) => [
              styles.riskOption,
              { borderBottomColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text
              style={[
                textStyles.body,
                { color: riskColor(item, theme), fontWeight: typography.weight.medium },
              ]}
            >
              {t(`invest.risk.${item}`)}
            </Text>
            {riskLevel === item ? (
              <Ionicons name="checkmark" size={18} color={riskColor(item, theme)} />
            ) : null}
          </Pressable>
        ))}
      </Modal>

      <Modal
        visible={deleteModalVisible}
        onClose={() => setDeleteModalVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("investRegister.deleteTitle")}
        </Text>

        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.deleteOption,
            { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
          ]}
        >
          <Text style={[textStyles.body, { color: theme.text }]}>{t("investRegister.closeOption")}</Text>
          <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
            {t("investRegister.closeOptionDescription")}
          </Text>
        </Pressable>

        {canHardDelete ? (
          <Pressable
            onPress={handleHardDelete}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.deleteOption,
              { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text style={[textStyles.body, { color: theme.danger }]}>
              {t("investRegister.hardDeleteOption")}
            </Text>
            <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
              {t("investRegister.hardDeleteOptionDescription")}
            </Text>
          </Pressable>
        ) : null}
      </Modal>

      {/* [STEP 06-매물연결] 매물 선택 — 검색어 없이 열면 최근 등록순 50건을 보여준다. */}
      <Modal
        visible={propertyPickerVisible}
        onClose={() => setPropertyPickerVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("investRegister.propertyPickerTitle")}
        </Text>
        <Input
          value={propertyQuery}
          onChangeText={setPropertyQuery}
          placeholder={t("investRegister.propertySearchPlaceholder")}
          autoCorrect={false}
        />

        <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
          {loadingProperties ? (
            <Text style={[textStyles.caption, styles.pickerNotice, { color: theme.secondaryText }]}>
              {t("common.loading")}
            </Text>
          ) : propertyOptions.length === 0 ? (
            <Text style={[textStyles.caption, styles.pickerNotice, { color: theme.secondaryText }]}>
              {t("investRegister.propertyEmpty")}
            </Text>
          ) : (
            propertyOptions.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => {
                  setLinkedProperty(option);
                  setPropertyPickerVisible(false);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.pickerRow,
                  { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                ]}
              >
                <Text style={[textStyles.body, { color: theme.text }]} numberOfLines={1}>
                  {option.title}
                </Text>
                {option.address.length > 0 ? (
                  <Text
                    style={[textStyles.caption, { color: theme.secondaryText }]}
                    numberOfLines={1}
                  >
                    {option.address}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </ScrollView>

        {linkedProperty ? (
          <Button
            title={t("investRegister.propertyUnlink")}
            variant="outline"
            onPress={() => {
              setLinkedProperty(null);
              setPropertyPickerVisible(false);
            }}
            style={styles.submitButton}
          />
        ) : null}
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </SafeAreaView>
  );
}

/** 위험도 색 — 낮음 초록 / 중간 파랑 / 높음 빨강(사용자 지정). */
function riskColor(level: RiskLevel, theme: typeof colors.light): string {
  if (level === "low") return theme.success;
  if (level === "high") return theme.danger;
  return theme.accent;
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  slideRow: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  slideRowTight: {
    gap: spacing.xs,
  },
  structureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  structureCol: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  // [2026-09-11 사용자 지시] 고정 폭(110)을 없애고 글자 길이에 맞춘다 — 언어마다
  // "중간위험"의 길이가 달라 고정 폭이면 어떤 언어에서는 남고 어떤 언어에서는 잘렸다.
  riskCol: {
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  smallLabel: {
    fontSize: 11,
  },
  // 테두리 없음(사용자 지정) — 값 자체가 색으로 읽히므로 상자를 두르지 않는다.
  riskField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  riskOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thirdsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  thirdsButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  rowItem: {
    flex: 1,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  toggleTexts: {
    flex: 1,
    gap: 2,
  },
  deleteOption: {
    gap: 2,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  submitButton: {
    width: "100%",
  },
  // 목록이 길어져도 모달이 화면을 넘기지 않도록 높이를 제한하고 안에서 스크롤한다.
  pickerList: {
    maxHeight: 280,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  pickerRow: {
    gap: 2,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerNotice: {
    paddingVertical: spacing.lg,
    textAlign: "center",
  },
});
