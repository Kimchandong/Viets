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
import { createScaledStyles, colors, opacity, radius, spacing, textStyles, typography, scaleFont } from "@/constants/theme";
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

/**
 * [2026-09-16 확정-결정사항 5] 모집 기간 입력 — YYYY-MM-DD ↔ ISO 변환.
 *
 * 세 함수가 한 규칙을 공유한다: **종료일은 그날 23:59:59.999까지**다. 관리자가
 * 종료일에 9월 30일을 넣으면 9월 30일 하루가 통째로 모집 기간에 들어가야 한다 —
 * 9월 30일 00:00로 저장하면 그날 아침에 이미 마감이라 관리자가 놀란다.
 *
 * 시간대: 기기의 지역 시간으로 만든 Date를 ISO(UTC)로 저장한다. 베트남 현지
 * 담당자가 넣은 "9월 30일"이 현지 기준 하루가 된다.
 */
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 빈 문자열이면 null(제한 없음), 형식이 틀리면 undefined(입력 오류). */
function dateInputToIso(value: string, endOfDay: boolean): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!DATE_INPUT_PATTERN.test(trimmed)) return undefined;

  const [year, month, day] = trimmed.split("-").map(Number);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);

  // "2026-02-31"처럼 달력에 없는 날은 Date가 조용히 3월로 굴린다. 되돌려 비교해
  // 입력한 날과 다르면 오류로 본다.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date.toISOString();
}

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
  // [2026-09-16 확정-결정사항 5] 모집 기간. YYYY-MM-DD 문자열로 받는다.
  //
  // 날짜 선택기를 쓰지 않은 이유: @react-native-community/datetimepicker는 네이티브
  // 모듈이라 지금 넣으면 **새 네이티브 빌드**가 필요하다. 지금은 빌드 횟수를 줄이려는
  // 단계이고, 이 화면은 관리자 전용이라 텍스트 입력으로 충분하다.
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
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
  const [errors, setErrors] = useState<{
    title?: string;
    target?: string;
    minimum?: string;
    startAt?: string;
    endAt?: string;
  }>({});

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
      setStartAt(isoToDateInput(existing.start_at));
      setEndAt(isoToDateInput(existing.end_at));
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
    const nextErrors: {
      title?: string;
      target?: string;
      minimum?: string;
      startAt?: string;
      endAt?: string;
    } = {};
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
    // [2026-09-16 확정 5] 모집 기간 — 둘 다 비워도 된다(제한 없음).
    const startIso = dateInputToIso(startAt, false);
    const endIso = dateInputToIso(endAt, true);
    if (startIso === undefined) {
      nextErrors.startAt = t("investRegister.errorDateFormat");
    }
    if (endIso === undefined) {
      nextErrors.endAt = t("investRegister.errorDateFormat");
    }
    if (startIso && endIso && new Date(startIso) > new Date(endIso)) {
      nextErrors.endAt = t("investRegister.errorEndBeforeStart");
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
      // 위 검증을 통과했으므로 undefined일 수 없다 — null(제한 없음)이거나 ISO다.
      start_at: startIso ?? null,
      end_at: endIso ?? null,
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

        {/* [2026-09-16 확정-결정사항 5] 모집 기간.
            비워 두면 제한이 없다 — 기간 열이 생기기 전에 등록된 상품과 같은 동작이다.
            종료일이 지나면 투자 탭 목록에서 사라지지만, 이미 투자한 사람은 MY의
            내 투자에서 계속 볼 수 있다(사용자 결정). */}
        <View style={styles.section}>
          <SectionHeader title={t("investRegister.periodSection")} />
          <Text style={styles.sectionHint}>{t("investRegister.periodHelper")}</Text>
          <View style={styles.row}>
            <Input
              label={t("investRegister.startAtLabel")}
              value={startAt}
              onChangeText={(next) => {
                setStartAt(next);
                if (errors.startAt) setErrors((prev) => ({ ...prev, startAt: undefined }));
              }}
              placeholder="2026-09-30"
              error={errors.startAt}
              containerStyle={styles.rowItem}
            />
            <Input
              label={t("investRegister.endAtLabel")}
              value={endAt}
              onChangeText={(next) => {
                setEndAt(next);
                if (errors.endAt) setErrors((prev) => ({ ...prev, endAt: undefined }));
              }}
              placeholder="2026-12-31"
              error={errors.endAt}
              containerStyle={styles.rowItem}
            />
          </View>
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


const styles = createScaledStyles(() => ({
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
    fontSize: scaleFont(11),
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
  // [2026-09-16 확정 5] 모집 기간 섹션 제목 아래 한 줄 — 비워도 된다는 안내.
  // SectionHeader에 부제 자리가 없어 여기서 그린다(매물 등록 화면과 같은 방식).
  sectionHint: {
    ...textStyles.caption,
    color: colors.light.secondaryText,
    marginTop: -spacing.xs,
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
}));
