import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import type { Session } from "@supabase/supabase-js";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Input } from "@/components/Input";
import { InvestmentCard } from "@/components/InvestmentCard";
import { Modal } from "@/components/Modal";
import { PropertyListRow } from "@/components/PropertyListRow";
import { SectionHeader } from "@/components/SectionHeader";
import { StatTile } from "@/components/StatTile";
import { Toast } from "@/components/Toast";
import { createScaledStyles, colors, opacity, radius, spacing, textStyles, ThemeColors, typography, FONT_FACTOR, scaleFont } from "@/constants/theme";
import { GOOGLE_ICON_URI } from "@/constants/icons";
import { type MockInvestmentProduct, type MockProperty } from "@/constants/mockData";
import { getPropertiesByIds, listManagedProperties } from "@/services/properties";
import { getInvestmentProductsByIds, listMyInvestmentOrders } from "@/services/investments";
import { canManageInvestment, canRegisterProperty, isAdmin } from "@/services/roles";
import { getMyAgency, renameMyAgency, type MyAgency } from "@/services/agencies";
import { deleteMyAccount, getMyAvatarUrl, uploadMyAvatar } from "@/services/profile";
import { listUnreadAdNotifications, markAdNotificationRead } from "@/services/ads";
import { getUnreadNotificationCount } from "@/services/notifications";
import {
  getAgencyBalance,
  getLatestRejectedPayment,
  listAdBillingSummary,
  sumAdBilling,
  type AgencyBalance,
  type PaymentRequest,
} from "@/services/payments";
import { formatMoneyAmount } from "@/utils/format";
import { SUPPORTED_LANGUAGES, SupportedLanguage } from "@/i18n";
import {
  getSession,
  mapAuthErrorToMessageKey,
  normalizeLoginId,
  onAuthStateChange,
  signInWithApple,
  signInWithGoogle,
  signInWithPassword,
  signOut,
} from "@/services/auth";
import { useFavoritesStore } from "@/store/useFavoritesStore";
import { useLocaleStore } from "@/store/useLocaleStore";
// [STEP: 2026-09-09] 사용자 요청 — MY > 통화 설정에서 베트남/달러를 실제로 선택할 수
// 있게 한다. useLocaleStore(언어)와 동일한 패턴의 새 store.
import { SUPPORTED_CURRENCIES, useCurrencyStore } from "@/store/useCurrencyStore";
import { getVndPerUsd, hydrateExchangeRate, refreshExchangeRate } from "@/services/exchangeRate";
import { useTabRefreshKey } from "@/store/useTabRefreshStore";

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

function MyScreen() {
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

  /**
   * [2026-09-28 사용자 지시] 실시간 환율. 못 받아 오면 null이고, 그때는 통화 버튼을
   * 감춘다 — 틀린 환율로 바꿔 보여 주느니 VND만 보여 주는 편이 낫다.
   */
  const [fxRate, setFxRate] = useState<number | null>(getVndPerUsd());
  useEffect(() => {
    let active = true;
    void hydrateExchangeRate()
      .then(() => refreshExchangeRate())
      .then((rate) => {
        if (active) setFxRate(rate);
      });
    return () => {
      active = false;
    };
  }, []);

  /** 잔액 표기 — 고른 통화로 바꿔서 찍는다. */
  function formatBalance(amountVnd: number): string {
    if (currency === "USD" && fxRate !== null) {
      // 달러는 센트까지 의미가 있다. 동은 소수점이 없다.
      return (amountVnd / fxRate).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return Math.round(amountVnd).toLocaleString("en-US");
  }

  const [session, setSession] = useState<Session | null>(null);
  // [2026-09-11] 아이디/비번 로그인 — 소셜 로그인만 있으면 테스트 계정
  // (중개업소/고객)을 만들 수도, 웹 미리보기에서 로그인할 수도 없다.
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  /** 아이디·비밀번호가 둘 다 채워졌는가 — 로그인 버튼 색이 이 값으로 갈린다. */
  const passwordReady = loginId.trim().length > 0 && loginPassword.length > 0;
  /**
   * [2026-09-26 사용자 지시] 아이디/비밀번호 입력칸은 **"아이디로 로그인"을 눌렀을 때만**
   * 펼친다. 기본 경로는 소셜 로그인이고, 이쪽은 필요한 사람만 쓰는 보조 경로다 —
   * 늘 펼쳐 두면 두 방법이 같은 무게로 보여 무엇을 눌러야 할지 한 번 더 생각하게 된다.
   */
  const [showPasswordLogin, setShowPasswordLogin] = useState(false);
  /**
   * [2026-09-26 사용자 지시] 관심 매물 / 관심 투자를 **메뉴로** 만들고, 눌렀을 때만
   * 목록을 펼친다. 늘 펼쳐 두면 찜한 것이 없어도 두 개의 빈 줄이 자리를 차지한다.
   */
  const [openFavorites, setOpenFavorites] = useState<"property" | "invest" | null>(null);

  /**
   * [2026-09-26 사용자 지시] "관심목록" 타일을 누르면 관심목록이 보이게 한다.
   *
   * 지금까지는 부동산 탭(/property)으로 보냈다 — 관심목록과 아무 상관이 없는 화면이라
   * 눌러도 찜한 것이 안 보였다. 관심목록 섹션은 **이 화면 아래쪽에 이미 있으므로**
   * 다른 화면으로 보내지 않고 그 자리로 스크롤한다.
   */
  const pageScrollRef = useRef<ScrollView>(null);
  const favoritesSectionRef = useRef<View>(null);

  function revealFavorites() {
    const section = favoritesSectionRef.current;
    const scroll = pageScrollRef.current;
    const inner = scroll?.getInnerViewNode();
    if (!section || !scroll || inner == null) return;
    section.measureLayout(
      inner,
      (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 16), animated: true }),
      () => {
        // 측정 실패는 무시 — 화면이 안 움직일 뿐이다.
      },
    );
  }
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  // [2026-09-14] 계정 삭제 — 되돌릴 수 없으므로 반드시 한 번 더 묻는다.
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** [2026-09-11 사용자 지시] 프로필 사진 — 없으면 기존 사람 아이콘을 그대로 쓴다. */
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  /** [2026-09-11 사용자 지시] 업체명 수정 모달. */
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
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

  // [STEP 04] 관심 매물은 이제 Mock이 아니라 실제 properties 테이블에서 가져온다 —
  // 찜 목록(favorites)은 DB에 저장된 매물 UUID이므로 findMockProperty로는 조회되지
  // 않는다. 찜 목록이 바뀔 때마다 해당 id들을 한 번에 조회한다.
  const favoritePropertyIds = useMemo(() => {
    const prefix = "property:";
    return Object.keys(favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }, [favorites]);

  const [favoriteProperties, setFavoriteProperties] = useState<MockProperty[]>([]);

  // [STEP 04] 매물 등록 진입점은 admin 계열에게만 노출한다(실제 차단은 properties
  // RLS가 서버에서 수행 — 이건 UI 가드일 뿐이다). 로그인 상태가 바뀌면 다시 확인한다.
  const [canRegister, setCanRegister] = useState(false);
  // 권한 확인이 끝나기 전에는 등록신청 메뉴를 그리지 않는다 — 이미 승인된 계정에게
  // "부동산 등록신청"이 잠깐 보였다 사라지면 잘못 만든 화면처럼 읽힌다.
  const [permissionChecked, setPermissionChecked] = useState(false);
  const [canManageInvest, setCanManageInvest] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  // [2026-09-11 사용자 지시] 부동산 등록신청 상태. 신청을 마치면 상단에 업체명이 뜨고,
  // 승인되면 매물 등록/매물 정보 메뉴가 열린다(그 판정은 canRegisterProperty가 한다).
  const [agency, setAgency] = useState<MyAgency | null>(null);
  // [2026-09-11 사용자 지시] 승인된 업체만 잔액이 있다 — 사용잔액(쓸 수 있는 돈)을
  // 크게, 현잔액(누적 입금)을 작게 보여 준다.
  // 값은 더 이상 화면에 쓰지 않지만(상단 금액은 아래 광고비 집계가 대신한다),
  // 업체 전환·로그아웃 시 이전 업체의 잔액이 남지 않도록 초기화는 계속한다.
  const [, setBalance] = useState<AgencyBalance | null>(null);
  /**
   * [2026-09-12 사용자 지시] 상단 금액은 이제 "잔액"이 아니라 **광고비 집계**다.
   * 관리자는 전체 업체 합(플랫폼 광고 수익), 업체는 자기 업체 것 — 어느 범위를
   * 돌려줄지는 서버(ad_billing_summary)가 정하고, 여기서는 받은 줄을 더하기만 한다.
   */
  const [adBilling, setAdBilling] = useState({ adSpent: 0, totalDeposited: 0, available: 0 });
  // [2026-09-11 사용자 지시 — 3차] 반려된 광고비 신청이 있으면 환불 예정임을 알린다 —
  // 반려만 하고 아무 말이 없으면 돈이 어디로 갔는지 알 수 없다.
  const [rejectedPayment, setRejectedPayment] = useState<PaymentRequest | null>(null);
  // 나의 활동 숫자 — 내가 등록한 매물 수와 내가 낸 투자신청 수.
  const [myPropertyCount, setMyPropertyCount] = useState(0);
  const [myOrderCount, setMyOrderCount] = useState(0);
  // [2026-09-12] 알림 수신함의 안 읽은 개수. 설정 줄 오른쪽에 숫자로만 붙인다.
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // [2026-09-11 버그 수정] 예전에는 useEffect([session])이었다. MY는 탭 화면이라
  // 언마운트되지 않고 session 객체도 그대로이므로, 관리자가 업체를 승인해도 /
  // 입금을 확인해도 / 매물을 등록해도 이 화면은 **다시 읽지 않았다**. 승인을 받고
  // MY로 와도 매물등록 메뉴가 안 보이고 잔액이 0으로 남아, 로그아웃 후 다시
  // 로그인해야만 반영됐다. useFocusEffect로 바꿔 탭에 들어올 때마다 다시 읽는다.
  useFocusEffect(
    useCallback(() => {
    let mounted = true;
    if (!session) {
      setCanRegister(false);
      setCanManageInvest(false);
      setIsAdminUser(false);
      setAgency(null);
      setBalance(null);
      setAdBilling({ adSpent: 0, totalDeposited: 0, available: 0 });
      setRejectedPayment(null);
      setMyPropertyCount(0);
      setMyOrderCount(0);
      setUnreadNotifications(0);
      setPermissionChecked(false);
      setAvatarUrl(null);
      return;
    }
    getMyAvatarUrl().then((url) => {
      if (mounted) setAvatarUrl(url);
    });
    // [2026-09-12 사용자 지시] 광고비 잔액 소진 알림 — MY에 들어오면 한 번 보여 주고
    // 읽음 처리한다. 푸시 발송이 붙기 전까지는 이 화면이 전달 경로다.
    listUnreadAdNotifications().then((items) => {
      // 잔액 소진이 더 급한 소식이라 그쪽을 먼저 보여 준다.
      const notice =
        items.find((item) => item.kind === "balance_empty") ??
        items.find((item) => item.kind === "slot_dropped");
      if (!mounted || !notice) return;
      setToast(
        notice.kind === "balance_empty" ? t("my.adBalanceEmpty") : t("my.adSlotDropped"),
      );
      setTimeout(() => setToast(null), 3000);
      void markAdNotificationRead(notice.id);
    });
    canRegisterProperty().then((ok) => {
      if (mounted) {
        setCanRegister(ok);
        setPermissionChecked(true);
      }
    });
    canManageInvestment().then((ok) => {
      if (mounted) setCanManageInvest(ok);
    });
    listManagedProperties().then((list) => {
      if (mounted) setMyPropertyCount(list.length);
    });
    listMyInvestmentOrders().then((list) => {
      if (mounted) setMyOrderCount(list.length);
    });
    getUnreadNotificationCount().then((count) => {
      if (mounted) setUnreadNotifications(count);
    });
    listAdBillingSummary().then((rows) => {
      if (mounted) setAdBilling(sumAdBilling(rows));
    });
    isAdmin().then((ok) => {
      if (mounted) setIsAdminUser(ok);
    });
    getMyAgency().then(async (result) => {
      if (!mounted) return;
      setAgency(result);
      if (result && result.approvalStatus === "approved") {
        const [nextBalance, rejected] = await Promise.all([
          getAgencyBalance(result.id),
          getLatestRejectedPayment(),
        ]);
        if (mounted) {
          setBalance(nextBalance);
          setRejectedPayment(rejected);
        }
      } else {
        setBalance(null);
        setRejectedPayment(null);
      }
    });
    return () => {
      mounted = false;
    };
    }, [session, t]),
  );

  useEffect(() => {
    let mounted = true;
    if (favoritePropertyIds.length === 0) {
      setFavoriteProperties([]);
      return;
    }
    getPropertiesByIds(favoritePropertyIds).then((result) => {
      if (mounted) setFavoriteProperties(result);
    });
    return () => {
      mounted = false;
    };
    // favoritePropertyIds는 useMemo 결과라 찜 목록이 바뀔 때만 새 배열이 된다.
  }, [favoritePropertyIds]);

  // [STEP 06] 관심 투자상품도 실제 investment_products 테이블에서 가져온다.
  const favoriteInvestmentIds = useMemo(() => {
    const prefix = "investment_product:";
    return Object.keys(favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }, [favorites]);

  const [favoriteInvestments, setFavoriteInvestments] = useState<MockInvestmentProduct[]>([]);

  useEffect(() => {
    let mounted = true;
    if (favoriteInvestmentIds.length === 0) {
      setFavoriteInvestments([]);
      return;
    }
    getInvestmentProductsByIds(favoriteInvestmentIds).then((result) => {
      if (mounted) setFavoriteInvestments(result);
    });
    return () => {
      mounted = false;
    };
  }, [favoriteInvestmentIds]);

  // [2026-09-12] showComingSoon 제거 — 마지막 사용처였던 "알림" 줄이 실제 화면으로
  // 연결되면서 이 화면에는 '준비 중'인 항목이 하나도 남지 않았다.

  function showToast(message: string, ms = 1600) {
    setToast(message);
    setTimeout(() => setToast(null), ms);
  }

  function openNameModal() {
    setNameDraft(agency?.name ?? "");
    setNameModalVisible(true);
  }

  /** 업체명 저장 — 성공하면 화면의 이름도 바로 바꾼다(다시 조회하지 않는다). */
  async function handleSaveAgencyName() {
    const next = nameDraft.trim();
    if (next.length === 0 || nameSaving) return;

    setNameSaving(true);
    const result = await renameMyAgency(next);
    setNameSaving(false);

    if (!result.ok) {
      // [2026-09-27] 실패 이유를 그대로 띄운다. "변경하지 못했습니다" 한 줄로는
      // owner가 아니어서인지, 이름이 길어서인지, 함수가 없어서인지 알 수 없었다.
      const detail =
        result.reason === "no-agency"
          ? t("my.agencyName.notOwner")
          : result.reason === "name-too-long"
            ? t("my.agencyName.tooLong")
            : `${t("my.agencyName.failed")} (${result.message})`;
      showToast(detail, 4000);
      return;
    }
    setAgency((prev) => (prev ? { ...prev, name: next } : prev));
    setNameModalVisible(false);
    showToast(t("my.agencyName.updated"));
  }

  /**
   * [2026-09-11 사용자 지시] 프로필 아이콘의 편집 버튼 — 사진을 골라 올린다.
   *
   * 업로드 중에는 버튼을 잠근다. 사용자가 연달아 누르면 같은 사람의 아바타가
   * 여러 장 올라가고, 마지막에 끝난 업로드가 avatar_url을 이긴다(고른 순서와
   * 다른 사진이 남을 수 있다).
   */
  async function handlePickAvatar() {
    if (avatarUploading) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast(t("my.avatar.permission"));
      return;
    }
    // [2026-09-12 실기기 테스트에서 발견] 자르기 화면을 쓰지 않는다.
    //
    // allowsEditing이 띄우는 크롭 화면은 **기기 제조사의 것**이라 화면이 제각각이다.
    // 갤럭시 A5에서는 자르기 화면은 뜨는데 확인 버튼이 보이지 않아 업로드 자체가
    // 불가능했다(갤럭시 폴드에서는 정상). 우리가 고칠 수 없는 남의 화면에 기능이
    // 걸려 있는 셈이다.
    //
    // 자르기를 빼도 잃는 것은 거의 없다 — 아바타는 어차피 원형으로 잘라 보여 주므로
    // 정사각형이 아닌 사진도 가운데를 기준으로 동그랗게 보인다.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    setAvatarUploading(true);
    const url = await uploadMyAvatar(result.assets[0].uri);
    setAvatarUploading(false);

    if (!url) {
      showToast(t("my.avatar.failed"));
      return;
    }
    setAvatarUrl(url);
    showToast(t("my.avatar.updated"));
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

  /** 아이디/비번 로그인. `@`가 없는 입력은 테스트 도메인을 붙여 이메일로 만든다. */
  async function handlePasswordLogin() {
    const email = normalizeLoginId(loginId);
    if (email.length === 0 || loginPassword.length === 0) {
      setToast(t("my.passwordLogin.missingFields"));
      setTimeout(() => setToast(null), 1600);
      return;
    }

    setPasswordLoading(true);
    const result = await signInWithPassword(email, loginPassword);
    setPasswordLoading(false);

    if (result.error) {
      setToast(t(mapAuthErrorToMessageKey(result.error)));
      setTimeout(() => setToast(null), 2400);
      return;
    }
    // 성공 시 onAuthStateChange가 세션을 밀어 넣어 화면이 로그인 상태로 바뀐다.
    setLoginPassword("");
  }

  async function handleSignOut() {
    setSigningOut(true);
    const { error } = await signOut();
    setSigningOut(false);
    setToast(error ? t(mapAuthErrorToMessageKey(error)) : t("my.signedOut"));
    setTimeout(() => setToast(null), 1600);
  }

  /**
   * [2026-09-14 사용자 결정] 계정 삭제.
   *
   * 거부 사유(관리자 / 업체 잔액)를 그대로 받아 각각 다른 문구로 안내한다 —
   * "실패했습니다" 한 줄이면 사용자는 다음에 무엇을 해야 할지 알 수 없다.
   *
   * 성공하면 서버가 세션까지 끊었으므로(auth.sessions CASCADE) 곧바로 로그아웃
   * 처리해 화면을 비로그인 상태로 되돌린다.
   */
  async function handleDeleteAccount() {
    setDeletingAccount(true);
    const result = await deleteMyAccount();
    setDeletingAccount(false);
    setDeleteModalVisible(false);

    if (result.ok) {
      await signOut();
      setToast(t("deleteAccount.done"));
      setTimeout(() => setToast(null), 2800);
      return;
    }

    const messageKey =
      result.reason === "admin"
        ? "deleteAccount.failedAdmin"
        : result.reason === "balance"
          ? "deleteAccount.failedBalance"
          : "deleteAccount.failed";
    setToast(t(messageKey));
    setTimeout(() => setToast(null), 3200);
  }

  const isLoggedIn = !!session;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} /* [2026-09-26 사용자 지시] 하단 탭과 내용 사이에 흰 띠가 생기던 문제.
         edges에 "bottom"이 있으면 기기 하단 안전영역만큼 **한 번 더** 여백이 붙는다.
         그런데 탭바가 이미 그만큼 확보하고 있다(app/(tabs)/_layout.tsx의
         height: TAB_BAR_CONTENT_HEIGHT + bottomInset, paddingBottom: bottomInset).
         같은 공간을 두 번 잡아 그 차이가 빈 흰 칸으로 보였다.
         boards.tsx는 처음부터 edges={[]}였고 그 화면에는 이 증상이 없었다. */
      edges={[]}>
      <Header title={t("my.title")} />
      <ScrollView
        ref={pageScrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* [2026-09-27 사용자 지시] 로그인 상태에서만 세로 배치 — 비로그인 화면은
            안내문 한 덩어리뿐이라 기존 가로 배치를 그대로 둔다(열 방향에서 flex:1은
            높이가 0으로 접힐 수 있다). */}
        <Card style={[styles.profileCard, isLoggedIn && styles.profileCardStacked]}>
          {isLoggedIn ? (
            <>
              {/* [2026-09-27 사용자 지시] **계정 부분과 정산(금액) 부분을 세로로 분리.**
                  예전에는 아바타 · 업체명 · 금액이 한 줄에 나란히 있어, 금액이 계정
                  정보의 일부처럼 읽혔다. 이제 위는 계정, 아래는 정산이고 그 사이를
                  가로선으로 끊는다. */}
              <View style={styles.accountRow}>
                {/* 사용자이미지(avatar) 영역은 로그인 상태에서만 표시한다 — 비로그인
                    상태는 아래에서 별도 렌더링(사용자 요청: 좌측 사용자이미지 영역 삭제) */}
                {/* [2026-09-11 사용자 지시] 아이콘 우하단에 편집 버튼 — 누르면 사진을
                    고를 수 있다. 사진이 있으면 아이콘 대신 사진을 원형으로 보여 준다. */}
                <View style={styles.avatarBox}>
                  <View style={[styles.avatar, { backgroundColor: theme.background, borderColor: theme.border }]}>
                    {avatarUrl ? (
                      <Image source={{ uri: avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
                    ) : (
                      <Ionicons name="person-outline" size={AVATAR_ICON_SIZE} color={theme.secondaryText} />
                    )}
                  </View>
                  <Pressable
                    onPress={handlePickAvatar}
                    accessibilityRole="button"
                    accessibilityLabel={t("my.avatar.edit")}
                    disabled={avatarUploading}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.avatarEdit,
                      {
                        backgroundColor: theme.accent,
                        borderColor: theme.background,
                        opacity: avatarUploading ? opacity.disabled : pressed ? opacity.pressed : 1,
                      },
                    ]}
                  >
                    <Ionicons name="camera" size={12} color={theme.onAccent} />
                  </Pressable>
                </View>
                {/* 업체명은 등록신청을 마친 계정에만 있다 — 없는 계정(고객/관리자)은
                    상태·업체명 없이 이메일만 남는다. */}
                <View style={styles.profileText}>
                  {agency ? (
                    <>
                      <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                        {t(`my.agencyStatus.${agency.approvalStatus}`)}
                      </Text>
                      {/* [2026-09-11 사용자 지시] 업체명 옆 수정 버튼.
                          [2026-09-27] owner에게만 보인다 — staff가 눌러도 DB가 막으므로
                          버튼이 있으면 실패만 반복된다. */}
                      <View style={styles.agencyNameRow}>
                        <Text
                          style={[textStyles.cardTitle, styles.agencyName, { color: theme.text }]}
                          numberOfLines={2}
                        >
                          {agency.name}
                        </Text>
                        {agency.roleInAgency === "owner" ? (
                          <Pressable
                            onPress={openNameModal}
                            accessibilityRole="button"
                            accessibilityLabel={t("my.agencyName.edit")}
                            hitSlop={8}
                            style={({ pressed }) => [{ opacity: pressed ? opacity.pressed : 1 }]}
                          >
                            <Ionicons name="create-outline" size={16} color={theme.secondaryText} />
                          </Pressable>
                        ) : null}
                      </View>
                    </>
                  ) : null}
                  {/* [2026-09-27 사용자 지시] 이메일은 정산이 아니라 **계정** 정보다 —
                      금액 블록에서 계정 블록으로 옮겼다. */}
                  <Text style={[styles.balanceEmail, { color: theme.secondaryText }]} numberOfLines={1}>
                    {session?.user.email ?? ""}
                  </Text>
                </View>
              </View>

              <View style={[styles.profileSplit, { borderColor: theme.border }]} />

              {/* 정산 칸 — 사용잔액 24px 주황, 그 아래 현잔액 12px 회색. 잔액이 없는
                  계정(업체가 아니거나 아직 입금 전)도 0으로 보여 준다 — 칸을 비우면
                  계정마다 카드 높이가 달라진다.
                  [2026-09-27] 계정 칸 아래로 내려왔다(예전에는 아바타 우측). */}
              <View style={[styles.balanceBox, styles.balanceBoxStacked]}>
                {/* [2026-09-11 사용자 지시] 단위(VND)만 60% 크기·굵기 없이.
                    금액과 단위를 한 문자열로 두면 굵기·크기를 따로 줄 수 없어
                    숫자와 단위를 나눠 그린다. */}
                {/* [2026-09-12 사용자 지시] 같은 자리를 보는 사람에 따라 다르게 읽는다.
                    · 관리자 — 주황은 **노출광고로 걷힌 금액**(전체 업체 합 = 플랫폼 광고 수익)
                    · 등록자 — 주황은 **남은 잔액**(입금에서 광고비를 뺀 돈)
                    회색은 양쪽 다 입금 합산액이다.

                    등록자에게 "쓴 돈"을 크게 보여 주면 정작 알아야 할 "언제 소진되는가"가
                    보이지 않는다. 반대로 관리자에게 남의 잔액은 의미가 없다. */}
                {/* [2026-09-28 사용자 지시] 금액 우측에 통화 버튼. 누르면 그때 환율로
                    바뀐다. 이 버튼은 MY > 설정의 통화 선택과 같은 값을 쓴다 — 두 자리가
                    따로 놀면 "어느 쪽이 진짜인가"를 알 수 없다. */}
                <View style={styles.balanceAmountRow}>
                  <Text style={[styles.balanceAvailable, { color: theme.warning }]} numberOfLines={1}>
                    {formatBalance(isAdminUser ? adBilling.adSpent : adBilling.available)}
                    <Text style={styles.balanceUnit}> {currency}</Text>
                  </Text>
                  {fxRate !== null ? (
                    <Pressable
                      onPress={() => setCurrency(currency === "VND" ? "USD" : "VND")}
                      accessibilityRole="button"
                      accessibilityLabel={currency === "VND" ? "USD" : "VND"}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.currencyToggle,
                        { borderColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
                      ]}
                    >
                      <Text style={[styles.currencyToggleText, { color: theme.secondaryText }]}>
                        {currency === "VND" ? "USD" : "VND"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={[styles.balanceTotal, { color: theme.secondaryText }]} numberOfLines={1}>
                  {formatBalance(adBilling.totalDeposited)} {currency}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.profileText}>
              {/* [2026-09-26 사용자 지시] 안내 두 줄 가운데 정렬. */}
              <Text style={[textStyles.cardTitle, styles.guestCenter, { color: theme.text }]}>
                {t("my.guestTitle")}
              </Text>
              <Text style={[textStyles.bodySmall, styles.guestCenter, { color: theme.secondaryText }]}>
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
                  <Image
                    source={{ uri: GOOGLE_ICON_URI }}
                    style={styles.googleIcon}
                    resizeMode="contain"
                  />
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

              {/* [2026-09-11] 아이디/비번 로그인.
                  소셜 로그인은 실제 사용자용이고, 이쪽은 역할이 다른 계정
                  (중개업소·고객·관리자)을 번갈아 쓰며 테스트하기 위한 경로다.
                  웹 미리보기는 OAuth 콜백을 처리할 수 없어 이 경로로만 로그인된다.

                  [2026-09-12 사용자 지시] 배포 빌드에서는 __DEV__로 감췄었다.
                  실기기 테스트를 실제 소셜 계정으로만 하기 위해서였다.

                  [2026-09-16 사용자 결정 — 되돌림] **__DEV__를 걷어내고 정식 기능으로
                  되살린다.** 이유는 테스트 편의가 아니라 심사다:
                    · 앱스토어 심사에는 심사자가 쓸 로그인 계정을 제출해야 한다.
                    · 소셜 로그인만 두면 심사자가 낯선 지역·기기에서 접속하게 되어
                      구글 보안 차단에 걸리고, 심사 자체가 정상적으로 진행되지 않는다.
                  그래서 이메일 로그인은 **출시본에 남는다**. 아래 가입 줄도 같은
                  이유로 함께 노출한다 — 로그인은 되는데 가입할 길이 없으면 앞뒤가
                  맞지 않는다(A2 화면은 완성돼 있었으나 진입 경로가 없었다). */}
              <View style={styles.passwordLogin}>
                {/* [2026-09-26 사용자 지시] 이 줄을 눌러야 아래 입력칸이 펼쳐진다.
                    글자는 한 치수 크게, 오른쪽 화살표로 접힘/펼침을 알린다. */}
                <Pressable
                  testID="password-login-toggle"
                  onPress={() => setShowPasswordLogin((prev) => !prev)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showPasswordLogin }}
                  style={({ pressed }) => [
                    styles.passwordLoginToggle,
                    { opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  <Text style={[textStyles.bodySmall, { color: theme.secondaryText, flex: 1 }]}>
                    {t("my.passwordLogin.title")}
                  </Text>
                  <Ionicons
                    name={showPasswordLogin ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={theme.secondaryText}
                  />
                </Pressable>
                {showPasswordLogin ? (
                <View style={[styles.passwordFields, { borderColor: theme.border }]}>
                {/* [2026-09-26 사용자 지시] 타이틀(아이디/비밀번호) 삭제 — 안내는
                    입력창 안 placeholder로만 둔다. Input은 label이 없으면
                    placeholder를 접근성 라벨로 대신 쓴다(components/Input.tsx). */}
                <Input
                  value={loginId}
                  onChangeText={setLoginId}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder={t("my.passwordLogin.idPlaceholder")}
                />
                <Input
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  placeholder={t("my.passwordLogin.passwordPlaceholder")}
                />
                {/* [2026-09-26 사용자 지시] 아이디·비번을 둘 다 넣기 전에는 회색,
                    넣으면 파란 배경 + 흰 글자. 지금 눌러도 되는지가 색으로 보인다. */}
                <Button
                  size="small"
                  title={t("auth.login.submit")}
                  onPress={handlePasswordLogin}
                  loading={passwordLoading}
                  disabled={passwordLoading || !!loadingProvider}
                  style={[
                    styles.passwordSubmit,
                    passwordReady ? { backgroundColor: theme.accent } : { backgroundColor: theme.border },
                  ]}
                  textStyle={{ color: passwordReady ? theme.onAccent : "#666666" }}
                />
                {/* [2026-09-16 확정-결정사항 2] 이메일 가입 진입.
                    app/register.tsx(A2)는 완성돼 있었지만 코드 어디에도
                    router.push("/register")가 없었다 — 로그인 화면을 소셜 전용으로
                    바꾸면서 가입 링크가 사라졌고 대신 넣을 곳을 만들지 않았다.
                    여기가 이미 이메일 로그인이 있는 자리라 가입도 여기 둔다. */}
                <Pressable
                  onPress={() => router.push("/register")}
                  hitSlop={8}
                  style={styles.signUpLink}
                >
                  <Text style={[textStyles.caption, { color: theme.accent }]}>
                    {t("my.passwordLogin.signUpLink")}
                  </Text>
                </Pressable>
                </View>
                ) : null}
              </View>
            </View>
          )}
        </Card>

        {/* [2026-09-11] 로그아웃 — 기존에는 아예 없어서 다른 계정으로 바꿔 로그인할
            방법이 없었다(테스트에 특히 필요). 세션만 지우고 화면 이동은 하지 않는다. */}
        {rejectedPayment ? (
          <View style={[styles.refundBox, { borderColor: theme.danger }]}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
            <Text style={[textStyles.bodySmall, { color: theme.text, flex: 1 }]}>
              {t("my.refundNotice", {
                amount: formatMoneyAmount(rejectedPayment.amount, "VND"),
              })}
            </Text>
          </View>
        ) : null}

        {isLoggedIn ? (
          <View style={styles.accountActions}>
            {/* [2026-09-11 사용자 지시 — 5차] 로그아웃 버튼 좌측 "광고비 정산".
                [2026-09-11 사용자 지시 — 수정] 승인된 업체에만 보인다.
                앞서 canRegister(매물 등록 권한)로 넓혀 두었는데, 그러면 권한만 직접
                받은 계정에도 버튼이 뜨고 눌러 봐야 "승인이 필요합니다"만 나온다 —
                누를 수 없는 버튼을 보여 주는 셈이었다. 정산은 소속 업체의 잔액을
                다루는 일이라 승인 전에는 할 수 있는 것이 아예 없으므로 감춘다.
                payment-info.tsx의 게이트는 그대로 둔다(주소로 직접 들어오는 경우). */}
            {agency?.approvalStatus === "approved" ? (
              <Button
                size="small"
                variant="outline"
                title={t("my.adSettlement")}
                onPress={() => router.push("/payment-info")}
              />
            ) : null}
            {/* [2026-09-11 사용자 지시] 등록권한 신청 — 아래 별도 섹션에 있던 메뉴를
                로그아웃 버튼 왼쪽으로 옮겼다. 조건은 그대로: 아직 매물 등록 권한이
                없는 계정에게만 보인다(이미 승인됐거나 관리자가 권한을 켜 준 계정은
                신청할 이유가 없다). 이미 신청했다면 상태 화면으로 간다. */}
            {permissionChecked && !canRegister ? (
              <Button
                size="small"
                variant="outline"
                title={agency ? t("my.agencyStatusRow") : t("my.agencyApply")}
                onPress={() => router.push("/agency-apply")}
              />
            ) : null}
            <Button
              size="small"
              variant="outline"
              title={signingOut ? t("my.signingOut") : t("my.signOut")}
              onPress={handleSignOut}
              disabled={signingOut}
            />
          </View>
        ) : null}

        {/* [2026-09-11 사용자 지시] "나의 활동"은 로그인 후에만. 로그아웃 상태에서는
            매물 0 / 투자 0 / 관심 0 세 칸이 늘 0으로 남아 아무것도 알려 주지 못하고,
            눌러도 로그인 화면으로 튕긴다. */}
        {isLoggedIn ? (
        <View style={styles.section}>
          <SectionHeader title={t("my.activityTitle")} />
          {/* [STEP: 2026-09-09] 사용자 요청 — "나의 활동" 숫자만 20px로. StatTile은
              invest.tsx 투자개요와 공유하는 컴포넌트라 valueStyle로 이 화면에서만
              오버라이드한다(라벨 크기는 그대로 유지 — 숫자만 지정됨). */}
          <Card style={styles.statsCard}>
            {/* [2026-09-11 사용자 지시 — 4차] 매물 / 투자 / 관심.
                매물 = 내가 등록한 매물, 투자 = 내가 낸 투자신청, 관심 = 찜한 것 전부.
                앞의 둘은 "내가 한 일"이고 관심만 "내가 담아 둔 것"이라, 관심만 합쳐서
                한 칸으로 둔다. */}
            <StatTile
              label={t("my.stats.myProperties")}
              value={String(myPropertyCount)}
              onPress={() => router.push("/my-properties")}
              valueStyle={styles.activityValue}
            />
            <StatTile
              label={t("my.stats.myInvestments")}
              value={String(myOrderCount)}
              // [2026-09-16 확정-결정사항 5] 예전에는 투자 탭으로 보냈다. 모집 기간
              // 필터가 붙은 뒤로는 그 목록에 내 상품이 없을 수 있어(마감되면 숨는다)
              // 내 투자 전용 화면으로 돌린다.
              onPress={() => router.push("/my-investments")}
              valueStyle={styles.activityValue}
            />
            <StatTile
              label={t("my.stats.favorites")}
              value={String(favoriteProperties.length + favoriteInvestments.length)}
              onPress={revealFavorites}
              valueStyle={styles.activityValue}
            />
          </Card>
          {/* [2026-09-28 사용자 지시] 매물/투자/관심 **아래**에 채팅상담 정보.
              위 세 칸과 달리 숫자를 미리 세지 않는다 — 세려면 화면을 열 때마다
              두 테이블을 조회해야 하는데, 이 줄은 그 숫자를 보러 오는 자리가
              아니라 목록으로 넘어가는 자리다. */}
          <Card style={styles.rowsCard}>
            <SettingsRow
              icon="chatbubbles-outline"
              label={t("chatConsults.title")}
              onPress={() => router.push("/chat-consults")}
              theme={theme}
            />
          </Card>
        </View>
        ) : null}

        {/* [STEP 04] 매물 등록 — admin 계열 계정에만 노출되는 운영 진입점. */}
        {canRegister || canManageInvest || isAdminUser ? (
          <View style={styles.section}>
            <SectionHeader title={t("my.adminTitle")} />
            <Card style={styles.rowsCard}>
              {canRegister ? (
                <SettingsRow
                  icon="add-circle-outline"
                  label={t("my.registerProperty")}
                  onPress={() => router.push("/property-register")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-11 사용자 지시] 매물 정보 — 등록한 매물을 공개/완료/보류/추천
                  으로 나눠 보고 상태를 바꾸는 화면. */}
              {canRegister ? (
                <SettingsRow
                  icon="business-outline"
                  label={t("my.myProperties")}
                  onPress={() => router.push("/my-properties")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-12 사용자 지시] 유료 노출광고 — 추천매물 / TOP10 순위 진입.
                  매물 관리(상태 변경)와 목적이 달라 별도 화면으로 뒀다. */}
              {canRegister ? (
                <SettingsRow
                  icon="megaphone-outline"
                  label={t("my.adManage")}
                  onPress={() => router.push("/ad-manage")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-11] 상담 목록 — 담당자는 매물 상세로 들어가면 자기 명의의
                  새 대화가 생겨 고객 상담을 볼 수 없다. 목록이 유일한 진입점이다. */}
              {canRegister ? (
                <SettingsRow
                  icon="chatbubbles-outline"
                  label={t("my.chatInbox")}
                  onPress={() => router.push("/chat-inbox")}
                  theme={theme}
                  last={!canManageInvest}
                />
              ) : null}
              {canManageInvest ? (
                <SettingsRow
                  icon="trending-up-outline"
                  label={t("my.registerInvestment")}
                  onPress={() => router.push("/invest-register")}
                  theme={theme}
                  last={!isAdminUser}
                />
              ) : null}
              {/* [2026-09-11 사용자 지시 — 4차] "계정 권한 관리"와 "등록신청 관리"는
                  둘 다 매물 등록 권한을 주는 경로라 관리자 입장에서 겹쳤다. 등록신청
                  심사 화면 하나로 합치고 이름을 "등록권한 계정관리"로 바꾼다.
                  투자 등록 권한은 투자상품 등록 화면 하단에서 다룬다. */}
              {isAdminUser ? (
                <SettingsRow
                  icon="key-outline"
                  label={t("my.manageRegisterPermission")}
                  onPress={() => router.push("/admin-agencies")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-27 사용자 지시] 푸시(알림) 메시지 — admin 전용.
                  전체/관심 계정/실제 투자자에게 제목·본문·사진·영상·링크를 보낸다. */}
              {isAdminUser ? (
                <SettingsRow
                  icon="paper-plane-outline"
                  label={t("pushMessage.menu")}
                  onPress={() => router.push("/admin-push")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-12 사용자 지시] 허위매물 신고 목록 — admin 전용. */}
              {isAdminUser ? (
                <SettingsRow
                  icon="alert-circle-outline"
                  label={t("my.manageReports")}
                  onPress={() => router.push("/admin-reports")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-11] 입금 관리(요금·QR 설정 + 입금 신고 심사) — admin 전용. */}
              {isAdminUser ? (
                <SettingsRow
                  icon="card-outline"
                  label={t("my.managePayments")}
                  onPress={() => router.push("/admin-payments")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-11 사용자 지시] 게시판 관리 — 공지사항/QA/FAQ. admin 전용. */}
              {isAdminUser ? (
                <SettingsRow
                  icon="chatbubbles-outline"
                  label={t("my.manageBoards")}
                  onPress={() => router.push("/admin-boards")}
                  theme={theme}
                />
              ) : null}
              {/* [STEP T-2] 번역 API 사용량/비용 모니터링 — admin 전용. */}
              {isAdminUser ? (
                <SettingsRow
                  icon="stats-chart-outline"
                  label={t("my.translationUsage")}
                  onPress={() => router.push("/admin-translation-usage")}
                  theme={theme}
                />
              ) : null}
              {/* [2026-09-16 확정-결정사항 3] 계정 권한 관리(M7) 되살림.
                  2026-09-11에 "등록신청 관리와 겹친다"며 진입을 뺐는데, 그 결과
                  investment_manage / property_manage 권한을 **앱에서 줄 방법이
                  사라졌다**. 위 "등록권한 계정관리"(admin-agencies)는 업체 신청
                  심사이지, 개별 계정에 권한을 주는 화면이 아니다.
                  지금까지는 테스트 계정 권한을 SQL로만 넣을 수 있었다 — 3개 기기
                  테스트를 위해 되살린다. 화면(admin-permissions.tsx, 286줄)은
                  완성돼 있어 진입만 붙이면 된다. */}
              {isAdminUser ? (
                <SettingsRow
                  icon="person-add-outline"
                  label={t("my.managePermissions")}
                  onPress={() => router.push("/admin-permissions")}
                  theme={theme}
                  last
                />
              ) : null}
            </Card>
          </View>
        ) : null}

        <View ref={favoritesSectionRef} style={styles.section}>
          <SectionHeader title={t("my.favoritesTitle")} />
          {/* [2026-09-26 사용자 지시] 두 줄을 **메뉴**로 바꾼다 — 누르면 그 아래로
              목록이 펼쳐진다. 목록 모양은 홈의 매물 목록과 같은 PropertyListRow를
              쓴다(가로 카드에서 바꿨다) — 같은 것을 화면마다 다른 모양으로 보여 주지
              않기 위해서다. */}
          <Card style={styles.rowsCard}>
            <SettingsRow
              icon="heart-outline"
              label={t("my.favoritePropertiesTitle")}
              valueLabel={String(favoriteProperties.length)}
              onPress={() =>
                setOpenFavorites((prev) => (prev === "property" ? null : "property"))
              }
              theme={theme}
            />
            {openFavorites === "property" ? (
              favoriteProperties.length === 0 ? (
                <Text style={[textStyles.caption, styles.favoritesEmpty, { color: theme.secondaryText }]}>
                  {t("my.noFavoriteProperties")}
                </Text>
              ) : (
                <View style={styles.favoritesList}>
                  {favoriteProperties.map((property, index) => (
                    <PropertyListRow
                      key={property.id}
                      property={property}
                      showDivider={index > 0}
                      onPress={() => router.push(`/property-detail/${property.id}`)}
                    />
                  ))}
                </View>
              )
            ) : null}

            <SettingsRow
              icon="trending-up-outline"
              label={t("my.favoriteInvestmentsTitle")}
              valueLabel={String(favoriteInvestments.length)}
              onPress={() => setOpenFavorites((prev) => (prev === "invest" ? null : "invest"))}
              theme={theme}
            />
            {openFavorites === "invest" ? (
              favoriteInvestments.length === 0 ? (
                <Text style={[textStyles.caption, styles.favoritesEmpty, { color: theme.secondaryText }]}>
                  {t("my.noFavoriteInvestments")}
                </Text>
              ) : (
                <View style={styles.favoritesList}>
                  {favoriteInvestments.map((product) => (
                    <InvestmentCard
                      key={product.id}
                      product={product}
                      variant="list"
                      onPress={() => router.push(`/invest-detail/${product.id}`)}
                    />
                  ))}
                </View>
              )
            ) : null}
          </Card>
        </View>

        <View style={[styles.section, styles.lastSection]}>
          <SectionHeader title={t("my.settingsTitle")} />
          <Card style={styles.rowsCard}>
            {/* [2026-09-12 사용자 지시] 알림 수신함 — 여기는 "준비 중" 토스트였다.
                푸시는 알림창을 지우면 끝이고 MY 토스트는 몇 초 뒤 사라져, 지나간
                알림을 다시 볼 곳이 없었다. 안 읽은 개수는 숫자로만 붙인다 —
                점과 숫자를 같이 두면 같은 사실을 두 번 말하게 된다. */}
            <SettingsRow
              icon="notifications-outline"
              label={t("my.rows.notifications")}
              valueLabel={unreadNotifications > 0 ? String(unreadNotifications) : undefined}
              onPress={() => router.push("/notifications")}
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
            {/* [2026-09-11 사용자 지시] 게시판 — 공지사항 / FAQ / QA.
                고객센터는 "준비 중" 토스트였는데, 이제 실제로 갈 곳이 생겼다.
                질문을 하러 오는 자리이므로 QA 탭으로 바로 보낸다. */}
            <SettingsRow
              icon="megaphone-outline"
              label={t("my.rows.notices")}
              onPress={() => router.push({ pathname: "/boards", params: { kind: "notice" } })}
              theme={theme}
            />
            <SettingsRow
              icon="help-buoy-outline"
              label={t("my.rows.support")}
              onPress={() => router.push({ pathname: "/boards", params: { kind: "qa" } })}
              theme={theme}
            />
            {/* [2026-09-14] 이용약관·개인정보처리방침 — 본문은 DB(board_posts)에 있다.
                법무법인 원문이 출시 직전에 오므로, 코드에 박아 두면 그때 재빌드해야
                한다. 비로그인 사용자도 읽을 수 있어야 한다(가입 전에 보는 문서다). */}
            <SettingsRow
              icon="document-text-outline"
              label={t("my.rows.terms")}
              onPress={() => router.push({ pathname: "/legal/[kind]", params: { kind: "terms" } })}
              theme={theme}
            />
            <SettingsRow
              icon="shield-checkmark-outline"
              label={t("my.rows.privacy")}
              onPress={() => router.push({ pathname: "/legal/[kind]", params: { kind: "privacy" } })}
              theme={theme}
              last={!isLoggedIn || isAdminUser}
            />
            {/* [2026-09-14] 계정 삭제 — Apple(2022-06~)·Google(2024~) 심사 필수.
                로그인 상태에서만, 그리고 관리자에게는 보이지 않는다(서버도 거부하지만
                누를 수 있는 자리에 두면 눌러 보게 된다). */}
            {isLoggedIn && !isAdminUser ? (
              <SettingsRow
                icon="trash-outline"
                label={t("my.rows.deleteAccount")}
                onPress={() => setDeleteModalVisible(true)}
                theme={theme}
                last
              />
            ) : null}
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

      {/* [2026-09-14] 계정 삭제 확인 — 되돌릴 수 없는 동작이므로 무엇이 사라지고
          무엇이 남는지 먼저 보여 준다. 남는 것(상담 이력)을 함께 적는 이유: 대화가
          통째로 사라지는 줄 알고 망설이는 것을 막기 위해서다. */}
      <Modal
        visible={deleteModalVisible}
        onClose={() => setDeleteModalVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.danger, marginBottom: spacing.sm }]}>
          {t("deleteAccount.title")}
        </Text>
        <Text style={[textStyles.body, { color: theme.text, marginBottom: spacing.xs }]}>
          {t("deleteAccount.body")}
        </Text>
        <Text style={[textStyles.bodySmall, { color: theme.secondaryText, marginBottom: spacing.md }]}>
          {t("deleteAccount.keeps")}
        </Text>
        <Button
          title={deletingAccount ? t("deleteAccount.deleting") : t("deleteAccount.confirm")}
          onPress={handleDeleteAccount}
          disabled={deletingAccount}
          variant="danger"
        />
        <Button
          title={t("common.cancel")}
          onPress={() => setDeleteModalVisible(false)}
          disabled={deletingAccount}
          variant="ghost"
        />
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

      {/* [2026-09-11 사용자 지시] 업체명 수정 — 이름 한 칸만 바꾼다. */}
      <Modal
        visible={nameModalVisible}
        onClose={() => setNameModalVisible(false)}
        accessibilityLabel={t("common.cancel")}
      >
        <Text style={[textStyles.sectionTitle, { color: theme.text, marginBottom: spacing.sm }]}>
          {t("my.agencyName.title")}
        </Text>
        <Input value={nameDraft} onChangeText={setNameDraft} maxLength={60} />
        <View style={styles.nameModalActions}>
          <Button
            style={styles.nameModalButton}
            variant="outline"
            title={t("common.cancel")}
            onPress={() => setNameModalVisible(false)}
          />
          <Button
            style={styles.nameModalButton}
            title={t("common.save")}
            onPress={handleSaveAgencyName}
            disabled={nameSaving || nameDraft.trim().length === 0}
          />
        </View>
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

/**
 * [2026-09-11 사용자 지시] 프로필 아이콘 크기 10% 확대 — 56 → 62(반올림).
 * 안쪽 사람 아이콘도 같은 비율로 키운다(28 → 31).
 */
const AVATAR_SIZE = 62;
const AVATAR_ICON_SIZE = 31;

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  // [STEP: 2026-09-09-7] 사용자 재확인 — home/property/invest 3개 탭 화면과
  // 동일한 영역 간 간격(md=16)으로 통일해, 5개 탭 화면이 모두 같은 기준으로
  // "영역과 영역 사이"가 구분되도록 한다(영역 내부 간격은 sm=8로 공통).
  content: {
    // 사용자 요청: 화면 좌우 여백을 10px로 변경(세로 여백/gap은 기존 유지)
    paddingHorizontal: spacing.screenPaddingX,
    // [2026-09-11 사용자 지시] MY 화면만 위쪽 여백 0 — 회색 띠가 "MY" 줄 바로 아래에
    // 붙어야 한다. 아래쪽은 그대로 둔다(padding-top: 0 / padding-bottom: 24px).
    paddingTop: 0,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  // [2026-09-11 사용자 지시] 상단 MY 영역 바로 아래에 붙는 가로 100% 띠.
  // 테두리는 아래 한 줄만 남기고 모서리 둥글리기와 그림자를 없앤다 — content의
  // 좌우 여백만큼 음수 마진으로 빼내 화면 끝까지 채우고, 안쪽에서 다시 준다.
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: -spacing.screenPaddingX,
    paddingHorizontal: spacing.screenPaddingX,
    borderRadius: 0,
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0,
    elevation: 0,
  },
  // [2026-09-27 사용자 지시] 계정/정산 세로 분리.
  profileCardStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  // 위 칸 — 아바타 + 상태/업체명/이메일.
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  // 계정과 정산을 끊는 가로선.
  profileSplit: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // 편집 버튼(absolute)의 기준점. 아바타와 같은 크기로 둔다.
  avatarBox: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    position: "relative",
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    // 사진이 원형 밖으로 삐져나오지 않게 한다.
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarEdit: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    // 아바타 테두리와 겹쳐도 배지가 분리돼 보이도록 배경색 테두리를 두른다.
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  // 업체명 + 수정 버튼. minWidth:0이 없으면 긴 이름이 버튼을 밀어낸다.
  agencyNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  agencyName: {
    flexShrink: 1,
    minWidth: 0,
  },
  nameModalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  nameModalButton: {
    flex: 1,
  },
  // 아이디/비번 로그인 블록 — 소셜 버튼과 구분되도록 위쪽에 구분선을 둔다.
  // [2026-09-26 사용자 지시] 게스트 안내 두 줄 가운데 정렬.
  guestCenter: {
    textAlign: "center",
  },
  // [2026-09-26 사용자 지시] 로그인 버튼 내부 상하 여백 10px.
  passwordSubmit: {
    paddingVertical: 10,
  },
  // 펼침 줄 — 글자와 화살표를 한 줄에.
  passwordLoginToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  passwordLogin: {
    marginTop: spacing.md,
    // [2026-09-26 사용자 지시 2차] 바깥에서 흰 배경·테두리를 뺀다.
    // 접혀 있을 때는 "아이디로 로그인" 한 줄만 보여야 하는데, 상자가 있으면
    // 내용이 없는 빈 상자가 덩그러니 남았다. 상자는 **펼친 내용 쪽**으로 옮겼다.
    gap: spacing.sm,
  },
  // 펼쳤을 때 아이디·비밀번호·로그인 버튼을 담는 흰 상자.
  favoritesList: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  favoritesEmpty: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  passwordFields: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  // [2026-09-16 확정 2] 이메일 가입 진입 — 로그인 버튼 아래 한 줄. 버튼으로 두면
  // 로그인과 같은 무게로 보여, 무엇을 눌러야 할지 한 번 더 생각하게 된다.
  signUpLink: {
    alignSelf: "center",
    paddingVertical: spacing.xs,
  },
  refundBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  // [2026-09-11 사용자 지시 — 5차] 회색 띠와 버튼 줄 사이 위아래 10px.
  // content가 자식 사이에 spacing.md(16)를 두므로 그만큼 빼서 10만 남긴다.
  accountActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: 10 - spacing.md,
    marginBottom: 10 - spacing.md,
  },
  balanceBox: {
    alignItems: "flex-end",
    minWidth: 0,
  },
  // 세로 분리 후에도 금액은 우측 정렬 — 자리를 넓혀 잡는다.
  balanceBoxStacked: {
    alignSelf: "stretch",
  },
  // 금액 + 통화 버튼 한 줄.
  balanceAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  currencyToggle: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  currencyToggleText: {
    fontSize: scaleFont(12),
    fontWeight: typography.weight.semibold,
  },
  balanceAvailable: {
    fontSize: scaleFont(24, FONT_FACTOR.TITLE),
    fontWeight: typography.weight.bold,
    // [2026-09-28] flexShrink가 없으면 금액이 길 때(VND는 자릿수가 많다) 24px
    // 숫자가 줄 너비를 다 먹고 우측 USD 버튼을 화면 밖으로 밀어낸다 — 줄이
    // 우측 정렬이라 넘치는 쪽이 왼쪽이 아니라 버튼 쪽이다.
    flexShrink: 1,
  },
  // [2026-09-28 사용자 지시] 12px — 굵기는 상속되지 않도록 명시적으로 되돌린다.
  balanceUnit: {
    fontSize: scaleFont(12, FONT_FACTOR.BODY),
    fontWeight: typography.weight.regular,
  },
  balanceTotal: {
    fontSize: scaleFont(12),
  },
  // [2026-09-28 사용자 지시] 14px.
  balanceEmail: {
    fontSize: scaleFont(14),
  },
  signOutButton: {
    alignSelf: "flex-end",
  },
  authButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    // [2026-09-26 사용자 지시] 버튼 묶음 위 여백 30px.
    marginTop: 30,
  },
  authButton: {
    flex: 1,
  },
  authIcon: {
    marginRight: spacing.xs,
  },
  // 사용자 요청: 아이콘 크기 50% 확대(16 → 24) — Image는 Ionicons와 달리 명시적
  // width/height가 필요하다.
  //
  // [2026-09-11 사용자 지시] "구글 아이콘이 애플 로고보다 크다" — 둘 다 24로 두면
  // 실제로 크기가 다르게 보인다. Ionicons의 logo-apple은 24px 글리프 박스 안에
  // 여백을 두고 그려져 그림 자체는 19px 남짓인데, Google 이미지는 여백 없이 G가
  // 가장자리까지 차 있다. 그래서 이미지 쪽만 그 여백만큼 줄여 눈에 보이는 크기를
  // 맞춘다. resizeMode="contain"은 원본 비율이 정사각이 아니어도 잘리지 않게 한다.
  googleIcon: {
    width: 19,
    height: 19,
    marginRight: spacing.xs,
  },
  // [STEP: 2026-09-09] 사용자 요청 — 구글/애플 로그인 버튼 배경을 흰색 + 옅은
  // 테두리로 통일
  socialButton: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    // [2026-09-26 사용자 지시] 버튼 글자와 테두리 사이 상하 여백 10px.
    // Button의 size="small"이 주는 기본 padding을 여기서 덮어쓴다.
    paddingVertical: 10,
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
  // [2026-09-11 사용자 지시] 나의 활동 숫자 30px(이전 xl).
  activityValue: {
    fontSize: scaleFont(30, FONT_FACTOR.TITLE),
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
}));

/**
 * [2026-09-28 사용자 지시] 하단 탭을 누르면 이 화면은 **처음부터 다시 시작한다.**
 *
 * key가 바뀌면 React가 MyScreen를 버리고 새로 만든다 — 필터·펼친 항목·스크롤이
 * 초기값으로 돌아가고, 마운트 시 조회가 다시 돌아 새 정보가 바로 보인다.
 * 껍데기를 따로 둔 이유: 자기 자신의 key는 자기가 바꿀 수 없다.
 */
export default function MyScreenTab() {
  const refreshKey = useTabRefreshKey("my");
  return <MyScreen key={refreshKey} />;
}
