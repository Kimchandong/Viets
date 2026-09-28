import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";
import { setStatusBarBackgroundColor, setStatusBarStyle, setStatusBarTranslucent } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import {
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

import { EmptyState } from "@/components/EmptyState";
import { FadeInText } from "@/components/FadeInText";
import { ACCENT_BY_TAB, HomeSearchPanel } from "@/components/HomeSearchPanel";
import { HorizontalCardCarousel } from "@/components/HorizontalCardCarousel";
import { INVESTMENT_CARD_IMAGE_HEIGHT, InvestmentCard } from "@/components/InvestmentCard";
import { Modal } from "@/components/Modal";
import { PropertyListRow } from "@/components/PropertyListRow";
import { SectionHeader } from "@/components/SectionHeader";
import { Toast } from "@/components/Toast";
import { HOME_HERO_VIDEO_URL } from "@/constants/media";
import { createScaledStyles, colors, FONT_FACTOR, layout, opacity, radius, scaleFont, spacing, textStyles, typography, ThemeColors, textColor } from "@/constants/theme";
import {
  HOME_CATEGORIES,
  HOME_INVEST_CATEGORIES,
  type MockInvestmentProduct,
  type MockProperty,
} from "@/constants/mockData";
import { listProperties } from "@/services/properties";
import { listInvestmentProducts } from "@/services/investments";
import { listBoardPosts, type BoardPost } from "@/services/boards";
import { getNewInvestmentCount, getUnreadChatCount } from "@/services/notifications";
import { chargeAdClick, listActiveAdSlots } from "@/services/ads";
import {
  applyPropertySort,
  DEFAULT_PROPERTY_SORT,
  PropertySortControls,
  type PropertySortState,
} from "@/components/PropertySortControls";
import {
  distanceKm,
  formatDistance,
  getCurrentLocation,
  locationFromRegion,
  selectableRegions,
  type UserLocation,
} from "@/services/location";
import { useTabRefreshKey } from "@/store/useTabRefreshStore";

// STEP 4-9B — Home UI 레이아웃 기반. 실제 Property/Market 데이터 fetch는 하지 않는다
// (constants/mockData.ts의 mock 값만 사용).
//
// [FULL-DEV] 매물 카드 press를 app/property-detail/[id].tsx로 연결했고, 기존에 없던
// "추천 투자상품"(MOCK_INVESTMENT_PRODUCTS 기반) 섹션을 추가해 Home에서도 Invest
// 상세로 바로 진입할 수 있게 했다(§7 요구사항 — Home 최소 구성에 추천 투자상품 포함).
// 위치/알림/시장 소식은 아직 실제 기능이 없다.

/**
 * 앱 언어 → 음성 인식에 넘길 BCP-47 태그. AI 탭(app/(tabs)/ai.tsx)과 같은 표를 쓴다 —
 * 두 곳이 다른 언어로 들으면 같은 말을 해도 결과가 달라진다.
 */
const SPEECH_LOCALES: Record<string, string> = {
  ko: "ko-KR",
  en: "en-US",
  vi: "vi-VN",
  ja: "ja-JP",
  zh: "zh-CN",
  th: "th-TH",
};

/**
 * [2026-09-26 사용자 지시] 히어로 영상 위에 얹는 요소들의 공통 유리판 색.
 * HomeSearchPanel과 같은 값을 쓴다 — 검색창과 그 아래 조건 상자가 한 판처럼 보여야 한다.
 */
const GLASS_BORDER = "rgba(255,255,255,0.5)";
const GLASS_FILL = "rgba(255,255,255,0.2)";
/**
 * [2026-09-26 사용자 지시] 워드마크 "BĐS & REIT"의 **&** 전용 색.
 *
 * 유리판 색(GLASS_*)과 따로 둔다 — 같은 흰색 계열이지만 쓰임이 전혀 다르다.
 * 유리판을 조절할 때 로고 글자까지 함께 흔들리면 안 된다.
 */
const LOGO_AMPERSAND = "rgba(255,255,255,0.6)";

/**
 * [2026-09-26 사용자 지시] 공지 롤링 줄의 글자·아이콘 색 — rgba(255,255,255,0.9).
 *
 * 배경영상 위에 얹히는 줄이라 순백(#FFF)이면 로고·검색창 글자와 같은 무게가 되어
 * 시선을 나눠 가진다. 0.9는 읽히되 한 단계 물러나는 값이다.
 * (이전 0.7(colors.light.onAccentMuted)에서 올린 값이다 — 영상 밝은 장면에서 묻혔다.)
 */
const NOTICE_FOREGROUND = "rgba(255, 255, 255, 0.9)";

function HomeScreen() {
  // STEP 4-12: 항상 light 테마 고정 (검은색 배경 금지, 비로그인 공개 화면)
  const theme = colors.light;
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<string | null>(null);

  // [STEP: 2026-09-09-9] 사용자 요청 — 상단 배너를 정적 이미지에서 영상(무음 반복
  // 재생)으로 교체. 실제 오디오 트랙이 없는 5초 루프 클립이라 muted는 형식상 켜두는
  // 정도지만, 오디오가 있는 영상으로 교체되더라도 배경 장식 용도라 소리가 나지
  // 않도록 항상 muted를 유지한다.
  /**
   * [2026-09-26 사용자 지시] 배경영상을 **Supabase Storage에서** 가져온다.
   *
   * 번들 파일이었을 때는 영상을 바꾸려면 앱을 새로 빌드해 스토어에 다시 올려야 했다.
   * 이제 app-media 버킷의 home/hero.mp4를 교체하면 다음 실행부터 새 영상이 나온다.
   *
   * 번들 파일은 **지우지 않고 대비책으로 남긴다.** 네트워크가 느리거나 끊겼을 때,
   * 또는 아직 파일을 올리지 않았을 때 홈 상단이 빈 채로 남으면 그 위에 얹힌 검색창·
   * 조건 상자(전부 흰 글씨)가 읽히지 않는다. 주소를 만들 수 없으면(환경변수 없음)
   * 번들로 떨어지고, 주소는 있는데 재생에 실패하면 아래 status 감시가 번들로 되돌린다.
   */
  const [heroFellBack, setHeroFellBack] = useState(false);
  const heroVideoSource = useMemo(
    () =>
      !heroFellBack && HOME_HERO_VIDEO_URL
        ? HOME_HERO_VIDEO_URL
        : require("@/assets/videos/home/banner-flag.mp4"),
    [heroFellBack],
  );

  const heroVideoPlayer = useVideoPlayer(heroVideoSource, (player) => {
    player.loop = true;
    // 배경 장식이라 항상 무음이다. 올리는 영상에 오디오 트랙이 있어도 소리가 나지 않는다.
    player.muted = true;
    player.play();
  });

  // 원격 영상이 실패하면 한 번만 번들로 되돌린다. heroFellBack이 true가 되면
  // heroVideoSource가 번들을 가리키고 player가 그 소스로 다시 만들어진다.
  useEffect(() => {
    if (heroFellBack || !HOME_HERO_VIDEO_URL) return;
    const sub = heroVideoPlayer.addListener("statusChange", ({ status, error }) => {
      if (status === "error") {
        console.warn("[home] 배경영상 원격 재생 실패 — 번들 영상으로 대체합니다:", error?.message);
        setHeroFellBack(true);
      }
    });
    return () => sub.remove();
  }, [heroVideoPlayer, heroFellBack]);

  // [STEP S-2, 2026-09-09] 사용자 요청 — 상단 배너가 상태바 영역까지 이어지고(흰
  // 여백 없음) 그 아래 흰 콘텐츠 영역만 좌우 상단이 16px 라운딩되어야 한다. 이
  // 화면(Home)에 포커스가 있는 동안만 상태바를 투명(translucent)+밝은 아이콘으로
  // 전환하고, 다른 탭으로 이동하면(다른 화면은 흰 배경이라 어두운 아이콘이 맞음)
  // 원래 상태로 되돌린다 — 탭 화면들은 전환 시 unmount되지 않으므로
  // expo-status-bar의 "컴포넌트 unmount 시 자동 복원"이 아니라 useFocusEffect로
  // 포커스 진입/이탈 시점에 직접 전환한다.
  // [STEP: 2026-09-09-9] 같은 이유(탭 화면은 전환 시 unmount되지 않음)로, 배너
  // 영상도 Home 탭에 포커스가 없는 동안은 일시정지해 불필요한 배터리/리소스
  // 소모를 막는다.
  useFocusEffect(
    useCallback(() => {
      setStatusBarTranslucent(true);
      setStatusBarStyle("light");
      setStatusBarBackgroundColor("transparent", true);
      heroVideoPlayer.play();
      return () => {
        setStatusBarTranslucent(false);
        setStatusBarStyle("dark");
        setStatusBarBackgroundColor("#ffffff", true);
        heroVideoPlayer.pause();
      };
    }, [heroVideoPlayer])
  );
  // [STEP: 홈 카테고리 2탭 전환] "카테고리" 라벨을 없애고 그 자리를 "부동산 투자"/
  // "부동산 매물" 2개 탭으로 바꿨다.
  // [STEP: 2026-09-08 사용자 요청] 기본 선택 탭을 "부동산 매물"에서 "부동산 투자"로
  // 바꿨다 — 탭에 따라 아래 노출되는 섹션도 달라진다(부동산 투자: 추천 투자상품 +
  // 전체상품(투자 페이지와 동일한 목록) / 부동산 매물: 추천 매물 + 주변 매물 +
  // 시장 동향, 추천 투자상품은 제외).
  // [2026-09-26 사용자 지시] 홈에 처음 들어오면 **매물** 탭이 켜져 있다(예전엔 투자).
  const [categoryTab, setCategoryTab] = useState<"property" | "invest">("property");
  // [STEP: 2026-09-08 사용자 요청] 홈 검색창을 "누르면 /property로 이동만 하는 버튼"에서
  // 실제 텍스트 입력이 가능한 검색창으로 바꿨다 — 커서가 실제로 동작해야 한다는 요청.
  const [homeSearch, setHomeSearch] = useState("");

  // [STEP 04] 매물 목록 실DB 조회. 홈 탭은 다른 탭으로 이동해도 unmount되지 않으므로
  // (§useFocusEffect 주석 참고) 마운트 시 1회 조회한다 — SQL/등록으로 매물이 추가된
  // 경우 앱을 새로고침해야 반영된다(property.tsx와 동일한 정책).
  const [properties, setProperties] = useState<MockProperty[]>([]);
  const [investmentProducts, setInvestmentProducts] = useState<MockInvestmentProduct[]>([]);
  // [2026-09-11 사용자 지시] 홈의 "시장 소식"을 관리자가 올린 공지사항 최신 10건으로
  // 바꾼다. 이전에는 constants/mockData.ts의 MOCK_MARKET_INSIGHTS 3건이 코드에 박혀
  // 있어 내용이 고정이었고, 번역도 되지 않았다(베트남어 원문 그대로).
  const [notices, setNotices] = useState<BoardPost[]>([]);
  const [faqs, setFaqs] = useState<BoardPost[]>([]);
  /**
   * [2026-09-12 사용자 지시] FAQ는 눌러서 그 자리에서 펼친다.
   *
   * 예전에는 어느 줄을 눌러도 게시판 목록으로 나갔다 — 질문 하나가 궁금한 사람이
   * 화면을 떠나 다시 그 질문을 찾아야 했다. 한 번에 하나만 열어 둔다(열려 있던 것은
   * 닫힌다) — 홈 맨 아래 섹션이라 여러 개가 동시에 펼쳐지면 페이지가 길어진다.
   */
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);

  /**
   * [2026-09-26 사용자 지시] FAQ를 펼치면 **답변이 보이는 위치까지 화면을 올린다.**
   *
   * 지금까지는 목록 아래쪽 질문을 누르면 답변이 화면 밖에서 펼쳐져, 눌러도 아무 일도
   * 안 일어난 것처럼 보였다(스스로 스크롤해 내려야 보였다).
   *
   * 측정을 다음 프레임으로 미루는 이유: 같은 프레임에 재면 **펼치기 전** 높이가
   * 잡혀서 답변만큼 덜 올라간다.
   */
  const pageScrollRef = useRef<ScrollView>(null);
  const faqRowRefs = useRef<Record<string, View | null>>({});

  function revealFaq(id: string) {
    requestAnimationFrame(() => {
      const row = faqRowRefs.current[id];
      const scroll = pageScrollRef.current;
      const inner = scroll?.getInnerViewNode();
      if (!row || !scroll || inner == null) return;
      row.measureLayout(
        inner,
        (_x, y) => scroll.scrollTo({ y: Math.max(0, y - FAQ_REVEAL_TOP_GAP), animated: true }),
        () => {
          // 측정 실패는 무시한다 — 스크롤이 안 될 뿐 펼침 자체는 이미 됐다.
        },
      );
    });
  }
  // [2026-09-11 사용자 지시] 상단 우측 알림 두 개 — 부동산(상담 미읽음) / 투자(신규 상품).
  // 숫자는 DB 함수가 센다(services/notifications.ts 주석 참고).
  const [unreadChats, setUnreadChats] = useState(0);
  const [newInvestments, setNewInvestments] = useState(0);

  // [2026-09-11 사용자 지시] 현위치 — 상단 주소 표시 + 매물 거리순 정렬 기준점.
  // 앱을 켜자마자 권한 창을 띄우지 않는다(requestPermission 없이 조회) — 무슨
  // 기능인지 모른 채 거부당하면 되돌리기 어렵다. 위치를 누르거나 거리순을 고를 때 묻는다.
  const [userLocation, setUserLocation] = useState<UserLocation>({
    origin: "none",
    label: "",
    coords: null,
  });
  const [regionPickerOpen, setRegionPickerOpen] = useState(false);
  /**
   * [2026-09-12 사용자 지시] "최근 TOP10" — 광고비 순위를 산 매물 id가 1위부터.
   * 열 자리가 다 차지 않으면 아래에서 최신 매물로 채운다.
   */
  const [top10Ids, setTop10Ids] = useState<string[]>([]);

  /**
   * [2026-09-12 사용자 지시] TOP10 우측의 정렬·조건 칩.
   *
   * 적용 범위가 중요하다: **광고 열 칸을 먼저 뽑고, 그 안에서** 조건에 맞는 것만 남긴다.
   * 전체 매물에 조건을 걸고 나서 광고를 얹으면 광고를 사지 않은 매물이 TOP10에 섞인다.
   */
  const [sortState, setSortState] = useState<PropertySortState>(DEFAULT_PROPERTY_SORT);
  /** 추천 캐러셀의 노출 순서 — 역시 광고비 순위다(금액 높은 매물이 앞). */
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);

  // [2026-09-11 사용자 지시] 화면에 들어올 때마다 다시 조회한다.
  // 이전에는 useEffect(..., [])로 **마운트 시 1회만** 불러왔다. Expo Router는 탭
  // 화면을 언마운트하지 않고 그대로 두므로, 매물을 등록하고 목록 탭으로 돌아와도
  // 새로 등록한 매물이 보이지 않았다(앱을 껐다 켜야 반영됐다).
  // useFocusEffect는 포커스를 받을 때마다 실행되므로 이 문제가 사라진다.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      listProperties().then((result) => {
        if (active) setProperties(result);
      });
      listInvestmentProducts().then((result) => {
        if (active) setInvestmentProducts(result);
      });
      listBoardPosts("notice", i18n.language, { limit: 10 }).then((result) => {
        if (active) setNotices(result);
      });
      listBoardPosts("faq", i18n.language, { limit: 5 }).then((result) => {
        if (active) setFaqs(result);
      });
      // 화면에 들어올 때마다 다시 센다 — 상담을 읽고 돌아오면 숫자가 줄어야 한다.
      getUnreadChatCount().then((count) => {
        if (active) setUnreadChats(count);
      });
      getNewInvestmentCount().then((count) => {
        if (active) setNewInvestments(count);
      });
      // 노출 판정(잔액 소진·자리 수)은 DB가 한다 — 화면은 결과 순서만 받는다.
      listActiveAdSlots("top10").then((ids) => {
        if (active) setTop10Ids(ids);
      });
      listActiveAdSlots("featured").then((ids) => {
        if (active) setFeaturedIds(ids);
      });
      // 위치는 포커스마다 다시 잡지 않는다 — 아래 마운트 1회 useEffect가 맡는다.
      return () => {
        active = false;
      };
    }, [i18n.language]),
  );

  /**
   * [2026-09-11 사용자 지시] 앱을 켜면 자동으로 위치를 잡는다 — 시스템 권한 팝업을
   * 첫 진입에 띄운다.
   *
   * 포커스마다가 아니라 마운트 1회로 둔 이유: useFocusEffect 안에 두면 탭을 오갈
   * 때마다 위치를 다시 잡아 배터리를 쓴다. 권한 팝업 자체는 OS가 한 번만 띄우고
   * (getCurrentLocation이 canAskAgain을 확인한다), 거부한 뒤에는 좌측 상단
   * "위치 설정"을 눌러 지역을 직접 고를 수 있다.
   */
  useEffect(() => {
    let active = true;
    getCurrentLocation({ requestPermission: true }).then((next) => {
      if (active && next.origin !== "none") setUserLocation(next);
    });
    return () => {
      active = false;
    };
  }, []);

  function submitHomeSearch() {
    const query = homeSearch.trim();
    router.push({ pathname: "/property", params: query ? { search: query } : {} });
  }

  /**
   * [2026-09-14] 음성 검색 — 예전에는 "준비 중" 토스트만 띄우던 자리다.
   *
   * 받아 적은 말은 /property가 아니라 **AI 탭으로** 넘긴다. 말로 하는 검색은
   * "하노이 20억 이하 아파트 3룸"처럼 문장으로 나오는데, /property의 검색은
   * 제목·주소 부분 일치라 그런 문장으로는 한 건도 못 찾는다. 문장을 조건으로
   * 푸는 것은 services/aiSearch.ts가 하는 일이므로 그쪽으로 보낸다
   * (검색창 안내문도 "부동산 Ai, 음성검색"이다).
   */
  const [listening, setListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const spokenRef = useRef("");

  useEffect(() => {
    try {
      setSpeechAvailable(ExpoSpeechRecognitionModule.isRecognitionAvailable());
    } catch {
      // 네이티브 모듈이 없는 빌드(Expo Go·웹)에서도 화면은 떠야 한다.
      setSpeechAvailable(false);
    }
  }, []);

  function showVoiceToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  // 말하는 동안 검색창에 글자가 쌓이게 해 제대로 알아듣고 있는지 눈으로 보이게 한다.
  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    spokenRef.current = transcript;
    setHomeSearch(transcript);
  });

  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    const spoken = spokenRef.current.trim();
    if (spoken.length === 0) return;
    // run:"1" — 문장이 이미 완성돼 있으므로 AI 탭에서 바로 찾는다. 손으로 친 검색어를
    // 넘길 때(q만)는 고칠 기회를 주려고 자동으로 찾지 않는다.
    router.push({ pathname: "/ai", params: { q: spoken, run: "1" } });
  });

  useSpeechRecognitionEvent("error", (event) => {
    setListening(false);
    // "아무 말도 못 들었다"는 오류가 아니라 흔한 일이다 — 조용히 넘긴다.
    if (event.error === "no-speech" || event.error === "aborted") return;
    showVoiceToast(event.error === "not-allowed" ? t("ai.voiceDenied") : t("ai.voiceFailed"));
  });

  const handleVoicePress = useCallback(async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }

    try {
      // 권한은 누를 때 묻는다 — 화면에 들어오자마자 물으면 무엇에 쓰는지 모른 채 거부하기 쉽다.
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        showVoiceToast(t("ai.voiceDenied"));
        return;
      }

      spokenRef.current = "";
      setHomeSearch("");
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: SPEECH_LOCALES[i18n.language] ?? SPEECH_LOCALES.en,
        interimResults: true,
        continuous: false,
      });
    } catch {
      setListening(false);
      showVoiceToast(t("ai.voiceFailed"));
    }
  }, [listening, t, i18n.language]);

  // [STEP 04] 홈의 매물 섹션(추천/주변·최근)도 Mock(MOCK_PROPERTIES) 대신 실제
  // Supabase properties 테이블을 읽는다 — app/(tabs)/property.tsx와 동일하게
  // services/properties.ts의 listProperties()(status='active'만 조회)를 쓴다.
  // [STEP 06] 투자상품도 실제 investment_products 테이블로 전환(시장동향은 DB 없음 — Mock 유지).
  /**
   * [2026-09-12 사용자 지시] 추천 캐러셀은 광고 자리 다섯 개다 — 클릭 단가 순위로
   * DB(active_ad_slots)가 정하며, 잔액이 바닥난 업체의 매물은 여기서 빠진다.
   */
  const featured = useMemo(() => {
    // 광고 자리를 산 매물(잔액이 남아 실제로 노출되는 것)만, DB가 준 순위 그대로.
    if (featuredIds.length > 0) {
      const byId = new Map(properties.map((property) => [property.id, property]));
      return featuredIds
        .map((id) => byId.get(id))
        .filter((property): property is MockProperty => !!property);
    }
    // 광고가 하나도 없을 때만 관리자가 수동으로 켜 둔 featured를 보여 준다.
    return properties.filter((property) => property.featured);
  }, [properties, featuredIds]);

  /**
   * [2026-09-12 사용자 결정] 홈의 TOP10은 **유료 광고 자리 10칸**이다.
   *
   * 예전에는 광고가 열을 못 채우면 남는 자리를 최신 매물로 채웠다. 그런데 그렇게 하면
   * 광고를 산 매물과 그냥 올라온 매물이 같은 줄에 섞여, 사용자에게는 둘이 구분되지
   * 않고 광고주에게는 "돈을 낸 자리"가 무엇인지 흐려진다. 빈 칸은 비워 둔다 — 파는
   * 자리가 열 칸이라는 사실이 화면에 그대로 보이는 편이 정직하다.
   *
   * 목록은 properties에서 직접 뽑는다. 예전에는 nearby(= featured 플래그를 뺀 목록)에서
   * 뽑았는데, 관리자가 추천으로 켜 둔 매물이 TOP10 광고를 사면 그 매물이 두 목록 모두에서
   * 빠져 **어디에도 보이지 않는 일**이 있었다(2026-09-12 실기기 테스트).
   */
  const top10 = useMemo(() => {
    const byId = new Map(properties.map((property) => [property.id, property]));
    const paid = top10Ids
      .map((id) => byId.get(id))
      .filter((property): property is MockProperty => !!property)
      .slice(0, HOME_LIST_LIMIT);
    // 열 칸을 먼저 정하고 그 안에서만 고른다 — 순서가 반대면 광고가 아닌 매물이 올라온다.
    return applyPropertySort(paid, sortState, userLocation.coords);
  }, [properties, top10Ids, sortState, userLocation.coords]);

  /**
   * [2026-09-12 사용자 지시] 광고로 노출된 매물을 누르면 그 매물의 클릭 단가가
   * 차감된다. 차감 결과를 기다리지 않고 바로 이동하는 이유: 과금은 광고주와
   * 플랫폼 사이의 일이고, 그것 때문에 고객의 화면 전환이 늦어지면 안 된다.
   * 광고가 아닌 매물(순위 밖·빈 자리를 채운 최신 매물)은 아무 일도 하지 않는다.
   */
  function openProperty(propertyId: string, placement: "featured" | "top10") {
    const adIds = placement === "featured" ? featuredIds : top10Ids;
    if (adIds.includes(propertyId)) {
      void chargeAdClick(propertyId, placement);
    }
    router.push(`/property-detail/${propertyId}`);
  }

  /** 매물까지의 거리 문구 — 기준점과 좌표가 다 있을 때만. */
  function distanceLabel(property: MockProperty): string {
    if (!userLocation.coords || property.latitude === undefined || property.longitude === undefined) {
      return "";
    }
    return formatDistance(
      distanceKm(userLocation.coords, {
        latitude: property.latitude,
        longitude: property.longitude,
      }),
    );
  }

  /**
   * 위치 표시를 눌렀을 때 / 거리순을 골랐을 때.
   * 권한이 있으면 현위치를 쓰고, 없으면 지역을 고르게 한다(사용자 결정).
   */
  async function resolveLocation() {
    const next = await getCurrentLocation({ requestPermission: true });
    if (next.origin === "none") {
      setRegionPickerOpen(true);
      return;
    }
    setUserLocation(next);
  }
  const recommendedInvestments = investmentProducts.filter((product) => product.featured);
  // [STEP: 2026-09-08] "전체상품" 섹션 — invest.tsx의 "전체상품"(전체보기 없이 항상
  // 노출되는 전체 목록) 섹션과 동일하게 featured가 아닌 상품만 별도로 나열한다
  // (featured 상품은 위 "추천 투자상품" 캐러셀에서 이미 보여주므로 중복 노출하지
  // 않는다 — invest.tsx의 featured/others 분리와 동일한 원칙).
  const investAllProducts = investmentProducts.filter((product) => !product.featured);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        ref={pageScrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* [STEP: 2026-09-09-9] 사용자 요청 — 상단 배너를 정적 이미지에서 사용자가
            제공한 영상(무음 반복 재생)으로 교체. 기존 ImageBackground 대신 heroBanner
            View 안에 절대위치 VideoView를 깔고 그 위에 기존 로고/위치/알림/검색창을
            그대로 얹는 구조로 바꿨다 — heroBanner 자체의 레이아웃(padding/gap/
            overflow)과 그 아래 body와의 관계는 전혀 건드리지 않는다. */}
        <View testID="home-hero-banner" style={[styles.heroBanner, { paddingTop: insets.top + spacing.md }]}>
          <VideoView
            player={heroVideoPlayer}
            style={styles.heroBannerVideo}
            contentFit="cover"
            nativeControls={false}
            allowsPictureInPicture={false}
            pointerEvents="none"
          />
          {/* [2026-09-26 사용자 지시] 영상 위에 rgba(0,0,0,0.3) 어둡게 깔기.
              영상과 그 위 글자(전부 흰색) 사이에 두는 얇은 막이라, 영상이 밝은
              장면으로 넘어가도 글자가 묻히지 않는다.
              pointerEvents="none" — 이 막이 터치를 먹으면 아래 검색창·탭이 눌리지 않는다. */}
          <View style={styles.heroScrim} pointerEvents="none" />
          <View testID="home-top-bar" style={styles.topBar}>
            <View>
              <FadeInText
                style={[textStyles.screenTitle, { color: theme.onAccent, fontSize: typography.size.brandLogo }]}
                // 삼각형의 크기·위치는 글자 크기에서 계산된다(FadeInText 참고).
                // 고정 px로 두면 화면이 커질 때 글자만 커지고 삼각형은 그대로라 점처럼 보인다.
                cornerFontSize={typography.size.brandLogo}
                /* [2026-09-26 사용자 지시] 워드마크 교체: "REIT VIET" → "BDS & REIT in VIETNAM".
                   · "&"만 bold를 빼 앞뒤 두 낱말이 각각 덩어리로 읽히게 한다
                   · "in VIETNAM"은 절반 크기(typography.size.brandLogoSmall) */
                segments={[
                  // [2026-09-26 사용자 지시] BDS → **BĐS**. 베트남어 "Bất Động Sản"(부동산)의
                  // 약자이고, Đ는 베트남어 알파벳의 독립 글자(D와 다른 문자)다.
                  // [2026-09-26 사용자 지시] B와 R의 **좌측 상단 모서리**에 삼각형.
                  // B는 파랑, R은 빨강 — 탭 강조색(ACCENT_BY_TAB)과 같은 값이라
                  // 로고와 화면의 두 색이 따로 놀지 않는다.
                  //
                  // 삼각형은 구간의 **첫 글자**에만 붙으므로, B와 R을 각각 한 글자짜리
                  // 구간으로 떼어 낸다("BĐS " → "B" + "ĐS ").
                  { text: "B", style: { fontWeight: typography.weight.bold }, cornerColor: ACCENT_BY_TAB.property },
                  { text: "ĐS ", style: { fontWeight: typography.weight.bold } },
                  // [2026-09-26 사용자 지시] &만 한 치수 작게(brandLogo 22 → xl 18) + 흐린 흰색.
                  // xl은 brandLogo와 같은 TITLE factor를 쓰므로 화면 폭이 바뀌어도
                  // 두 글자의 크기 비율이 유지된다.
                  {
                    text: "& ",
                    style: {
                      fontWeight: typography.weight.regular,
                      fontSize: typography.size.xl,
                      color: LOGO_AMPERSAND,
                    },
                  },
                  { text: "R", style: { fontWeight: typography.weight.bold }, cornerColor: ACCENT_BY_TAB.invest },
                  { text: "EIT ", style: { fontWeight: typography.weight.bold } },
                  {
                    text: "in VIETNAM",
                    style: {
                      fontWeight: typography.weight.regular,
                      fontSize: typography.size.brandLogoSmall,
                    },
                  },
                ]}
              />
              {/* 사용자 요청: 로고 아래 위치 표기(아이콘+텍스트+화살표) 전체를 70% 불투명도로. */}
              {/* [2026-09-11 사용자 지시] 현위치. 예전에는 "Thành phố Hồ Chí Minh"가
                  코드에 박혀 있었고 눌러도 "준비 중"이었다. 이제 실제 위치를 읽어
                  구/시 이름을 보여 주고, 권한이 없으면 눌렀을 때 지역을 고르게 한다. */}
              <Pressable
                style={[styles.locationRow, { opacity: 0.7 }]}
                onPress={resolveLocation}
                accessibilityRole="button"
              >
                <Ionicons name="location-outline" size={14} color={theme.onAccent} />
                <Text style={[textStyles.caption, { color: theme.onAccent }]} numberOfLines={1}>
                  {userLocation.label || t("home.locationUnknown")}
                </Text>
                <Ionicons name="chevron-down" size={12} color={theme.onAccent} />
              </Pressable>
            </View>
            {/* [2026-09-11 사용자 지시] 종 아이콘을 빼고 부동산 / 투자 두 개로 바꿨다.
                종은 고정 목업 숫자에 눌러도 "준비 중"이라 알림 역할을 한 적이 없다.
                부동산 = 내가 읽지 않은 매물 상담 메시지 수 → 상담 목록으로.
                투자   = 마지막으로 본 뒤 올라온 투자상품 수 → 투자 탭으로. */}
            <View style={styles.topIcons}>
              <AlertIconButton
                icon="business-outline"
                count={unreadChats}
                badgeColor={theme.danger}
                accessibilityLabel={t("tabs.property")}
                onPress={() => router.push("/chat-inbox")}
              />
              <AlertIconButton
                icon="trending-up-outline"
                count={newInvestments}
                badgeColor={theme.danger}
                accessibilityLabel={t("tabs.invest")}
                onPress={() => router.navigate("/invest")}
              />
            </View>
          </View>

          {/* 사용자 요청(2026-09-08): 실제 입력 가능한 검색창으로 교체 — 검색 아이콘/
              돋보기를 누르거나 키보드 검색(enter)을 누르면 /property로 검색어와 함께
              이동한다(property.tsx가 search 쿼리 param을 초기값으로 읽는다).
              [2026-09-14] 마이크는 실제 음성 인식에 연결됐고, 받아 적은 문장은
              AI 탭으로 넘긴다(위 handleVoicePress 주석 참고). */}
          <View
            testID="home-search-bar"
            /* [2026-09-26 사용자 지시] 배경영상 위 유리판 — 테두리
               rgba(255,255,255,0.6) / 배경 rgba(255,255,255,0.3).
               테마 토큰이 아니라 리터럴을 쓰는 이유: 이 값들은 "영상 위"라는
               맥락에서만 의미가 있고, 그 맥락이 사라지면 흰색 알파는 아무 데도
               쓸 수 없다. 같은 이유로 HomeSearchPanel도 같은 두 값을 공유한다. */
            style={[
              styles.searchBar,
              { backgroundColor: GLASS_FILL, borderColor: GLASS_BORDER },
            ]}
          >
            <Pressable onPress={submitHomeSearch} accessibilityRole="button" hitSlop={8}>
              <Ionicons name="search" size={18} color={theme.onAccent} />
            </Pressable>
            <TextInput
              value={homeSearch}
              onChangeText={setHomeSearch}
              onSubmitEditing={submitHomeSearch}
              placeholder={t("home.searchPlaceholder")}
              placeholderTextColor={colors.light.onAccentMuted}
              returnKeyType="search"
              autoCorrect={false}
              // [STEP: 2026-09-08] 사용자 요청 — 검색창 내부 텍스트를 caption 크기로 축소.
              // [STEP: 2026-09-09-11] 사용자 요청 — 검색창 미리보기(placeholder)
              // 글씨를 px로 고정한다 (공용 caption 토큰은 디바이스별로 moderateScale이
              // 적용돼 값이 흔들릴 수 있어, 이 입력창만 명시적으로 고정).
              // [2026-09-11 사용자 지시] 한 치수 크게 — 12 → 13.
              style={[textStyles.caption, styles.searchInput, { color: theme.onAccent, fontSize: textStyles.bodySmall.fontSize }]}
            />
            {/* [2026-09-11 사용자 지시] 음성검색 아이콘 크게(18 → 22).
                [2026-09-14] 인식기가 없는 기기에서는 버튼을 그리지 않는다 — 눌러도
                안 되는 버튼을 남겨 두는 것이 예전 "준비 중" 버튼과 같은 실수다. */}
            {speechAvailable ? (
              <Pressable
                onPress={handleVoicePress}
                accessibilityRole="button"
                accessibilityState={{ selected: listening }}
                accessibilityLabel={listening ? t("ai.voiceStop") : t("ai.voiceHint")}
                hitSlop={8}
              >
                <Ionicons
                  name={listening ? "stop-circle" : "mic-outline"}
                  size={22}
                  color={listening ? theme.danger : theme.onAccent}
                />
              </Pressable>
            ) : null}
          </View>

          {/* [2026-09-26 사용자 지시] 투자/매물 토글을 **배경영상 위, 그 하단으로** 옮긴다.
              예전에는 흰 본문(body)의 첫 섹션이었다.

              위치는 marginTop:"auto"로 잡는다 — heroBanner가 이제 고정 높이(600)라
              남는 세로 공간을 이 한 줄이 전부 밀어내고 맨 아래에 붙는다. 고정
              top/bottom 값을 주면 검색창·공지 줄의 유무나 기기별 상단 안전영역
              (insets.top)에 따라 위치가 어긋난다.

              heroBanner.paddingBottom(26) 위에 앉으므로, 아래 bodyMask가 -16으로
              겹쳐 올라와도 토글을 가리지 않는다.

              [2026-09-26] 트랙(둥근 회색 배경)은 없앴다 — 이제 탭 버튼 각자가
              배경을 갖는다(활성 흰색 / 비활성 rgba(255,255,255,0.6)). */}
          {/* [2026-09-26 사용자 지시] 탭과 아래 상자를 **붙인다**.
              heroBanner는 자식 사이에 gap:lg를 주므로 탭과 패널을 그대로 형제로
              두면 24px이 벌어진다. 둘을 한 덩이로 감싸 그 안에서 gap을 0으로 둔다.
              맨 아래로 내려보내는 marginTop:"auto"도 탭이 아니라 이 덩이가 갖는다 —
              탭에 남겨 두면 탭만 내려가고 패널은 따라가지 않는다. */}
          <View testID="home-search-group" style={styles.heroSearchGroup}>
          <View
            testID="home-category-tab-row"
            style={styles.categoryTabRow}
          >
            {/* [2026-09-26 사용자 지시] **고른 탭이 항상 왼쪽으로 온다.**
                고정 순서(매물 → 투자)가 아니라 활성 탭을 먼저 그린다 — 지금 보고 있는
                것이 늘 같은 자리(맨 왼쪽)에 있어야 아래 상자가 무엇의 조건인지
                헷갈리지 않는다.

                배열을 직접 정렬하지 않고 활성 탭을 앞에 두는 순서를 만들어 넘긴다.
                key를 탭 이름으로 주므로 React가 같은 버튼이 자리를 옮긴 것으로 알고
                다시 만들지 않는다(누른 순간 깜빡이지 않는다). */}
            {(categoryTab === "invest"
              ? (["invest", "property"] as const)
              : (["property", "invest"] as const)
            ).map((key) => (
              <CategoryTabButton
                key={key}
                label={t(`home.categoryTabs.${key}`)}
                active={categoryTab === key}
                accent={ACCENT_BY_TAB[key]}
                onPress={() => setCategoryTab(key)}
                theme={theme}
              />
            ))}
          </View>

          {/* [2026-09-26 사용자 지시] 탭 바로 아래 조건 상자. 탭에 따라 내용이 통째로
              바뀐다(매물: 지역·거래종류·매물종류 / 투자: 종류·투자액·배당주기).
              검색 버튼을 누르면 조건을 들고 해당 목록 화면으로 이동한다. */}
          <HomeSearchPanel tab={categoryTab} />
          </View>

          {/* [2026-09-11 사용자 지시] 공지 5건을 아래에서 위로 올라가는 롤링으로 보여 준다.
              공지가 없으면 줄 자체를 그리지 않는다(빈 줄만 떠 있게 되므로).

              [2026-09-26 사용자 지시] 위치를 **검색 상자 아래**로 옮겼다. 예전에는
              검색창과 상자 사이에 있었는데, 그 자리에서는 검색창 → 공지 → 탭으로
              이어져 검색 흐름이 한 번 끊겼다. 지금은 검색에 필요한 것(검색창 · 탭 ·
              조건 상자)이 붙어 있고, 공지는 그 아래 별개의 줄로 읽힌다. */}
          {notices.length > 0 ? (
            <NoticeTicker
              items={notices.slice(0, 5)}
              onPress={(notice) => router.push(`/board-detail/${notice.id}`)}
            />
          ) : null}
        </View>

        {/* [STEP: 2026-09-09 재작업] 기존에는 이 아래 전체를 content의 padding/gap
            안에 그대로 두고, heroBanner에는 음수 marginHorizontal/marginTop으로
            "bleed"를, 이 View에는 음수 marginTop으로 "겹침"을 각각 계산해 상쇄하는
            방식이었다 — content의 flex gap이 margin과 별개로 항상 추가되는 RN
            동작과 겹쳐 두 번이나 어긋났다(기기별로 상단/우측 여백이 뜨거나 검색창
            아래 간격이 사라지는 형태로 재발). 그래서 계산으로 상쇄하는 구조 자체를
            없앴다: heroBanner는 이제 content의 padding 바깥(직접 자식)에 있어 화면
            가로/상단 끝까지 자동으로 채워지고, 아래 body는 그 바로 다음 형제로
            내려와 배너의 paddingBottom(30px)만큼만 자연스럽게 떨어진다 — 더 이상
            상쇄할 gap도, 겹쳐야 할 margin도 없다. 라운딩된 흰 카드 배경/좌우 padding도
            섹션마다 개별 지정하지 않고 body 하나로 통일했다. */}
        <View testID="home-body-mask" style={styles.bodyMask}>
        <View testID="home-body" style={[styles.body, { backgroundColor: theme.background }]}>
        <View testID="home-section-category-tabs" style={styles.section}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.bleedScroll}
            contentContainerStyle={styles.categoryRow}
          >
            {categoryTab === "property"
              ? HOME_CATEGORIES.map((category) => (
                  <CategoryIconButton
                    key={category.id}
                    icon={category.icon}
                    label={t(`categories.property.${category.id}`)}
                    onPress={() =>
                      router.push({ pathname: "/property", params: { category: category.id } })
                    }
                    theme={theme}
                  />
                ))
              : HOME_INVEST_CATEGORIES.map((category) => (
                  <CategoryIconButton
                    key={category.id}
                    icon={category.icon}
                    label={t(`categories.invest.${category.id}`)}
                    onPress={() =>
                      router.push({ pathname: "/invest", params: { category: category.id } })
                    }
                    theme={theme}
                  />
                ))}
          </ScrollView>
        </View>

        {categoryTab === "property" ? (
          <View testID="home-section-property-featured" style={styles.section}>
            <SectionHeader
              title={t("home.featuredTitle")}
              icon="business-outline"
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/property")}
            />
            {/* [2026-09-26 사용자 지시] 추천을 **"최근 TOP10"과 같은 행 목록**으로 바꾼다.
                (앞선 시도에서 카드 썸네일의 모서리·배지만 맞췄는데, 요구는 레이아웃
                자체였다 — 큰 가로 카드가 아니라 왼쪽 작은 썸네일 + 오른쪽 정보 행.)

                가로 캐러셀을 걷어내도 광고 노출 문제는 없다. 캐러셀 자동재생은
                "다섯 자리 중 1~2위만 보인다"를 풀려고 넣은 것인데, 세로 목록은
                다섯 자리가 한 번에 다 보이므로 목적이 그대로 달성된다.

                TOP10과 같은 컴포넌트(PropertyListRow)·같은 컨테이너(propertyList)를
                쓴다 — 복사본을 만들면 다음 디자인 수정 때 한쪽만 바뀐다. */}
            {featured.length === 0 ? (
              <EmptyState title={t("property.emptyTitle")} description={t("property.emptyDescription")} />
            ) : (
              <View style={styles.propertyList}>
                {featured.map((property, index) => (
                  <PropertyListRow
                    key={property.id}
                    property={property}
                    distance={distanceLabel(property)}
                    showDivider={index > 0}
                    onPress={() => openProperty(property.id, "featured")}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {categoryTab === "invest" && recommendedInvestments.length > 0 ? (
          <View testID="home-section-invest-recommended" style={styles.section}>
            <SectionHeader
              title={t("home.recommendedInvestTitle")}
              icon="trending-up-outline"
              actionLabel={t("common.seeAll")}
              onAction={() => router.push("/invest")}
            />
            <HorizontalCardCarousel
              style={styles.bleedScroll}
              contentContainerStyle={styles.featuredRow}
              step={layout.featuredCardWidth + spacing.md}
              arrowCenterY={INVESTMENT_CARD_IMAGE_HEIGHT / 2}
            >
              {recommendedInvestments.map((product) => (
                <InvestmentCard
                  key={product.id}
                  product={product}
                  variant="featured"
                  onPress={() => router.push(`/invest-detail/${product.id}`)}
                />
              ))}
            </HorizontalCardCarousel>
          </View>
        ) : null}

        {/* [STEP: 2026-09-08] "부동산 투자" 탭일 때 아래로 investment 페이지(invest.tsx)의
            "전체상품" 섹션과 동일한 목록을 그대로 노출한다 — 사용자 지시("전체상품
            (투자페이지 그대로)"). */}
        {categoryTab === "invest" ? (
          <View testID="home-section-invest-all" style={styles.section}>
            {/* 사용자 요청(2026-09-09): 홈화면 부동산투자 탭의 이 섹션 제목만
                invest.tsx와 별도 문구("투자 전체")로 바꾼다 — invest.tsx 자체의
                "전체 상품" 섹션(같은 t("invest.allProductsTitle") 키)은 그대로 둔다. */}
            <SectionHeader title={t("home.allInvestProductsTitle")} />
            {investAllProducts.length === 0 ? (
              /* [2026-09-16 웹 검증에서 발견 — 결함] 이 섹션은 featured를 뺀 목록을
                 그리는데, 빈 상태 문구는 "상품이 없습니다 / 다른 위험도를 선택해
                 보세요"였다. 등록된 상품이 **전부 추천에 들어 있으면** 바로 위
                 캐러셀에 세 건이 보이는데 아래에서는 "상품이 없습니다"라고 말한다
                 — 지금 운영 DB가 정확히 그 상태다. invest.tsx에서 고친 것과 같은
                 방식으로, 상품 자체가 없을 때와 전부 추천에 있을 때를 나눈다. */
              <EmptyState
                title={t("invest.emptyTitle")}
                description={
                  investmentProducts.length > 0
                    ? t("invest.allInFeaturedDescription")
                    : t("invest.emptyDescription")
                }
              />
            ) : (
              <View style={styles.stack}>
                {investAllProducts.map((product) => (
                  <InvestmentCard
                    key={product.id}
                    product={product}
                    variant="list"
                    onPress={() => router.push(`/invest-detail/${product.id}`)}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {categoryTab === "property" ? (
          <View testID="home-section-property-nearby" style={styles.section}>
            {/* [2026-09-12 사용자 지시] 타이틀 우측에 정렬 칩. 조건은 광고 열 칸
                안에서만 적용된다(위 top10 참고). */}
            <View style={styles.top10Header}>
              <View style={styles.top10HeaderTitle}>
                <SectionHeader title={t("home.top10Title")} />
              </View>
              <PropertySortControls
                value={sortState}
                onChange={setSortState}
                theme={theme}
                hasLocation={!!userLocation.coords}
                onNeedLocation={resolveLocation}
              />
            </View>

            {/* [STEP 04] 실DB 전환 후에는 등록된 매물이 0건일 수 있어(초기 운영
                상태), 섹션 헤더만 덩그러니 남지 않도록 EmptyState를 노출한다 —
                위 "투자 전체" 섹션과 동일한 패턴. */}
            {top10.length === 0 ? (
              <EmptyState title={t("property.emptyTitle")} description={t("property.emptyDescription")} />
            ) : (
              <View style={styles.propertyList}>
                {top10.map((property, index) => (
                  <PropertyListRow
                    key={property.id}
                    property={property}
                    distance={distanceLabel(property)}
                    showDivider={index > 0}
                    onPress={() => openProperty(property.id, "top10")}
                  />
                ))}
              </View>
            )}
          </View>
        ) : null}

        {/* [2026-09-11 사용자 지시] 공지사항 / FAQ — 홈 맨 아래에 항상 둔다.
            처음에는 "매물 탭에서만, 글이 있을 때만"으로 만들었는데 두 조건 모두
            사용자 지시로 없앴다. 공지와 FAQ는 매물에만 해당하는 내용이 아니라 두
            탭 어디서나 같은 자리에 있어야 하고, 글이 없을 때 섹션째 사라지면
            "기능이 없는 것"과 "아직 글이 없는 것"이 구분되지 않는다. */}
        <View testID="home-section-notice" style={styles.section}>
          <SectionHeader
            title={t("home.noticeTitle")}
            actionLabel={t("common.seeAll")}
            onAction={() => router.push({ pathname: "/boards", params: { kind: "notice" } })}
          />
          {notices.length === 0 ? (
            <EmptyState title={t("home.noticeEmpty")} />
          ) : (
            /* [2026-09-12 사용자 지시] 줄마다 두르던 상자(테두리+회색 배경)를 없애고,
               줄과 줄 사이에만 점선을 둔다. 상자는 각 공지를 따로 떨어진 카드로 보이게
               하는데, 공지는 위에서 아래로 훑는 목록이라 구분선 하나면 충분하다.
               맨 윗줄에는 선이 없다(위에 섹션 제목이 이미 경계를 만든다). */
            <View style={styles.noticeList}>
              {/* [2026-09-11 사용자 지시] 썸네일 형식 — 좌측 이미지, 우측 제목(2줄까지),
                  제목 아래 작성일. 첨부가 없는 공지도 같은 자리를 차지해야 줄들이
                  들쭉날쭉해지지 않으므로, 이미지가 없으면 같은 크기의 자리표시를 둔다. */}
              {notices.map((notice, index) => (
                <Pressable
                  key={notice.id}
                  onPress={() => router.push(`/board-detail/${notice.id}`)}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.noticeRow,
                    index > 0 ? styles.noticeRowDivided : null,
                    { opacity: pressed ? opacity.pressed : 1 },
                  ]}
                >
                  {notice.images.length > 0 ? (
                    <Image
                      source={{ uri: notice.images[0] }}
                      style={styles.noticeThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.noticeThumb, styles.noticeThumbEmpty, { backgroundColor: theme.background }]}>
                      <Ionicons name="megaphone-outline" size={20} color={theme.secondaryText} />
                    </View>
                  )}
                  <View style={styles.noticeTexts}>
                    <Text style={[textStyles.bodySmall, { color: theme.text }]} numberOfLines={2}>
                      {notice.title}
                    </Text>
                    <Text style={[textStyles.caption, { color: theme.secondaryText }]}>
                      {notice.createdAt.slice(0, 10)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* FAQ — 공지보다 적게(5건) 보여 준다. 자주 묻는 질문은 훑어보는 목록이라
            홈에서 열 줄을 차지하면 공지를 밀어낸다. 전체는 게시판에서 본다. */}
        <View testID="home-section-faq" style={[styles.section, styles.lastSection]}>
          <SectionHeader
            title={t("home.faqTitle")}
            actionLabel={t("common.seeAll")}
            onAction={() => router.push({ pathname: "/boards", params: { kind: "faq" } })}
          />
          {faqs.length === 0 ? (
            <EmptyState title={t("home.faqEmpty")} />
          ) : (
            /* [2026-09-12 사용자 지시] 목록 줄에는 배경도 테두리도 없다.
               상자가 줄마다 있으면 다섯 줄이 다섯 개의 덩어리로 보여 "훑어보는 목록"이
               아니라 카드 모음이 된다. 상자는 펼친 답변에만 남긴다 — 그래야 지금 열려
               있는 것이 어디까지인지 한눈에 들어온다. */
            <View style={styles.faqList}>
              {faqs.map((faq) => {
                const open = openFaqId === faq.id;
                return (
                  <View
                    key={faq.id}
                    ref={(node) => {
                      faqRowRefs.current[faq.id] = node;
                    }}
                  >
                    <Pressable
                      onPress={() => {
                        const next = open ? null : faq.id;
                        setOpenFaqId(next);
                        // 접을 때는 움직이지 않는다 — 보던 자리가 흔들린다.
                        if (next) revealFaq(faq.id);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      style={({ pressed }) => [
                        styles.faqRow,
                        { opacity: pressed ? opacity.pressed : 1 },
                      ]}
                    >
                      {/* [2026-09-12 사용자 지시] Q는 주황색. theme.warning이 이 앱의
                          주황이다(#F2994A) — 새 색을 하드코딩하면 다크 테마에서 대비가
                          깨지므로 토큰을 쓴다. */}
                      <Text style={[styles.faqMark, { color: theme.warning }]}>Q</Text>
                      <Text
                        style={[
                          textStyles.bodySmall,
                          styles.faqTitle,
                          { color: theme.text, fontWeight: open ? "700" : "400" },
                        ]}
                        numberOfLines={open ? undefined : 2}
                      >
                        {faq.title}
                      </Text>
                      <Ionicons
                        name={open ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={theme.secondaryText}
                      />
                    </Pressable>

                    {open ? (
                      <View
                        style={[
                          styles.faqAnswer,
                          { backgroundColor: theme.card, borderColor: theme.border },
                        ]}
                      >
                        {/* [2026-09-26 사용자 지시] 답변 글자 한 치수 작게 — bodySmall → caption 크기.
                            잘림 방지를 위해 numberOfLines는 두지 않는다(전체가 다 나와야 한다). */}
                        <Text
                          style={[
                            textStyles.bodySmall,
                            { color: theme.secondaryText, fontSize: textStyles.caption.fontSize },
                          ]}
                        >
                          {faq.body}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </View>
        </View>
        </View>
      </ScrollView>
      {/* 위치 권한이 없을 때 — 기준 지역을 직접 고르게 한다(사용자 결정). */}
      <Modal visible={regionPickerOpen} onClose={() => setRegionPickerOpen(false)}>
        <Text style={[textStyles.sectionTitle, { color: theme.text }]}>{t("home.regionPickerTitle")}</Text>
        <Text style={[textStyles.caption, { color: theme.secondaryText, marginTop: spacing.xs }]}>
          {t("home.regionPickerHint")}
        </Text>
        {selectableRegions().map((region) => (
          <Pressable
            key={region}
            onPress={() => {
              setUserLocation(locationFromRegion(region));
              setRegionPickerOpen(false);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.regionOption,
              { borderBottomColor: theme.border, opacity: pressed ? opacity.pressed : 1 },
            ]}
          >
            <Text style={[textStyles.body, { color: theme.text }]}>{region}</Text>
          </Pressable>
        ))}
      </Modal>

      <Toast visible={!!toast} message={toast ?? ""} variant="info" />
    </View>
  );
}

/**
 * [2026-09-11 사용자 지시] 공지 롤링 — 한 줄 높이만 차지하고, 한 건씩 아래에서
 * 위로 올라오며 바뀐다.
 *
 * 목록 전체를 길게 이어 붙여 흘리는 대신 "한 건씩 교체"로 만든 이유: 높이를 글자
 * 한 줄로 제한해야 해서(사용자 지시) 어차피 한 번에 한 건만 보이고, 교체 방식이면
 * 공지 건수가 몇 건이든 애니메이션 거리가 항상 같아 속도가 들쭉날쭉하지 않는다.
 *
 * useNativeDriver를 웹에서 끄는 이유: react-native-web에는 네이티브 애니메이션
 * 모듈이 없어 켜 두면 콘솔에 경고를 남기고 JS 구동으로 되돌아간다 — 동작은 같지만
 * 경고가 쌓여 실제 문제를 가린다.
 */
// [2026-09-26 사용자 지시] 롤링 글자를 한 치수 키우면서 창 높이도 함께 올린다.
// 이 창은 overflow:"hidden"으로 한 줄만 잘라 보여 주므로, 글자만 키우면 위아래가 잘린다.
const TICKER_LINE_HEIGHT = 22;

/** FAQ를 펼쳤을 때 질문 줄 위에 남길 여백(px) — 화면 맨 위에 딱 붙으면 답답하다. */
const FAQ_REVEAL_TOP_GAP = 16;

/**
 * FAQ 한 줄의 높이 — Q 글자와 질문 글자가 **같은 값을 써야** 첫 줄이 서로 맞는다.
 *
 * 함수인 이유: 화면 폭이 바뀌면 textStyles의 크기가 갱신되는데, 상수로 두면
 * 앱이 처음 뜰 때의 값에 묶인다(이 파일의 다른 크기들과 같은 이유).
 */
const FAQ_LINE_HEIGHT = () => Math.round(textStyles.bodySmall.fontSize * 1.4);
const TICKER_HOLD_MS = 3000;
const TICKER_SLIDE_MS = 400;

/**
 * [2026-09-11 사용자 지시] 알림 수가 붙는 상단 아이콘 버튼.
 *
 * 숫자가 0보다 크면 테두리가 배지 색으로 깜박인다 — "숫자가 떠 있다"는 것만으로는
 * 배너 영상 위에서 잘 안 보인다는 지적이 있었다.
 *
 * useNativeDriver를 쓰지 않는 이유: 색을 오가는 애니메이션은 네이티브 드라이버가
 * 다루지 못한다(레이아웃·투명도·변형만 가능). 테두리 하나짜리라 JS 구동으로 충분하다.
 *
 * 깜박임은 숫자가 0이 되면 즉시 멈추고 기본 테두리로 돌아간다 — 멈추지 않으면 볼
 * 것이 없는데도 계속 시선을 끈다.
 */
// [2026-09-11 사용자 지시] 알림 버튼 배경/테두리 — 흰 반투명에서 검은 반투명으로.
// 배너 영상이 밝을 때 흰 배경 위 흰 아이콘이 묻혀 보였다.
/** [2026-09-12 사용자 지시] 홈 매물 목록은 10건까지만. */
const HOME_LIST_LIMIT = 10;

const IDLE_BORDER = "rgba(255,255,255,0.3)";
const ICON_BUTTON_BG = "rgba(0,0,0,0.3)";
/** [2026-09-11 사용자 지시] 알림 아이콘 글리프 크기 — 20의 10% 축소. */
const ALERT_ICON_SIZE = 18;

function AlertIconButton({
  icon,
  count,
  badgeColor,
  accessibilityLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  badgeColor: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (count <= 0) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [count, pulse]);

  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [IDLE_BORDER, badgeColor],
  });

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.iconButton,
            {
              backgroundColor: ICON_BUTTON_BG,
              borderWidth: count > 0 ? 1 : StyleSheet.hairlineWidth,
              borderColor: count > 0 ? borderColor : IDLE_BORDER,
              opacity: pressed ? opacity.pressed : 1,
            },
          ]}
        >
          {/* [2026-09-11 사용자 지시] 아이콘만 10% 축소(20 → 18).
              버튼 크기(styles.iconButton)와 배지는 건드리지 않는다. */}
          <Ionicons name={icon} size={ALERT_ICON_SIZE} color={colors.light.onAccent} />
          {count > 0 ? (
            <View style={[styles.notificationBadge, { backgroundColor: badgeColor }]}>
              <Text style={styles.notificationBadgeText} numberOfLines={1}>
                {count > 9 ? "9+" : count}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      )}
    </Pressable>
  );
}

function NoticeTicker({
  items,
  onPress,
}: {
  items: BoardPost[];
  onPress: (notice: BoardPost) => void;
}) {
  const [index, setIndex] = useState(0);
  const translateY = useRef(new Animated.Value(TICKER_LINE_HEIGHT)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const useNative = Platform.OS !== "web";

  useEffect(() => {
    if (items.length === 0) return;

    let cancelled = false;
    translateY.setValue(TICKER_LINE_HEIGHT);
    fade.setValue(0);

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: TICKER_SLIDE_MS, useNativeDriver: useNative }),
      Animated.timing(fade, { toValue: 1, duration: TICKER_SLIDE_MS, useNativeDriver: useNative }),
    ]).start();

    // 공지가 한 건뿐이면 그대로 둔다 — 같은 문장이 계속 위아래로 움직이면 읽기만 힘들다.
    if (items.length === 1) return;

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -TICKER_LINE_HEIGHT,
          duration: TICKER_SLIDE_MS,
          useNativeDriver: useNative,
        }),
        Animated.timing(fade, { toValue: 0, duration: TICKER_SLIDE_MS, useNativeDriver: useNative }),
      ]).start(() => {
        if (!cancelled) setIndex((prev) => prev + 1);
      });
    }, TICKER_HOLD_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [index, items.length, fade, translateY, useNative]);

  // index는 계속 커지므로 나머지 연산으로 되돌린다 — 공지 건수가 줄어도 범위를 벗어나지 않는다.
  const current = items[index % items.length];
  if (!current) return null;

  return (
    <Pressable
      onPress={() => onPress(current)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.ticker, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      {/* [2026-09-26 사용자 지시] 글자 앞 스피커(확성기) 아이콘 — **롤링에서 제외.**
          그래서 tickerViewport(잘라내는 창) 바깥에 둔다. 안에 넣으면 글자와 함께
          위아래로 쓸려 올라가 버린다. 공지 목록 화면(megaphone-outline)과 같은 모양이다. */}
      <Ionicons name="megaphone-outline" size={14} color={NOTICE_FOREGROUND} />
      <View style={styles.tickerViewport}>
        <Animated.Text
          numberOfLines={1}
          style={[
            textStyles.caption,
            styles.tickerText,
            // [2026-09-26 사용자 지시] 롤링 글자색 rgba(255,255,255,0.9).
            // 투명도를 color에 직접 넣는다 — style.opacity는 이미 등장/퇴장
            // 애니메이션(fade)이 쓰고 있어 거기에 0.9를 곱하면 슬라이드 중간값이
            // 흐트러진다.
            { color: NOTICE_FOREGROUND, opacity: fade, transform: [{ translateY }] },
          ]}
        >
          {current.title}
        </Animated.Text>
      </View>
    </Pressable>
  );
}

function CategoryTabButton({
  label,
  active,
  accent,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  /** 이 탭의 강조색 — 매물 파랑 / 투자 빨강(HomeSearchPanel의 ACCENT_BY_TAB). */
  accent: string;
  onPress: () => void;
  theme: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.categoryTabButton,
        // [2026-09-26 사용자 지시] 활성 탭은 **그 탭의 색 + 흰 글씨**
        // (매물 파랑 / 투자 빨강). 아래 패널 테두리도 같은 색이라, 탭과 상자가
        // 한 덩이로 읽힌다. 비활성은 rgba(255,255,255,0.6) 배경 + 흰 글씨 그대로.
        // 비활성 배경은 유리판 배경과 같은 값(0.2)이라, 꺼진 탭이 상자와 한 면처럼 보인다.
        { backgroundColor: active ? accent : GLASS_FILL, opacity: pressed ? opacity.pressed : 1 },
      ]}
    >
      <Text
        style={[
          textStyles.bodySmall,
          { color: theme.onAccent, fontWeight: typography.weight.semibold },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryIconButton({
  icon,
  label,
  onPress,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  theme: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.categoryItem, { opacity: pressed ? opacity.pressed : 1 }]}
    >
      <View style={styles.categoryIcon}>
        <Ionicons name={icon} size={22} color={theme.accent} />
      </View>
      {/* [2026-09-26 사용자 지시] label → bodySmall로 키웠다가 **다시 한 치수 작게** 되돌린다.
          아이콘 간격만 좁힌 상태는 그대로 둔다(글자 크기와 별개 지시였다). */}
      <Text style={[textStyles.label, { color: textColor(theme, "label") }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = createScaledStyles(() => ({
  container: {
    flex: 1,
  },
  // [STEP: 2026-09-09 재작업] 더 이상 여기서 좌우/상단 padding이나 gap을 주지
  // 않는다 — heroBanner가 이 padding을 상쇄해야 화면 가장자리까지 채워지는 기존
  // 구조(음수 margin 계산)가 여러 차례 어긋난 원인이었다(§ body 주석 참고). 이제
  // padding/gap은 전부 banner 아래 body 하나가 책임진다.
  content: {},
  // [STEP: 2026-09-08] 상단 배경 이미지 배너 — content의 좌우 padding(screenPaddingX)과
  // 상단 padding(lg)을 이 영역에서만 상쇄해 이미지가 화면 가로 100%/맨 위까지 채우게
  // 하고(bleedScroll과 동일 원칙), 내부에는 다시 동일한 좌우 padding을 줘 topBar/
  // searchBar가 기존과 같은 위치에 보이도록 한다.
  // [2026-09-11 사용자 지시] 최신매물 정렬 버튼 — 제목 아래 우측.

  // 정렬 팝업.
  regionOption: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // 금액 막대.

  // [2026-09-11 사용자 지시] 상단 우측 알림 아이콘 두 개를 나란히.
  topIcons: {
    flexDirection: "row",
    // [2026-09-11 사용자 지시] 두 알림 아이콘 간격을 좁게(8 → 4).
    gap: spacing.xs,
  },

  // [2026-09-11 사용자 지시] 하단 공지 목록 — 썸네일 카드.
  // [2026-09-12] 공지 목록 — 상자 없이 줄 사이 점선만.
  noticeList: {
    // gap을 두면 점선이 줄에서 떨어져 뜬다. 간격은 각 줄의 세로 여백으로 만든다.
    gap: 0,
  },
  noticeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  /** 사용자 지시: 줄 사이 구분선은 점선 1px #ddd. 첫 줄에는 붙이지 않는다. */
  noticeRowDivided: {
    borderTopWidth: 1,
    borderTopColor: "#DDDDDD",
    borderStyle: "dashed",
  },
  noticeThumb: {
    // [2026-09-26 사용자 지시] 가로만 20px 넓게(64 → 84). 세로는 그대로 둔다.
    width: 84,
    height: 64,
    borderRadius: radius.sm,
  },
  noticeThumbEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  // minWidth:0이 없으면 긴 제목이 카드를 밀어내 썸네일이 찌그러진다.
  noticeTexts: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },

  // [2026-09-11 사용자 지시] 공지 롤링 — 높이는 글자 한 줄만, 좌우 여백 20px.
  //
  // heroBanner가 이미 좌우 10px(spacing.screenPaddingX)을 주고 있으므로 여기서는
  // 모자란 10px만 더한다 — 20을 그대로 쓰면 화면 가장자리에서 30px이 된다.
  ticker: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    // [2026-09-26] 검색창·검색 상자가 90% 폭 가운데 정렬이 되면서, 공지 줄도 그
    // 바로 아래로 내려왔다. 폭·정렬을 맞추지 않으면 공지만 좌우로 튀어나와
    // 세 덩이의 왼쪽 끝이 어긋나 보인다. 예전의 marginHorizontal 보정은
    // 전체 폭을 쓸 때의 값이라 더 이상 맞지 않아 걷어낸다.
    width: "90%",
    alignSelf: "center",
  },
  // 한 줄 높이로 잘라내는 창. overflow:hidden이 없으면 위/아래로 빠져나가는 글자가
  // 검색창과 흰 카드 위에 그대로 겹쳐 보인다.
  tickerViewport: {
    flex: 1,
    height: TICKER_LINE_HEIGHT,
    overflow: "hidden",
    justifyContent: "center",
    // [2026-09-26 사용자 지시] 글자 노출 위치를 1px 위로.
    // 글자가 아니라 창을 올린다 — 글자 쪽 transform은 롤링 애니메이션이 쓰고 있다.
    marginTop: -1,
  },
  tickerText: {
    // [2026-09-11 사용자 지시] 롤링 글자 12px 기준.
    // [2026-09-12] 고정값이던 것을 scaleFont로 바꾼다 — 기기 폭에 따라 조정되지 않는
    // 글자가 화면마다 남아 있던 것이 "반응형이 일괄 적용되지 않았다"의 원인이었다.
    // [2026-09-26 사용자 지시] 12 → 14 → 16(한 치수 더).
    fontSize: scaleFont(16),
    lineHeight: TICKER_LINE_HEIGHT,
    // [2026-09-26 사용자 지시] 글자를 1px 위로.
    //
    // marginTop이 아니라 translateY를 쓴다 — 이 Text에는 이미 등장/퇴장 애니메이션의
    // translateY가 인라인으로 걸리는데, RN의 transform은 배열 전체가 통째로 덮어써지므로
    // 여기에 적으면 애니메이션이 지워진다. 그래서 위치 보정은 **창(viewport) 쪽**에서 한다.
  },
  heroBanner: {
    // STEP: PropertyCard.tsx/InvestmentCard.tsx와 동일한 이유로 명시적
    // position:"relative"를 준다 — react-native-web에서는 ImageBackground의
    // absolute-fill 배경 Image가 부모가 명시적으로 relative가 아니면 가로폭을
    // 100% 채우지 못하고 원본 비율대로 줄어들어 보일 수 있다.
    //
    // [STEP: 2026-09-09 재작업] ScrollView의 contentContainerStyle(content)에는
    // 더 이상 padding이 없으므로, 이 View는 RN 기본 flex 동작(alignItems:"stretch")
    // 만으로 화면 가로 폭 전체를 자동으로 채운다 — marginHorizontal/marginTop을
    // 음수로 줘서 부모 padding을 상쇄하는 계산이 더 이상 필요 없다(이전에는 이
    // 계산이 실제 화면에서 정확히 맞아떨어지지 않아 상단/우측에 여백이 남는
    // 문제가 있었다).
    position: "relative",
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.lg,
    // 검색창 하단 ~ 아래 body(라운딩된 흰 카드) 상단 사이에 정확히 보이는 배너색
    // 간격. body가 이 배너의 형제 View로 바로 이어지고 그 사이에 gap이 전혀 없기
    // 때문에(content가 gap을 주지 않음), 이 값 자체가 곧 눈에 보이는 간격이다 —
    // 예전처럼 나중에 겹칠 만큼을 미리 더해두는 보정 계산이 필요 없다.
    // [STEP: 2026-09-09-4] 사용자 피드백(실기기 스크린샷) — 고정 30px가 실기기에서
    // 의도보다 훨씬 크게 보였다(검색창 아래 배너 색상 여백이 과도함). spacing.md(16)로
    // 줄여 "약간만 보이는 여백" 수준으로 조정.
    // [STEP: 2026-09-09-10] 사용자 제보(웹 미리보기 devtools) — 라운딩이 3번의 시도
    // 이후에도 계속 안 보였던 진짜 원인을 여기서 찾았다: bodyMask/body는 배경색이
    // theme.background(#FFFFFF, 컨테이너 배경과 동일)이고, heroBanner 바로 아래
    // "형제"로 이어질 뿐 겹치지 않았다 — 즉 body의 둥근 모서리를 아무리 정확히
    // 잘라내도(overflow:hidden) 그 잘려나간 자리에 드러나는 배경이 heroBanner의
    // 배경색(영상)이 아니라 똑같은 흰색 컨테이너 배경이라 "둥글게 잘렸다는 게
    // 시각적으로 전혀 표시가 안 나는" 상태였다 — CSS/Yoga 렌더링 버그가 아니라
    // 색상 대비가 애초에 없는 구조적 문제였다(그래서 Android 네이티브에서도,
    // 지금 이 웹 미리보기에서도 동일하게 안 보였던 것 — 플랫폼 문제가 아니었다).
    // 해결: paddingBottom을 라운딩 반경(16)만큼 확보해 두고, 아래 body쪽에서
    // 그만큼 위로 겹쳐 올라가게(marginTop: -16) 해서 잘려나간 모서리 자리에
    // heroBanner의 영상 배경이 실제로 드러나도록 한다("컬러 헤더 위에 둥근 흰
    // 카드가 겹쳐 얹힌" 전형적인 패턴).
    // [STEP: 2026-09-09-12] 사용자 요청 — 검색창 아래 실제로 보이는(라운딩 겹침 이후)
    // 여백을 60px로. bodyMask가 marginTop:-16으로 겹쳐 올라가므로, 눈에 보이는 평평한
    // 여백은 (paddingBottom - 16)이 된다 — 60px를 보이게 하려면 76(=60+16)이 필요하다.
    //
    // [2026-09-11 사용자 지시] 그 여백에 공지 롤링이 들어왔으므로 60px는 더 이상
    // "검색창 아래 빈 여백"이 아니라 "공지 줄 아래 여백"이다. 10px로 줄인다.
    // 계산 규칙은 그대로다 — 보이는 여백 10px = paddingBottom 26 - 겹침 16.
    paddingBottom: 10 + 16,
    gap: spacing.lg,
    overflow: "hidden",
    // [2026-09-26 사용자 지시] 배경영상 영역 높이를 600으로 고정한다.
    //
    // 예전에는 높이가 없었다 — 안에 든 것(로고줄 + 검색창 + 공지 롤링)이 쌓인 만큼만
    // 차지했다. 고정 높이를 주면 남는 세로 공간이 생기고, 그 공간을 아래 토글이
    // marginTop:"auto"로 밀어내 맨 아래에 붙는다.
    //
    // 영상은 contentFit="cover"라 비율을 지키며 잘려 채워진다(늘어나지 않는다).
    //
    // [2026-09-26] height가 아니라 **minHeight**를 쓴다. 이 안에 검색 조건 상자가
    // 들어오면서 내용 높이가 기기·선택 상태에 따라 달라졌다 — 매물 탭에서 거래
    // 종류를 고르면 매물 종류 줄이 하나 더 생긴다. height로 못 박으면 overflow:
    // "hidden"과 만나 그 줄과 검색 버튼이 **잘려 안 보인다**(눌러야 할 버튼이
    // 사라지는 것이라 그냥 미관 문제가 아니다). minHeight면 평소에는 정확히 600이고,
    // 내용이 그보다 길 때만 그만큼 늘어난다.
    //
    // [2026-09-26 사용자 지시] 검색창과 매물/투자 탭 사이를 50px 더 벌린다 → 600 + 50.
    // [2026-09-27 사용자 지시] 같은 간격을 50px 더 → 650 + 50 = 700.
    //
    // 왜 높이를 키웠나: 그 간격은 따로 지정된 값이 아니라 **남는 공간**이다
    // (heroSearchGroup의 marginTop:"auto"가 남는 만큼을 전부 위쪽 여백으로 쓴다).
    // 그룹에 marginTop 50을 주면 auto가 이미 공간을 다 먹어 아무 효과가 없고,
    // 그룹을 아래로 밀면 바로 밑의 공지 롤링을 밀어낸다(그 아래는 히어로 끝이다).
    // 높이를 50 키우면 그 50이 전부 이 간격으로 들어가고 아래쪽 배치는 그대로다.
    // 실측: 간격 183px → 233px(→ 283px).
    minHeight: 700,
    // [2026-09-26] 영상이 아직 안 떴을 때를 위한 바탕색.
    //
    // 이 영역의 글자·컨트롤은 전부 흰색(영상 위에 얹히는 전제)이다. 영상이 로드되기
    // 전이나 실패했을 때 바탕이 흰색이면 **검색창과 조건 상자가 통째로 안 보인다** —
    // 웹 미리보기에서 실제로 그렇게 보였다(개발서버가 6MB mp4를 스트리밍하지 못한다).
    // 어두운 바탕을 깔아 두면 영상이 뜨기 전에도 읽을 수 있고, 뜨고 나면 영상이
    // 그 위를 완전히 덮으므로 보이지 않는다.
    backgroundColor: "#2B3350",
  },
  // [2026-09-26] 히어로 안으로 옮긴 탭 + 검색 상자 한 덩이.
  // 남는 세로 공간을 전부 위쪽 margin으로 먹어 맨 아래로 내려간다.
  // gap을 주지 않으므로 탭과 상자가 맞붙는다(사용자 지시).
  heroSearchGroup: {
    marginTop: "auto",
    // [2026-09-26 사용자 지시] 가로 10% 축소 + **가운데 정렬**. 위 검색창과 같은
    // 값이라 둘의 좌우 끝이 일직선으로 맞는다.
    width: "90%",
    alignSelf: "center",
  },
  // STEP: 기존 ImageBackground의 imageStyle과 동일한 이유로 필요한 스타일 —
  // 기본값(StyleSheet.absoluteFill, 즉 top/right/bottom/left:0)이
  // react-native-web에서는 신뢰할 수 없어 width/height 100%로 명시해야 했다. 그런데
  // [STEP: 2026-09-09-5] 실기기(Android) 재현 결과, 반대로 네이티브에서는 이
  // width/height:100% 방식이 문제였다 — 절대 위치 자식의 %기반 width/height는
  // Android Yoga에서 부모의 padding을 뺀 content box 기준으로 계산되어
  // (top/right/bottom/left:0 방식과 달리 padding box를 채우지 못함), heroBanner의
  // paddingTop/paddingHorizontal/paddingBottom 영역만큼 배경이 덜 채워지고 그
  // 자리에 배경(흰색)이 그대로 드러났다 — 이것이 실기기에서 보고된 "상단/우측
  // 빈공간", "검색창 아래 배경 노출 안 됨" 두 증상의 실제 원인이다.
  // [STEP: 2026-09-09-10] 사용자 제보(웹 미리보기 DOM 덤프, testID로 위치 확인) —
  // ImageBackground는 내부적으로 배경 Image에 이미 position:"absolute"를 강제
  // 적용해주는 컴포넌트였다(그 위에 이 imageStyle이 width/height만 덧씌워짐). 지금은
  // <VideoView>를 heroBanner의 평범한 형제로 직접 렌더링하므로 그 자동 처리가 더 이상
  // 없다 — 웹 분기에 position:"absolute"가 빠져 있어 영상이 배경이 아니라 topBar/
  // searchBar와 나란히 배치되는 일반 flex 자식으로 렌더링되고 있었다(gap까지 적용되어
  // 검색창 아래 여백이 60px로 부풀어 보인 원인). 네이티브 분기(absoluteFillObject)는
  // 이미 position:"absolute"를 포함하고 있어 문제없었다 — 웹 분기에도 명시적으로
  // 추가한다.
  heroBannerVideo:
    Platform.OS === "web"
      ? { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }
      : StyleSheet.absoluteFillObject,
  // [2026-09-26 사용자 지시] 영상 위 어둡게 까는 막(rgba(0,0,0,0.3)).
  // heroBannerVideo와 같은 방식으로 영역 전체를 덮는다 — 웹에서는 %기반,
  // 네이티브에서는 absoluteFillObject(위 주석의 Android padding 문제와 동일한 이유).
  heroScrim:
    Platform.OS === "web"
      ? {
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(0,0,0,0.3)",
        }
      : { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.3)" },
  // [STEP: 2026-09-09 재작업] heroBanner 바로 다음 형제 — 배너와 이 View 사이에
  // gap이 전혀 없으므로(content가 더 이상 gap을 주지 않음) 겹침 계산 없이 그냥
  // 붙는다. 라운딩된 모서리가 배너의 색(흰색이 아님) 위에서 시작해야 보이므로,
  // 이 View 자체가 배경색+라운딩을 갖고 이후 모든 섹션(categorySection~마지막
  // 섹션)을 감싼다 — 좌우 padding(screenPaddingX)/섹션 간 gap(lg)도 섹션마다
  // 나눠 지정하지 않고 여기 한 곳으로 통일했다.
  // [STEP S-2, 2026-09-09-2] 사용자 재확인 — 이전 시도(body 자체에 4개 코너 +
  // overflow 명시)로도 실기기 라운딩이 여전히 보이지 않아, body의 복잡한 자식
  // 구성(여러 섹션·카드·중첩 스크롤뷰)과의 상호작용 가능성을 완전히 배제하기 위해
  // 라운딩/클리핑만 전담하는 래퍼를 한 겹 추가한다 — 이 View는 borderRadius +
  // overflow 외에는 아무 속성도 갖지 않는다(가장 단순하고 확실한 형태).
  bodyMask: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    // [STEP: 2026-09-09-10] 위 heroBanner.paddingBottom(16)만큼 위로 겹쳐 올라가
    // heroBanner의 배경(영상)이 둥근 모서리 자리에 실제로 드러나게 한다 — 라운딩
    // 반경(16)과 정확히 같은 값이어야 모서리 곡선 전체가 깔끔하게 겹쳐진다.
    marginTop: -16,
  },
  body: {
    paddingHorizontal: spacing.screenPaddingX,
    paddingTop: spacing.md,
    // [STEP: 2026-09-09-7] 사용자 요청 — 섹션 간 상하 여백이 너무 커 보인다는
    // 피드백으로 lg(24)에서 한 차례 sm(8)까지 줄였는데, 그 값이 section 내부(제목
    // ~ 콘텐츠) 간격(styles.section.gap)과 완전히 같아져 오히려 "영역과 영역
    // 사이"가 구분되지 않는 문제가 생겼다(사용자 재확인 — "모든 영역과 영역사이에는
    // 반드시 상하 간격이 일정하게 떨어져 있어야 구분 가능"). md(16)로 다시 올려
    // section 내부 간격(sm=8)의 2배를 유지한다 — 원래 값(24)보다는 여전히 타이트하고,
    // 섹션 내부 간격과는 명확히 구분된다(탭/카테고리~추천 타이틀, 추천~전체·주변
    // 섹션 등 body의 모든 섹션 간격이 이 값 하나를 공유한다).
    // [STEP S-2-2, 2026-09-09] 사용자 요청 — 서브카테고리~추천 타이틀 등 섹션간
    // 간격 한 단계 축소(md(16)→sm(8)). 섹션 구분이 필요하다는 기존 원칙(§section 내부
    // 간격과는 구분되어야 함)은 유지하되 전체적으로 더 좁게 조정.
    // [STEP: 2026-09-09-11] 사용자 요청(스크린샷) — "추천"/"전체" 등 섹션 타이틀
    // 위 여백을 25px로 명시 지정 (이전엔 디자인 토큰 근사치였으나 이번엔 정확한
    // px 지시라 토큰 대신 리터럴 값을 그대로 쓴다).
    gap: 25,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  // [STEP: 2026-09-09-11] 사용자 제보(스크린샷) — 알림 버튼 테두리를 없앤다.
  // [2026-09-11 사용자 지시] 알림 버튼 10% 축소(40 → 36). 안쪽 아이콘도 함께
  // 20 → 18로 줄였다(ALERT_ICON_SIZE). 배지(notificationBadge, 16px)와 그 안의
  // 숫자는 그대로 둔다 — 버튼이 작아져도 알림 수는 같은 크기로 읽혀야 한다.
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    // 배지(notificationBadge)를 이 버튼 우상단에 절대 위치로 얹기 위한 기준.
    position: "relative",
  },
  // [STEP: 2026-09-09-11] 사용자 제보(스크린샷) — 배지가 버튼 전체를 둘러싸는
  // 큰 원형 테두리처럼 보이는 문제. width를 명시하지 않고 minWidth만 쓰던 것을
  // width로 고정하고(숫자 두 자리 "9+"는 maxWidth로 별도 허용), overflow:hidden으로
  // 어떤 경우에도 16px 원 밖으로 커지지 않도록 강제한다.
  notificationBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    maxWidth: 22,
    height: 16,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    overflow: "hidden",
  },
  notificationBadgeText: {
    color: colors.light.onAccent,
    fontSize: scaleFont(8),
    fontWeight: typography.weight.bold,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    // [2026-09-26 사용자 지시] 가로 10% 축소 + **가운데 정렬**. 아래 탭/조건 상자와
    // 같은 폭·같은 정렬이라 두 덩이의 좌우 끝이 맞아떨어진다.
    width: "90%",
    alignSelf: "center",
  },
  searchInput: {
    flex: 1,
    padding: 0,
    // RN TextInput은 웹에서 포커스 시 기본 outline을 그리는데, 이미 테두리가 있는
    // searchBar 안에 있으므로 이중 테두리로 보이지 않도록 제거한다. outlineStyle은
    // react-native-web 전용 스타일 키라 RN의 TextStyle 타입에는 없어 any로 둔다.
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as Record<string, unknown>) : null),
  },
  section: {
    // [STEP S-2-2, 2026-09-09] 사용자 요청 — 섹션 내부(예: 투자/매물 탭 ~ 서브카테고리)
    // 간격 한 단계 축소(sm(8)→xs(4)).
    gap: spacing.xs,
  },
  lastSection: {
    // [2026-09-26 사용자 지시] FAQ 답변이 아래에서 잘리지 않도록 여백을 크게 잡는다.
    //
    // 답변 Text에는 numberOfLines도 maxHeight도 없어 글자 자체는 다 그려진다 —
    // 잘려 보인 것은 **화면 맨 아래에서 하단 탭에 가려졌기 때문**이다. 긴 답변을
    // 목록 마지막 질문에서 펼치면 그 아래로 스크롤할 공간이 없어 끝부분을 못 본다.
    paddingBottom: spacing.xxl,
  },
  // STEP 4-12-1 — 가로 스크롤 캐러셀 전용: 부모(content)의 좌우 padding을 상쇄해
  // 화면 끝까지 카드가 이어지도록 한다. 캐러셀이 아닌 다른 영역(Section Header/
  // 설명/필터/일반 리스트)에는 적용하지 않는다 — content의 padding은 그대로 유지.
  // content의 좌우 padding이 spacing.screenPaddingX(10px)로 바뀌었으므로 이 값도
  // 함께 맞춘다 — 값이 어긋나면 카드가 화면 밖으로 넘치거나 여백이 남는다.
  bleedScroll: {
    marginHorizontal: -spacing.screenPaddingX,
  },
  // [2026-09-26 사용자 지시] pill 토글 → **좌측 정렬 탭 버튼**.
  //
  // 바뀐 것: 가운데 정렬 80% 폭(alignSelf:"center", width:"80%")을 버리고 왼쪽에
  // 붙인다. 트랙 배경·테두리·안쪽 그림자도 뺀다 — 탭 버튼은 각자가 배경을 갖고
  // 트랙이 없는 형태라, 예전의 "파인 트랙 위 떠 있는 pill"과 섞이면 둘 다 흐려진다.
  categoryTabRow: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: spacing.xs,
  },
  // [2026-09-26] 트랙을 반씩 나누던 flex:1을 뺀다 — 좌측 정렬 탭은 글자 폭 + 여백이다.
  // 아래 상자와 맞붙으므로 **하단 라운딩은 없앤다**(사용자 지시) — 탭 아래가 둥글면
  // 그 틈으로 상자 테두리가 비쳐 탭이 상자에서 떠 있는 것처럼 보인다.
  categoryTabButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  categoryRow: {
    // 사용자 요청(2026-09-08): 아이콘 간 가로 간격을 lg(24)에서 sm(8)으로 좁혔다.
    // [2026-09-26 사용자 지시] 조금 더 좁힌다 — 8 → 4.
    gap: spacing.xs,
    paddingRight: spacing.md,
  },
  categoryItem: {
    alignItems: "center",
    // 사용자 요청: 아이콘-텍스트 간 간격을 xs(4)보다 더 좁게(2px) 줄였다.
    // [2026-09-26 사용자 지시] 더 줄임 — 0.
    gap: 0,
    width: 64,
  },
  categoryIcon: {
    // 사용자 요청: 아이콘 원의 회색 배경/테두리를 삭제했다(더 이상 backgroundColor/
    // borderColor/borderWidth를 주지 않는다) — 아이콘만 남는다.
    //
    // [2026-09-26 사용자 지시] 아이콘과 메뉴명 사이 여백 줄임.
    // gap(2)이 아니라 **이 상자 높이**가 진짜 여백이었다 — 22px 아이콘을 52px 상자
    // 가운데에 두니 아이콘 아래에 15px의 빈 공간이 생기고, 그게 글자와의 간격으로 보였다.
    // 상자를 아이콘에 맞게 좁힌다(배경이 없으므로 상자 크기는 시각적으로 의미가 없다).
    width: 52,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  // [STEP: 2026-09-09-6] paddingHorizontal(좌우 peek 여백)은 이제
  // HorizontalCardCarousel이 layout.featuredCardSidePadding으로 직접 적용한다 —
  // 여기서는 카드 사이 gap만 남긴다.
  featuredRow: {
    gap: spacing.md,
  },
  stack: {
    gap: spacing.md,
  },
  // [2026-09-11 사용자 지시] 매물 목록은 행 사이 간격을 좁힌다 — 간격은
  // PropertyListRow의 paddingVertical이 만들고, 그 가운데에 구분선이 놓인다.
  propertyList: {
    gap: 0,
  },
  // [2026-09-12] TOP10 제목과 정렬 칩을 한 줄에. 칩이 길어지면 제목이 먼저 줄어든다.
  top10Header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  top10HeaderTitle: {
    // [2026-09-26 실기기 결함 수정] 여기가 flexShrink: 1 뿐이었다.
    //
    // 증상: 실기기에서 "최근 TOP10" 제목이 보이지 않고 그 자리에 **세로로 긴 빈칸**이
    // 생겼다(웹 미리보기는 정상). 정렬 칩도 오른쪽으로 밀렸다.
    //
    // 원인: 안쪽 SectionHeader의 titleGroup이 flex: 1이고, RN에서 flex: 1은
    // flexBasis를 **0**으로 만든다. 그래서 SectionHeader의 본래 너비가 0으로 계산되고,
    // 이 상자는 flexGrow가 없어 0에서 늘어나지 않는다 → 제목 Text가 너비 0으로
    // 줄어들어 **한 글자씩 줄바꿈**되고, 그 세로 길이가 빈칸으로 보였다.
    //
    // 웹에서만 멀쩡했던 이유: CSS 플렉스 항목에는 min-width: auto가 기본이라 내용보다
    // 작게 줄어들지 않는다. RN(Yoga)에는 그 보호가 없다 — 웹 미리보기로는 절대
    // 잡히지 않는 종류의 차이다.
    flex: 1,
    minWidth: 0,
  },
  // [2026-09-12] FAQ — 줄에는 상자가 없고, 펼친 답변에만 상자가 있다.
  faqList: {
    gap: spacing.sm,
  },
  faqRow: {
    flexDirection: "row",
    // [2026-09-26 사용자 지시] Q와 질문 글자의 상하 위치를 맞춘다.
    //
    // "center"였다. 질문이 한 줄일 때는 맞아 보이지만, 두 줄이 되면 Q가 두 줄
    // 전체의 가운데로 내려가 첫 줄과 어긋났다. 위 끝을 맞추고, 아래 faqMark와
    // faqTitle에 **같은 lineHeight**를 줘서 첫 줄끼리 정확히 겹치게 한다.
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  /** 사용자 지시: Q 글자는 20px, 굵게. 기준값 20에 제목 계수를 걸어 기기 폭을 따른다. */
  faqMark: {
    fontSize: scaleFont(20, FONT_FACTOR.TITLE),
    fontWeight: "700",
    // 질문 글자와 같은 줄높이 — 이 값이 어긋나면 첫 줄이 서로 위아래로 밀린다.
    lineHeight: FAQ_LINE_HEIGHT(),
  },
  faqTitle: {
    flex: 1,
    lineHeight: FAQ_LINE_HEIGHT(),
  },
  faqAnswer: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
}));

/**
 * [2026-09-28 사용자 지시] 하단 탭을 누르면 이 화면은 **처음부터 다시 시작한다.**
 *
 * key가 바뀌면 React가 HomeScreen를 버리고 새로 만든다 — 필터·펼친 항목·스크롤이
 * 초기값으로 돌아가고, 마운트 시 조회가 다시 돌아 새 정보가 바로 보인다.
 * 껍데기를 따로 둔 이유: 자기 자신의 key는 자기가 바꿀 수 없다.
 */
export default function HomeScreenTab() {
  const refreshKey = useTabRefreshKey("home");
  return <HomeScreen key={refreshKey} />;
}
