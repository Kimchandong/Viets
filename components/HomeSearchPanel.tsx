import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  colors,
  createScaledStyles,
  opacity,
  radius,
  spacing,
  textStyles,
  typography,
} from "@/constants/theme";
import { VIETNAM_MUNICIPALITIES, VIETNAM_PROVINCES } from "@/constants/vietnamRegions";
import { formatVndAmount } from "@/utils/format";

/**
 * [2026-09-26 사용자 지시] 홈 히어로(배경영상) 위에 얹는 검색 패널.
 *
 * 모든 항목은 **눌러서 하단 팝업으로 고른다**. 칩을 패널에 늘어놓던 초안은
 * 조건이 늘어날수록 패널이 세로로 길어져 영상을 다 덮었고, 지역처럼 34개짜리
 * 목록은 애초에 늘어놓을 수 없었다. 지금은 패널에 "무엇을 골랐는지"만 한 줄씩
 * 남고, 고르는 일은 팝업에서 한다.
 *
 * 색은 영상 위에 얹히는 유리판이라 테마 토큰이 아니라 흰색 알파값을 쓴다
 * (사용자가 rgba 값을 직접 지정했다). 팝업은 영상 위가 아니라 화면 하단에
 * 뜨므로 그 안은 평범한 테마 색을 쓴다 — 유리판 색을 팝업까지 끌고 가면
 * 흰 배경 위 흰 글자가 된다.
 */

/**
 * 사용자 지정 — 테두리 rgba(255,255,255,0.5) / 배경 rgba(255,255,255,0.2).
 * [2026-09-26] 0.6/0.3에서 한 단계 낮췄다(영상이 더 비쳐 보이도록).
 */
const GLASS_BORDER = "rgba(255,255,255,0.5)";
const GLASS_FILL = "rgba(255,255,255,0.2)";
/**
 * 검색 버튼 비활성 배경 — 유리판 값과 **따로** 둔다(사용자가 따로 지정하는 값이다).
 * [2026-09-26] 0.6 → 0.3.
 */
const DISABLED_BG = "rgba(255,255,255,0.3)";
export type HomeSearchTab = "property" | "invest";

/**
 * [2026-09-26 사용자 지시] 탭마다 강조색이 다르다 — 매물은 파랑, 투자는 빨강.
 *
 * 활성 탭 배경 · 패널 테두리 · 검색 버튼 · 팝업에서 고른 항목 · 금액 슬라이더가
 * 모두 이 한 값을 따라간다. 색을 한곳에 모아 두지 않으면 "탭은 파란데 버튼만
 * 빨간" 식으로 어긋나기 쉽다.
 *
 * 빨강은 Material red 700, 파랑은 같은 채도대의 blue 700을 썼다. 앱 브랜드색
 * (theme.accent #2F3C7E)은 짙은 남색이라, 어두운 영상 + 검은 막 위에서는 빨강만큼
 * 또렷하게 떠오르지 않아 두 탭의 무게가 맞지 않는다.
 */
export const ACCENT_BY_TAB: Record<HomeSearchTab, string> = {
  property: "#1976D2",
  invest: "#D32F2F",
};

/** 매물 거래 종류. 'presale'(분양)은 아직 DB에 값이 없다 — 아래 주석 참고. */
export type ListingKind = "forSale" | "forRent" | "presale";

/** 거래 종류별로 고를 수 있는 매물 카테고리. 사용자가 준 목록 그대로다. */
const CATEGORY_BY_LISTING: Record<ListingKind, string[]> = {
  forSale: ["apartment", "residential", "building", "factory", "land", "other"],
  // 임대는 'building'의 이름만 다르다(상가/빌딩/오피스) — id는 같으므로 필터는 그대로 통한다.
  forRent: ["apartment", "residential", "building", "factory", "land", "other"],
  presale: ["apartment", "other"],
};

const LISTING_KINDS: ListingKind[] = ["forSale", "forRent", "presale"];

const INVEST_CATEGORIES = [
  "land",
  "building",
  "commercial",
  "residential",
  "industrial",
  "warehouse",
  "other",
];

/** 배당주기. 'single'(단일 %)은 아직 DB에 값이 없다 — 아래 주석 참고. */
const DIVIDEND_KINDS = ["monthly", "quarterly", "yearly", "single"];

/**
 * 금액 슬라이더 상한 — 100억 VND.
 *
 * 사용자가 "0 ~ 100억"이라고 적었고 이 앱의 금액 단위는 전부 VND라 100억 VND로
 * 읽었다(= 10,000,000,000 = 10 tỷ). 원화로 읽을 근거가 없다 — 화면 어디에도
 * 원화가 나오지 않는다. 매물 금액도 같은 축을 쓴다.
 */

/**
 * [2026-09-26 사용자 지시] 금액 바의 범위를 **거래 종류에 따라** 다르게 둔다.
 *
 * 임대와 매매는 자릿수가 다르다. 하나의 0~100억 바로 둘 다 다루면 임대 쪽은
 * 바의 맨 왼쪽 1%에 몰려 손가락으로는 고를 수가 없다.
 *
 * - 임대: 0 ~ 10억동 (월세이므로 0에서 시작)
 * - 매매: 1억 ~ 100억동 (0원짜리 매매는 없다)
 * - 분양: 매매와 같다 — 사는 거래라 자릿수가 같다.
 * - 거래 종류를 아직 안 골랐을 때: 전체를 덮는 0~100억.
 */
/**
 * [2026-09-28 사용자 지시] 금액 바는 **눈금 목록**이다. 예전에는 min~max를 일정 간격으로
 * 나눈 직선 바였는데, 실제 금액은 자릿수가 크게 벌어져 있어 직선으로는 못 쓴다 —
 * 매매를 0~100억 직선으로 두면 1억짜리와 5억짜리가 바의 왼쪽 몇 px 안에 겹친다.
 *
 * 그래서 사용자가 지정한 지점만 눈금으로 두고, 손잡이는 눈금에만 선다.
 * 눈금 사이 간격은 화면에서 모두 같으므로(등간격) 자릿수가 달라도 고르기 쉽다.
 */
type AmountScale = {
  /** 왼쪽부터 오른쪽까지의 눈금 값(VND). */
  stops: number[];
  /** "이 금액 이상"을 뜻하는 체크 기준. 보통 마지막 눈금과 같다. */
  over: number;
};

const SALE_SCALE: AmountScale = {
  // 0 · 10,000k · 100,000k · 1 tỷ · 5 tỷ · 10 tỷ
  stops: [0, 10_000_000, 100_000_000, 1_000_000_000, 5_000_000_000, 10_000_000_000],
  over: 10_000_000_000,
};

const RENT_SCALE: AmountScale = {
  // 0 · 1,000k · 10,000k · 100,000k · 1 tỷ
  stops: [0, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000],
  over: 1_000_000_000,
};

const AMOUNT_SCALES: Record<string, AmountScale> = {
  forRent: RENT_SCALE,
  forSale: SALE_SCALE,
  // 분양은 매매와 같다 — 사는 거래라 자릿수가 같다.
  presale: SALE_SCALE,
};

/** 투자액 바 — 거래 종류와 무관하다. 매매와 같은 눈금을 쓴다. */
const INVEST_SCALE: AmountScale = SALE_SCALE;

/** 지금 열려 있는 팝업. null이면 닫힘. */
type SheetKind = "region" | "listing" | "price" | "investCategory" | "investAmount" | "dividend";

export function HomeSearchPanel({ tab }: { tab: HomeSearchTab }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [sheet, setSheet] = useState<SheetKind | null>(null);
  /** 이 탭의 강조색 — 아래 테두리·버튼·팝업·슬라이더가 모두 이 값을 쓴다. */
  const accent = ACCENT_BY_TAB[tab];

  // ── 매물 ──────────────────────────────────────────────────────────────
  const [region, setRegion] = useState<string | null>(null);
  const [listing, setListing] = useState<ListingKind | null>(null);
  const [propertyCategory, setPropertyCategory] = useState<string | null>(null);
  const [maxPrice, setMaxPrice] = useState(0);
  /** 임대 전용 — "1억동 이상". 켜면 바 대신 하한선으로 검색한다. */
  const [priceOver, setPriceOver] = useState(false);
  // 지금 거래 종류에 맞는 금액 범위. 종류를 바꾸면 범위 밖으로 나간 값은 버린다
  // (임대 5억을 고른 뒤 매매로 바꾸면 그 값이 새 범위의 최솟값 아래일 수 있다).
  // [2026-09-28 사용자 지시] 종류를 골라야 금액을 고를 수 있다 — 종류에 따라 눈금이
  // 달라지므로, 고르기 전에는 어떤 눈금을 보여 줘야 할지 정할 수 없다.
  const priceScale = listing ? AMOUNT_SCALES[listing] : null;

  // ── 투자 ──────────────────────────────────────────────────────────────
  const [investCategory, setInvestCategory] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [dividend, setDividend] = useState<string | null>(null);

  // 하나라도 고른 것이 있어야 검색 버튼이 살아난다 — 아무 조건 없이 누르면
  // 그냥 목록 전체를 여는 것이라 "검색"이라는 이름이 거짓이 된다.
  const propertyReady = !!region || !!listing || maxPrice > 0 || priceOver;
  const investReady = !!investCategory || amount > 0 || !!dividend;

  function submitProperty() {
    if (!propertyReady) return;
    router.push({
      pathname: "/property",
      params: {
        ...(region ? { region } : {}),
        ...(listing ? { listing } : {}),
        ...(propertyCategory ? { category: propertyCategory } : {}),
        // 체크가 켜져 있으면 상한이 아니라 **하한**으로 보낸다.
        ...(priceOver
          ? { minPrice: String(priceScale?.over ?? RENT_SCALE.over) }
          : maxPrice > 0
            ? { maxPrice: String(maxPrice) }
            : {}),
      },
    });
  }

  function submitInvest() {
    if (!investReady) return;
    router.push({
      pathname: "/invest",
      params: {
        ...(investCategory ? { category: investCategory } : {}),
        ...(amount > 0 ? { maxAmount: String(amount) } : {}),
        ...(dividend ? { dividend } : {}),
      },
    });
  }

  /** 거래 종류 + 매물 종류를 한 줄로 보여 준다("임대 · 아파트"). */
  const listingSummary = listing
    ? [
        t(`homeSearch.listing.${listing}`),
        propertyCategory
          ? listing === "forRent" && propertyCategory === "building"
            ? t("homeSearch.rentBuilding")
            : t(`categories.property.${propertyCategory}`)
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <View style={[styles.panel, { borderColor: accent, backgroundColor: GLASS_FILL }]}>
      {tab === "property" ? (
        <>
          <FieldButton
            icon="location-outline"
            label={t("homeSearch.region")}
            value={region}
            placeholder={t("homeSearch.regionPlaceholder")}
            onPress={() => setSheet("region")}
          />
          <FieldButton
            icon="pricetags-outline"
            label={t("homeSearch.listingKind")}
            value={listingSummary}
            placeholder={t("homeSearch.listingPlaceholder")}
            onPress={() => setSheet("listing")}
          />
          <FieldButton
            icon="cash-outline"
            label={t("homeSearch.price")}
            value={
              priceOver
                ? t("homeSearch.atLeast", { amount: formatVndAmount(priceScale?.over ?? RENT_SCALE.over) })
                : maxPrice > 0
                  ? t("homeSearch.upTo", { amount: formatVndAmount(maxPrice) })
                  : null
            }
            placeholder={
              priceScale ? t("homeSearch.amountAny") : t("homeSearch.pickKindFirst")
            }
            disabled={!priceScale}
            last
            onPress={() => setSheet("price")}
          />
          <SubmitButton
            label={t("homeSearch.searchProperty")}
            enabled={propertyReady}
            accent={accent}
            onPress={submitProperty}
          />
        </>
      ) : (
        <>
          <FieldButton
            icon="layers-outline"
            label={t("homeSearch.category")}
            value={investCategory ? t(`categories.invest.${investCategory}`) : null}
            placeholder={t("homeSearch.categoryPlaceholder")}
            onPress={() => setSheet("investCategory")}
          />
          <FieldButton
            icon="wallet-outline"
            label={t("homeSearch.amount")}
            value={amount > 0 ? t("homeSearch.upTo", { amount: formatVndAmount(amount) }) : null}
            placeholder={
              investCategory ? t("homeSearch.amountAny") : t("homeSearch.pickKindFirst")
            }
            disabled={!investCategory}
            onPress={() => setSheet("investAmount")}
          />
          <FieldButton
            icon="calendar-outline"
            label={t("homeSearch.dividend")}
            value={dividend ? t(`homeSearch.dividendKind.${dividend}`) : null}
            placeholder={t("homeSearch.dividendPlaceholder")}
            last
            onPress={() => setSheet("dividend")}
          />
          <SubmitButton
            label={t("homeSearch.searchInvest")}
            enabled={investReady}
            accent={accent}
            onPress={submitInvest}
          />
        </>
      )}

      {/* ── 하단 팝업들 ───────────────────────────────────────────────── */}

      <BottomSheet
        open={sheet === "region"}
        title={t("homeSearch.regionPlaceholder")}
        onClose={() => setSheet(null)}
      >
        <SheetGroupLabel text={t("homeSearch.regionCity")} />
        {VIETNAM_MUNICIPALITIES.map((r) => (
          <SheetOption
            key={r.name}
            label={r.name}
            accent={accent}
            picked={region === r.name}
            onPress={() => {
              setRegion(region === r.name ? null : r.name);
              setSheet(null);
            }}
          />
        ))}
        <SheetGroupLabel text={t("homeSearch.regionProvince")} />
        {VIETNAM_PROVINCES.map((r) => (
          <SheetOption
            key={r.name}
            label={r.name}
            accent={accent}
            picked={region === r.name}
            onPress={() => {
              setRegion(region === r.name ? null : r.name);
              setSheet(null);
            }}
          />
        ))}
      </BottomSheet>

      {/* 종류는 두 단계다 — 거래 종류를 고르면 같은 팝업 안에서 매물 종류가 이어진다.
          거래 종류마다 고를 수 있는 매물 종류가 다르기 때문에(분양은 아파트/기타뿐)
          두 팝업으로 나누면 "왜 공장이 없지"를 설명할 자리가 없다. */}
      <BottomSheet
        open={sheet === "listing"}
        title={t("homeSearch.listingPlaceholder")}
        onClose={() => setSheet(null)}
      >
        <SheetChipRow
          options={LISTING_KINDS.map((kind) => ({ id: kind, label: t(`homeSearch.listing.${kind}`) }))}
          selected={listing}
          accent={accent}
          onPick={(id) => {
            const kind = id as ListingKind;
            setListing(listing === kind ? null : kind);
            // 거래 종류를 바꾸면 매물 종류는 초기화한다 — 분양에 없는 '공장'이
            // 선택된 채 남아 있으면 결과가 0건인 이유를 알 수 없다.
            setPropertyCategory(null);
            // [2026-09-26] 금액도 초기화한다. 임대(0~10억)와 매매(1억~100억)는 범위가
            // 달라, 임대에서 고른 값이 매매 범위 밖일 수 있다. 남겨 두면 바의 손잡이가
            // 엉뚱한 자리에 붙는다.
            setMaxPrice(0);
            setPriceOver(false);
          }}
        />
        {listing ? (
          <>
            <SheetGroupLabel text={t("homeSearch.category")} />
            {/* 2단계(매물 종류)도 같은 한 줄 칩으로 둔다 — 위는 칩인데 아래만 세로
                목록이면 같은 팝업 안에서 고르는 방식이 두 가지가 된다. */}
            <SheetChipRow
              options={CATEGORY_BY_LISTING[listing].map((id) => ({
                id,
                label:
                  listing === "forRent" && id === "building"
                    ? t("homeSearch.rentBuilding")
                    : t(`categories.property.${id}`),
              }))}
              selected={propertyCategory}
              accent={accent}
              onPick={(id) => {
                setPropertyCategory(propertyCategory === id ? null : id);
                setSheet(null);
              }}
            />
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet open={sheet === "price"} title={t("homeSearch.price")} onClose={() => setSheet(null)}>
        {/* 체크가 켜지면 바는 의미가 없다 — 흐리게 하고 조작도 막는다. */}
        <View pointerEvents={priceOver ? "none" : "auto"} style={priceOver ? styles.dimmed : null}>
          {priceScale ? (
            <AmountSlider value={maxPrice} scale={priceScale} accent={accent} onChange={setMaxPrice} />
          ) : null}
        </View>
        {priceScale ? (
          <CheckRow
            label={t("homeSearch.priceOver", { amount: formatVndAmount(priceScale.over) })}
            checked={priceOver}
            accent={accent}
            onToggle={() => {
              const next = !priceOver;
              setPriceOver(next);
              // 켜면 바의 값은 버린다 — 둘 다 켜져 있으면 무엇으로 검색했는지 알 수 없다.
              if (next) setMaxPrice(0);
            }}
          />
        ) : null}
        <SheetConfirm
          label={t("homeSearch.confirm")}
          enabled={maxPrice > 0 || priceOver}
          accent={accent}
          onPress={() => setSheet(null)}
        />
      </BottomSheet>

      <BottomSheet
        open={sheet === "investCategory"}
        title={t("homeSearch.categoryPlaceholder")}
        onClose={() => setSheet(null)}
      >
        <SheetChipRow
          options={INVEST_CATEGORIES.map((id) => ({ id, label: t(`categories.invest.${id}`) }))}
          selected={investCategory}
          accent={accent}
          onPick={(id) => {
            setInvestCategory(investCategory === id ? null : id);
            setSheet(null);
          }}
        />
      </BottomSheet>

      <BottomSheet
        open={sheet === "investAmount"}
        title={t("homeSearch.amount")}
        onClose={() => setSheet(null)}
      >
        <AmountSlider value={amount} scale={INVEST_SCALE} accent={accent} onChange={setAmount} />
        <SheetConfirm
          label={t("homeSearch.confirm")}
          enabled={amount > 0}
          accent={accent}
          onPress={() => setSheet(null)}
        />
      </BottomSheet>

      <BottomSheet
        open={sheet === "dividend"}
        title={t("homeSearch.dividendPlaceholder")}
        onClose={() => setSheet(null)}
      >
        <SheetChipRow
          options={DIVIDEND_KINDS.map((id) => ({ id, label: t(`homeSearch.dividendKind.${id}`) }))}
          selected={dividend}
          accent={accent}
          onPick={(id) => {
            setDividend(dividend === id ? null : id);
            setSheet(null);
          }}
        />
      </BottomSheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 패널 조각
// ---------------------------------------------------------------------------

/**
 * 패널의 한 줄 — 아이콘 + 항목 이름, 오른쪽에 고른 값. 누르면 팝업이 열린다.
 *
 * [2026-09-26 사용자 지시] 줄마다 두르던 **테두리와 라운딩을 없애고 구분선만** 남긴다.
 * 상자 안에 둥근 상자가 셋 들어 있으면 테두리가 네 겹이 되어(패널 + 줄 3개) 무엇이
 * 무엇을 감싸는지 흐려진다. 마지막 줄에는 선을 긋지 않는다 — 그 아래는 검색 버튼이라
 * 선이 하나 더 있으면 버튼이 목록의 일부처럼 보인다.
 */
function FieldButton({
  icon,
  label,
  value,
  placeholder,
  last,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | null;
  placeholder: string;
  last?: boolean;
  /**
   * [2026-09-28 사용자 지시] 앞 항목을 고르기 전에는 누를 수 없다.
   * 눌러 놓고 "종류를 먼저 고르세요"라고 막는 것보다, 아예 흐리게 두어 순서를
   * 보여 주는 편이 헤매지 않는다.
   */
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = colors.light;
  const picked = !!value;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
      style={({ pressed }) => [
        styles.fieldButton,
        !last ? { borderBottomWidth: 1, borderBottomColor: GLASS_BORDER } : null,
        { opacity: disabled ? opacity.disabled : pressed ? opacity.pressed : 1 },
        // [2026-09-26 사용자 지시] 여기서는 **고른 값만 보여 준다** — 예전처럼 줄
        // 전체를 적색으로 칠하지 않는다. 이 줄은 "무엇을 골랐나"를 적어 두는 자리이고,
        // 실제로 고르는 행위는 팝업에서 일어난다. 적색은 아래 검색 버튼 한 곳에만 쓴다.
      ]}
    >
      {/* [2026-09-26 사용자 지시] 항목마다 흰색 아이콘. */}
      <Ionicons name={icon} size={16} color={theme.onAccent} />
      {/* [2026-09-26 사용자 지시] 항목 이름 한 치수 크게 — caption → bodySmall. */}
      <Text style={[textStyles.bodySmall, { color: theme.onAccent, fontWeight: typography.weight.semibold }]}>
        {label}
      </Text>
      {/* 고른 값은 굵게, 아직 안 고른 안내 문구는 흐리게 — 색을 칠하지 않고도
          "이 줄은 정해졌다"가 한눈에 보인다. */}
      <Text
        style={[
          // [2026-09-26 사용자 지시] 선택값도 한 치수 크게 — bodySmall → body.
          textStyles.body,
          {
            color: picked ? theme.onAccent : GLASS_BORDER,
            fontWeight: picked ? typography.weight.bold : typography.weight.regular,
            flex: 1,
            textAlign: "right",
          },
        ]}
        numberOfLines={1}
      >
        {value ?? placeholder}
      </Text>
      <Ionicons name="chevron-down" size={15} color={theme.onAccent} />
    </Pressable>
  );
}

/** 검색 버튼. 고른 조건이 없으면 비활성 — 배경 rgba(255,255,255,0.6)(사용자 지정). */
function SubmitButton({
  label,
  enabled,
  accent,
  onPress,
}: {
  label: string;
  enabled: boolean;
  accent: string;
  onPress: () => void;
}) {
  const theme = colors.light;
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      style={({ pressed }) => [
        styles.submit,
        {
          // [2026-09-26 사용자 지시] 활성 = **적색 배경 + 흰 글자**.
          // 비활성은 지정하신 rgba(255,255,255,0.6) 그대로 두되 글자는 어둡게 한다 —
          // 흰 반투명 위에 흰 글자는 거의 읽히지 않는다.
          backgroundColor: enabled ? accent : DISABLED_BG,
          opacity: pressed && enabled ? opacity.pressed : 1,
        },
      ]}
    >
      {/* [2026-09-26 사용자 지시] 비활성도 **흰 글자**. 활성(적/청 배경)과 글자색이
          같고 배경만 달라지는 형태다. */}
      <Text style={[textStyles.buttonLabel, { color: theme.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 하단 팝업
// ---------------------------------------------------------------------------

/**
 * 화면 아래에서 올라오는 팝업.
 *
 * 배경(backdrop)을 누르면 닫힌다. 시트 자체를 누른 것이 배경까지 전달되면 고르는
 * 순간 닫혀 버리므로 시트 쪽에서 전파를 막는다.
 */
function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const theme = colors.light;
  // [2026-09-26 사용자 지시] 시트 하단 여백.
  //
  // 이 시트는 Modal이라 화면 맨 아래에서 시작한다. 고정 padding(spacing.xl)만 두면
  // 제스처 바가 있는 기기에서 마지막 선택지와 확인 버튼이 그 아래에 깔려 눌리지 않는다.
  // 기기가 알려 주는 실제 하단 안전영역을 더한다 — 기기마다 값이 다르므로 고정 숫자로는
  // 맞출 수 없다.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.overlay }]} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: theme.background, paddingBottom: spacing.xl + insets.bottom },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.sheetHeader}>
            <Text style={[textStyles.sectionTitle, { color: theme.text, flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
              <Ionicons name="close" size={22} color={theme.secondaryText} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetGroupLabel({ text }: { text: string }) {
  const theme = colors.light;
  return (
    <Text style={[textStyles.caption, styles.sheetGroupLabel, { color: theme.secondaryText }]}>
      {text}
    </Text>
  );
}

function SheetOption({
  label,
  picked,
  accent,
  onPress,
}: {
  label: string;
  picked: boolean;
  accent: string;
  onPress: () => void;
}) {
  const theme = colors.light;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      style={({ pressed }) => [
        styles.sheetOption,
        { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
        picked ? { backgroundColor: accent, borderColor: accent } : null,
      ]}
    >
      <Text style={[textStyles.body, { color: picked ? theme.onAccent : theme.text, flex: 1 }]}>
        {label}
      </Text>
      {picked ? <Ionicons name="checkmark" size={18} color={theme.onAccent} /> : null}
    </Pressable>
  );
}

/**
 * 팝업의 확인 버튼.
 *
 * [2026-09-26 사용자 지시] 금액을 **고르기 전에는 회색**, 고른 뒤에 그 탭의 색
 * (매물 파랑 / 투자 빨강)으로 바뀐다. 슬라이더는 0에서 시작하므로 "아직 안 골랐다"와
 * "0을 골랐다"가 눈으로 구분되지 않는데, 버튼 색이 그 구분을 대신한다.
 */
/**
 * [2026-09-26 사용자 지시] 바로 고를 수 없는 구간("1억동 이상")을 위한 체크 줄.
 *
 * 왜 바를 늘리지 않았나: 임대 월세는 대부분 1억동 아래에 몰려 있다. 바를 100억까지
 * 늘리면 실제로 쓰는 구간이 왼쪽 1%에 뭉쳐 손가락으로는 구분해 고를 수 없다.
 * 그래서 바는 흔한 구간만 담당하고, 그 위는 "이상" 한 칸으로 넘긴다.
 */
function CheckRow({
  label,
  checked,
  accent,
  onToggle,
}: {
  label: string;
  checked: boolean;
  accent: string;
  onToggle: () => void;
}) {
  const theme = colors.light;
  return (
    <Pressable
      testID="price-over-check"
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.checkRow, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={22}
        color={checked ? accent : theme.secondaryText}
      />
      <Text style={[textStyles.body, { color: theme.text, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

function SheetConfirm({
  label,
  enabled,
  accent,
  onPress,
}: {
  label: string;
  enabled: boolean;
  accent: string;
  onPress: () => void;
}) {
  const theme = colors.light;
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      style={({ pressed }) => [
        styles.sheetConfirm,
        {
          backgroundColor: enabled ? accent : theme.border,
          opacity: pressed && enabled ? opacity.pressed : 1,
        },
      ]}
    >
      <Text
        style={[textStyles.buttonLabel, { color: enabled ? theme.onAccent : theme.secondaryText }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 한 줄로 늘어놓는 선택지(가운데 정렬).
 *
 * [2026-09-26 사용자 지시] 거래 종류·투자 종류·배당주기처럼 항목이 짧고 개수가 적은
 * 목록은 세로로 쌓지 않고 한 줄에 편다. 세로 목록은 34개짜리 지역 선택처럼 길이를
 * 가늠할 수 없는 것에만 쓴다.
 *
 * 각 칸을 flex:1로 나눠 폭을 균등하게 준다 — 글자 수가 달라도(예: "분양" vs
 * "배당주기") 칸 크기가 들쭉날쭉하지 않다.
 */
function SheetChipRow({
  options,
  selected,
  accent,
  onPick,
}: {
  options: { id: string; label: string }[];
  selected: string | null;
  accent: string;
  onPick: (id: string) => void;
}) {
  const theme = colors.light;
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const picked = selected === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onPick(o.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: picked }}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
              picked ? { backgroundColor: accent, borderColor: accent } : null,
            ]}
          >
            <Text
              style={[textStyles.caption, { color: picked ? theme.onAccent : theme.text }]}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 금액 슬라이더.
 *
 * 외부 라이브러리를 쓰지 않는다 — 이 프로젝트에는 slider/gesture-handler/reanimated가
 * 하나도 설치돼 있지 않고, 이 하나를 위해 의존성을 더하면 사용자가 설치·빌드를
 * 다시 해야 한다. react-native에 기본으로 들어 있는 PanResponder로 만든다.
 *
 * 팝업 안에 들어가므로 여기서는 테마 색을 쓴다(영상 위가 아니다).
 */
/**
 * 금액 바 — 손잡이는 **눈금에만** 선다.
 *
 * [2026-09-28 사용자 지시] 눈금 값과 간격은 AmountScale이 정한다. 화면에서 눈금 사이는
 * 모두 같은 폭이므로, 0 → 10,000k → 1 tỷ처럼 자릿수가 크게 벌어져도 손가락으로 고를 수
 * 있다(직선 축이면 작은 금액들이 왼쪽 몇 px에 겹친다).
 */
function AmountSlider({
  value,
  scale,
  accent,
  onChange,
}: {
  value: number;
  scale: AmountScale;
  accent: string;
  onChange: (next: number) => void;
}) {
  const theme = colors.light;
  const { t } = useTranslation();
  const [trackWidth, setTrackWidth] = useState(0);
  // PanResponder 안에서는 state가 생성 시점 값으로 고정되므로 ref로 읽는다.
  const widthRef = useRef(0);
  const stopsRef = useRef(scale.stops);
  stopsRef.current = scale.stops;

  function onTrackLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setTrackWidth(w);
  }

  /** 손가락 위치 → 가장 가까운 눈금 값. */
  function valueFromX(x: number): number {
    const w = widthRef.current;
    const stops = stopsRef.current;
    if (w <= 0 || stops.length === 0) return stops[0] ?? 0;
    const ratio = Math.max(0, Math.min(1, x / w));
    const index = Math.round(ratio * (stops.length - 1));
    return stops[index];
  }

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => onChange(valueFromX(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onChange(valueFromX(e.nativeEvent.locationX)),
      }),
    // onChange는 setState라 바뀌지 않는다 — 한 번만 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const lastIndex = Math.max(1, scale.stops.length - 1);
  // 고른 값이 눈금에 없으면(종류를 바꾼 직후) 맨 왼쪽으로 본다.
  const index = scale.stops.indexOf(value);
  const filled = index > 0 ? index / lastIndex : 0;
  const fillWidth = Math.round(trackWidth * filled);

  return (
    <View style={styles.sliderBlock}>
      {/* 고른 금액을 숫자로 띄운다 — 바만 있으면 지금 얼마인지 알 수 없다. */}
      <Text style={[textStyles.statValue, { color: theme.text, textAlign: "center" }]}>
        {value > 0 ? formatVndAmount(value) : t("homeSearch.amountAny")}
      </Text>
      <View
        /* 아직 안 고른 구간은 옅은 회색 — 흰 시트 배경과 구분되어야 바의 끝이 보인다. */
        style={[styles.sliderTrack, { borderColor: theme.border, backgroundColor: theme.border }]}
        onLayout={onTrackLayout}
        {...pan.panHandlers}
      >
        <View style={[styles.sliderFill, { width: fillWidth, backgroundColor: accent }]} />
        {/* 눈금 — 바 위에 세로 선으로 찍는다. 아래 숫자와 세로로 맞춰야 어느 숫자가
            어느 지점인지 알 수 있다. */}
        {scale.stops.map((stop, i) =>
          i === 0 || i === lastIndex ? null : (
            <View
              key={stop}
              pointerEvents="none"
              style={[
                styles.sliderTick,
                { left: `${(i / lastIndex) * 100}%`, backgroundColor: theme.background },
              ]}
            />
          ),
        )}
        <View
          style={[
            styles.sliderThumb,
            {
              left: Math.max(0, fillWidth - 12),
              backgroundColor: theme.background,
              borderColor: accent,
            },
          ]}
        />
      </View>
      {/* 눈금 숫자 — 각 눈금 아래에 하나씩. 양 끝만 적으면 가운데 눈금이 얼마인지
          알 수 없다. */}
      <View style={styles.sliderTickLabels}>
        {scale.stops.map((stop, i) => (
          <Text
            key={stop}
            style={[
              textStyles.caption,
              styles.sliderTickLabel,
              {
                // 숫자를 눈금과 세로로 맞추는 계산.
                //
                // 눈금 i는 바의 i/(N-1) 지점에 있다. 그런데 칸을 똑같이 N등분하면
                // 칸 i의 가운데는 (i+0.5)/N이라 눈금과 어긋난다(6칸이면 15px쯤).
                // 양 끝 칸만 반 폭으로 두면 가운데 칸들의 중심이 정확히 i/(N-1)에
                // 오고, 첫 칸의 왼쪽 끝과 마지막 칸의 오른쪽 끝이 바의 양 끝과 맞는다.
                flex: i === 0 || i === lastIndex ? 0.5 : 1,
                color: i === index ? theme.text : theme.secondaryText,
                fontWeight: i === index ? typography.weight.bold : typography.weight.regular,
                textAlign: i === 0 ? "left" : i === lastIndex ? "right" : "center",
              },
            ]}
            numberOfLines={1}
          >
            {stop > 0 ? formatVndAmount(stop) : "0"}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = createScaledStyles(() => ({
  panel: {
    borderWidth: 1,
    // [2026-09-26 사용자 지시] 위쪽 탭과 맞붙으므로 **위 모서리는 각지게** 둔다.
    // 둥근 상자 위에 각진 탭이 얹히면 탭 아래로 배경이 삐져나와 두 개로 보인다.
    // 왼쪽 위는 탭이 앉는 자리라 각지게 둔다.
    borderTopLeftRadius: 0,
    // [2026-09-26 사용자 지시] 탭이 없는 **오른쪽 위는 둥글게** — 탭 옆으로 이어지는
    // 모서리라, 각져 있으면 탭과 상자가 하나의 덩이로 읽히지 않는다.
    borderTopRightRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    padding: spacing.md,
    // 줄 사이 여백은 구분선이 대신하므로 gap을 없앤다 — 남겨 두면 선과 줄 사이가
    // 떠서 선이 어느 줄에 속한 것인지 알 수 없다.
    gap: 0,
  },
  fieldButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    // [2026-09-26] 테두리·라운딩 없음 — 줄 사이는 아래쪽 구분선 하나로만 나눈다.
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  submit: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },

  // ── 팝업 ────────────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    // 아래에서 올라오는 팝업이라 아래쪽에 붙인다.
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "72%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  // 체크가 켜졌을 때 금액 바를 흐리게 — 지금 무엇으로 검색되는지 헷갈리지 않게.
  dimmed: {
    opacity: 0.35,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetGroupLabel: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  // [2026-09-26 사용자 지시] 한 줄 · 가운데 정렬 선택지.
  //
  // 투자 종류가 7개라 한 줄에 다 들어가야 한다. 칸을 flex:1로 균등 분할하고
  // 좌우 여백을 작게 둬서 좁은 기기에서도 줄바꿈이 일어나지 않게 한다.
  // 글자는 numberOfLines={1}이라 넘치면 잘린다(줄이 두 줄로 벌어지지 않는다).
  chipRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
    // [2026-09-26 사용자 지시] 글자가 잘리는 대신 다음 줄로 넘어가게 한다.
    // "상가/빌딩/오피스"처럼 긴 항목이 한 줄에 억지로 끼면 말줄임으로 잘려
    // 무엇인지 읽을 수 없었다. 줄바꿈을 허용하면 칸이 모자랄 때만 아래로 내려간다.
    flexWrap: "wrap",
  },
  chip: {
    // flex: 1을 뺀다 — 모든 칩을 같은 폭으로 늘리면 가장 긴 글자가 잘린다.
    // 이제 칩은 글자 길이만큼만 차지하고, 줄이 모자라면 위 flexWrap이 내려 준다.
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    // 글자가 테두리에 닿지 않도록 좌우 여백을 준다(예전 2px는 flex로 늘어나는 것이 전제였다).
    paddingHorizontal: spacing.sm,
  },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  sheetConfirm: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },

  // ── 슬라이더 ────────────────────────────────────────────────────────
  sliderBlock: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sliderTrack: {
    height: 24,
    borderWidth: 1,
    borderRadius: radius.full,
    justifyContent: "center",
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    height: 22,
    borderRadius: radius.full,
  },
  sliderThumb: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 3,
  },
  // 눈금 — 바 위 세로선.
  sliderTick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    opacity: 0.9,
  },
  // 눈금 숫자 줄 — 눈금 개수만큼 균등 분할한다.
  sliderTickLabels: {
    flexDirection: "row",
    marginTop: 4,
  },
  sliderTickLabel: {
    // flex는 위에서 눈금 위치에 맞춰 칸마다 따로 준다.
    minWidth: 0,
  },
  sliderEnds: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
}));
