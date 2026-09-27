import { useEffect, useRef, useState } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { Animated, Easing, Image, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";

import { initI18n } from "@/i18n";
import { getSession, onAuthStateChange } from "@/services/auth";
import { registerPushToken, subscribeToNotificationTaps } from "@/services/push";
import { checkAndApplyUpdate } from "@/services/updates";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useCurrencyStore } from "@/store/useCurrencyStore";
import { createScaledStyles, refreshTypography } from "@/constants/theme";

// STEP 03 범위: Navigation/Provider 골격만 구성한다. Supabase 클라이언트,
// 인증 상태, 실제 화면 로직은 다음 단계(Phase 2 이후)에서 연결한다.
// STEP 4-8: services/auth.ts의 세션 조회/구독을 최소 상태로만 연결한다.
// STEP 4-10 — Auth Guard / Session-Based Routing: 세션 유무에 따른 라우팅 분기를
// 이 파일(RootLayout) 한 곳에서만 수행한다. getSession()/onAuthStateChange 구독은
// 기존 STEP 4-8 코드를 그대로 재사용하며(추가 auth 리스너를 만들지 않는다),
// 여기서 얻은 session 상태를 useAuthGuard가 소비해 현재 라우트가 세션 상태와
// 맞지 않으면 리다이렉트한다. Home/Property/Invest/AI/My 화면, Login/Register
// 화면 각각에는 이 로직을 중복 구현하지 않는다.
//
// STEP 4-12 — 비로그인 공개 구조로 전환: 기존에는 세션이 없으면 (tabs) 그룹
// 전체(Home/Property/Invest/AI/My)와 루트("/")에서 무조건 /login으로 강제
// 이동시켰다. 이번 STEP 요구사항(§1/§2)은 반대다 — 앱은 항상 Home으로 열리고,
// 비로그인 사용자도 Home/Property/Invest/AI/My를 자유롭게 탐색할 수 있어야
// 하며, 로그인은 "회원 전용 기능을 실제로 사용하려 할 때"만 그 기능을 제공하는
// 화면이 개별적으로 /login으로 이동시킨다(예: app/(tabs)/my.tsx의 guest 섹션).
// 따라서 이 전역 Auth Guard는 더 이상 세션 유무로 tabs 접근을 차단하지 않는다 —
// (1) 루트("/")는 세션 여부와 무관하게 항상 /home으로 보내고, (2) 이미 로그인된
// 사용자가 /login이나 /register에 들어오면 /home으로 돌려보내는 것, 이 두 가지만
// 담당한다. segments 기반의 (tabs) 그룹 판별이 필요 없어져 STEP 4-10A-2에서
// 다뤘던 typed-routes segments 타입 문제도 함께 사라진다 — usePathname()의 순수
// string 비교만 사용한다(as any/unknown 등 타입 우회 없음, 기존 getSession()/
// onAuthStateChange/단일 auth 리스너 구조는 전혀 바꾸지 않았다).

/**
 * [2026-09-26 실기기 결함 수정] 여기 있던 코드를 **지웠다.**
 *
 * 있던 것: `Text.defaultProps = { allowFontScaling: false }` — 기기의 시스템 글꼴
 * 크기 배율을 꺼서, 크기를 화면 폭 하나로만 정하려는 의도였다.
 *
 * 문제: **그 코드는 아무 일도 하지 않았다.** RN 0.81의 Text는 함수형 컴포넌트이고
 * (Libraries/Text/Text.js의 `component(...)` 문법), React 19는 함수형 컴포넌트의
 * defaultProps를 제거했다. 그래서 모든 글자가 시스템 배율을 그대로 곱하고 있었고,
 * 폭 기반 계산과 겹쳐 곱해져 "해상도가 큰 폰에서 글자가 더 작은" 결과가 나왔다.
 *
 * 지금은 constants/theme.ts가 크기를 만들 때 fontScale로 미리 나눈다 — RN이
 * 렌더링에서 다시 곱하므로 최종 크기가 정확히 폭 기반 값이 된다. 끄는 방식은
 * 한 곳만 빠뜨려도 그 글자만 어긋나지만, 나누는 방식은 통로가 한 곳뿐이라 빠질 곳이 없다.
 */


const queryClient = new QueryClient();

function useAuthGuard(session: Session | null, sessionLoading: boolean) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (sessionLoading) return;

    const atRoot = pathname === "/";
    const inAuthScreens = pathname === "/login" || pathname === "/register";

    if (atRoot) {
      // 세션 유무와 무관하게 앱은 항상 Home으로 연다(§1: 비로그인 상태로 앱 탐색).
      router.replace("/home");
      return;
    }

    if (session && inAuthScreens) {
      // [STEP: 2026-09-09-3] 사용자 요청 — "로그인을 요청한 페이지에서 로그인하면
      // 로그인 요청한 페이지로 다시 돌아와야 함". /login은 항상 다른 화면(문의하기/
      // 투자신청/찜하기 등에서 router.push("/login")으로 진입)에서 스택에 쌓여
      // 열리므로, 그 이전 화면이 아직 네비게이션 스택에 남아있다 — 무조건 /home으로
      // replace하지 않고 뒤로 갈 수 있으면 그 화면으로 돌아간다. 스택이 없는 경우
      // (딥링크로 /login에 바로 진입 등)에만 기존처럼 /home으로 보낸다.
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/home");
      }
    }
    // 세션이 없는 상태로 (tabs) 화면에 머무는 것은 정상 흐름이다 — 더 이상
    // /login으로 강제 이동시키지 않는다(비로그인 공개 탐색 허용).
  }, [session, sessionLoading, pathname, router]);
}

export default function RootLayout() {
  // 푸시 알림 탭 처리에 필요하다(useAuthGuard 안의 router와는 다른 스코프).
  const router = useRouter();
  const [i18nReady, setI18nReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    // STEP 4-10A-3: i18next.init()은 비동기다 — Promise가 실제로 resolve된 뒤에만
    // i18nReady를 true로 바꾼다. 예전처럼 initI18n() 호출 직후 곧바로 true로
    // 바꾸면, react-i18next가 아직 instance 준비 전이라고 경고하고(NO_I18NEXT_INSTANCE),
    // 그 상태로 마운트된 번역 의존 컴포넌트가 이후 i18n이 실제로 준비되는 순간
    // 다시 렌더되며 hook 개수가 달라지는 오류로 이어진다(§아래 렌더 분기 주석 참고).
    let mounted = true;
    initI18n().then(() => {
      if (!mounted) return;
      // [2026-09-11] 실제 적용된 언어로 설정 화면 표기를 맞춘다 — 저장된 선택이
      // 디바이스 언어보다 우선하므로, store의 초기 추정값과 다를 수 있다.
      useLocaleStore.getState().syncFromI18n();
      setI18nReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    getSession().then((initialSession) => {
      if (mounted) {
        setSession(initialSession);
        setSessionLoading(false);
      }
    });

    const { unsubscribe } = onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setSession(nextSession);
      }
    });

    // [2026-09-16 확정-결정사항 1·9] 기기에 저장된 통화를 읽어 온다.
    //
    // 언어는 i18n이 초기화하면서 저장값을 이미 반영하지만(resolveInitialLanguage),
    // 통화는 이번에 저장을 붙였으므로 여기서 한 번 읽어 준다. 로그인 여부와 무관하다.
    void useCurrencyStore.getState().hydrateFromDevice();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useAuthGuard(session, sessionLoading);

  /**
   * [2026-09-12 사용자 지시] 화면 폭이 바뀌면 글자 크기를 다시 계산한다.
   *
   * 예전에는 앱이 처음 뜰 때의 폭으로 영원히 고정됐다 — 폴더블을 펴거나 접어도,
   * 화면을 돌려도 글자가 그대로였고 앱을 완전히 종료했다 켜야 반영됐다.
   *
   * typographyVersion을 Stack의 key로 주는 이유: refreshTypography()는 textStyles
   * 객체를 제자리에서 고치는데, 그것만으로는 이미 그려진 화면이 다시 그려지지 않는다.
   * key가 바뀌면 화면 트리가 새로 마운트되며 새 크기를 읽는다. 비율이 실제로 달라진
   * 경우에만 올린다 — 키보드가 오르내리며 높이만 바뀔 때마다 다시 마운트하면
   * 입력하던 내용이 날아간다.
   */
  const { width, fontScale } = useWindowDimensions();
  const [typographyVersion, setTypographyVersion] = useState(0);

  useEffect(() => {
    if (refreshTypography(width, fontScale)) {
      setTypographyVersion((current) => current + 1);
    }
    // fontScale도 의존성이다 — 앱을 켜 둔 채 시스템에서 글자 크기를 바꾸면
    // 그 순간 모든 크기를 다시 계산해야 한다.
  }, [width, fontScale]);

  /**
   * [2026-09-26 사용자 지시] OTA — 앱을 켤 때 새 JS 번들이 있으면 받아서 적용한다.
   *
   * 무엇이 되고 무엇이 안 되나: expo-updates는 **JS/자산만** 갈아 끼운다. 화면·문구·
   * 로직 수정은 스토어를 거치지 않고 바로 나가지만, 네이티브가 바뀌는 변경
   * (패키지 추가, 권한, app.json의 plugins·아이콘 등)은 여전히 새 빌드가 필요하다.
   *
   * 어느 빌드가 이 업데이트를 받는가: app.json의 runtimeVersion(정책 appVersion)이
   * 같은 빌드만 받는다. version을 올리면 그 전 빌드는 이 업데이트를 받지 않는다 —
   * 네이티브가 다를 수 있으므로 그게 맞다.
   *
   * 받은 뒤 바로 reload하는 이유: 기본 동작은 "다음 실행부터 적용"이라 사용자가
   * 앱을 두 번 껐다 켜야 새 코드가 돈다. 고친 것이 바로 반영되지 않으면
   * "고쳤는데 그대로"로 읽힌다.
   *
   * __DEV__에서는 하지 않는다 — 개발 중에는 Metro가 번들을 주고, 여기서 reload를
   * 걸면 개발 서버와 싸운다.
   *
   * 실패는 삼킨다. 네트워크가 없거나 업데이트 서버가 응답하지 않아도 앱은 지금 가진
   * 번들로 그냥 실행돼야 한다 — 업데이트 확인 때문에 앱이 안 켜지는 편이 훨씬 나쁘다.
   */
  useEffect(() => {
    // 결과를 남기는 일까지 services/updates.ts가 맡는다 — 알림 화면이 그 값을 읽어
    // "지금 이 앱이 OTA를 물고 있는지"를 한 줄로 보여 준다.
    void checkAndApplyUpdate();
  }, []);

  /**
   * [2026-09-12 사용자 지시] 푸시 — 로그인한 뒤에 토큰을 등록하고, 알림을 누르면
   * MY로 보낸다.
   *
   * 여기(루트 레이아웃)에 두는 이유: 알림 탭은 앱이 어느 화면에 있든, 심지어 꺼져
   * 있다가 알림으로 켜져도 처리돼야 한다. 화면마다 구독하면 그 화면에 있을 때만
   * 동작한다.
   */
  useEffect(() => {
    if (!session) return;
    void registerPushToken();
  }, [session]);

  /**
   * [2026-09-16 확정-결정사항 9] 로그인하면 서버에 저장된 언어·통화를 반영한다.
   *
   * 여기(루트 레이아웃)에 두는 이유는 푸시 등록과 같다 — 로그인은 A1 로그인 화면뿐
   * 아니라 T5 MY의 게스트 영역에서도 일어나고, 세션 복구로도 일어난다. 한 곳에서
   * 세션을 보는 편이 빠뜨릴 곳이 없다.
   *
   * 서버 값이 비어 있으면(아직 고르지 않음) 지금 기기 값을 서버에 올린다 —
   * 각 스토어의 syncWithServer가 그 판단을 한다.
   */
  useEffect(() => {
    if (!session) return;
    void useLocaleStore.getState().syncWithServer();
    void useCurrencyStore.getState().syncWithServer();
  }, [session]);

  useEffect(() => {
    return subscribeToNotificationTaps((route) => {
      router.push(route as "/my");
    });
  }, [router]);

  /**
   * [2026-09-27 사용자 지시] 빛이 **한 번 지나간 뒤** 홈으로 넘어가야 한다.
   *
   * i18n과 세션 조회는 보통 빛이 지나가기 전에 끝난다 — 그대로 두면 애니메이션이
   * 중간에 잘린 채 화면이 바뀐다. 그래서 준비 여부와 별개로 SPLASH_HOLD_MS 동안은
   * 스플래시를 내리지 않는다. 준비가 더 오래 걸리면 준비 쪽이 기준이 된다(둘 중
   * 늦은 쪽까지 기다린다).
   */
  const [splashHolding, setSplashHolding] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setSplashHolding(false), SPLASH_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!i18nReady || sessionLoading || splashHolding) {
    // STEP 4-10A-3: i18n이 준비되기 전에는 Loading을 쓸 수 없다 — Loading은 내부에서
    // useTranslation()을 부르므로, 준비 전에 마운트했다가 준비되는 순간 같은 자리에서
    // 다시 렌더되며 hook 개수가 달라진다("Rendered more hooks than during the previous
    // render"의 실제 원인이었다). 그래서 번역에 의존하지 않는 화면만 그린다.
    //
    // STEP 4-10 §5: 초기 getSession()이 끝나기 전에는 Login/Home 어느 쪽도 보여주지
    // 않는다.
    //
    // [2026-09-27] 세 조건을 한 분기로 합쳤다. 예전에는 i18n 단계와 세션 단계가 서로
    // 다른 화면(빈 스플래시 / 흰 배경 Loading)이어서 시작할 때 화면이 두 번 바뀌었다.
    return (
      <SafeAreaProvider>
        <AppSplash />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <Stack key={typographyVersion} screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * 앱이 준비되기 전까지 보여 주는 화면.
 *
 * [2026-09-27 사용자 지시] **네이티브 스플래시와 똑같이 보여야 한다.** 예전에는
 * 흰 배경에 스피너였다 — 빨간 스플래시가 사라지고 흰 화면이 한 번 번쩍인 뒤 홈이
 * 떴다. 사용자에게는 "스플래시가 두 번" 나오는 것처럼 보인다.
 *
 * 로고 크기 41%의 근거: 네이티브 스플래시는 로고를 **168dp**로 그리고(app.json의
 * expo-splash-screen.imageWidth), 일반적인 기기 폭이 411dp다 — 168/411 = 0.409.
 * 같은 비율로 그리면 네이티브 스플래시에서 이 화면으로 넘어갈 때 로고가 움직이지
 * 않는다.
 */
const SPLASH_BACKGROUND = "#D70202";
const SPLASH_LOGO_RATIO = 168 / 411;

/**
 * [2026-09-27 사용자 지시] 로고가 **페이드로 천천히** 나타난다.
 *
 * 이 때문에 네이티브 스플래시(app.json)는 빨간 배경만 보여 준다 — 네이티브가 로고를
 * 먼저 띄우면 JS 화면으로 넘어오는 순간 로고가 한 번 사라졌다가 다시 나타난다.
 * 앱을 켜자마자 브랜드 색 화면이 뜨고, 로고는 여기서 처음 등장한다.
 */
const FADE_DURATION_MS = 2300;
/**
 * 빛이 지나가기 시작하는 시각.
 *
 * [2026-09-27 사용자 지시] **0.5초부터** 시작한다. 로고 페이드(0초 시작)가 먼저
 * 은은하게 올라오고, 그 위로 빛이 들어온다. 홈 전환 시점(2.4초)은 그대로이므로
 * 빛이 지나가는 시간은 1.8초다.
 */
const SHINE_DELAY_MS = 500;
/** 지나가는 시간. 사용자 지시로 "느린 슬라이드". */
const SHINE_DURATION_MS = 1800;
/**
 * 지나간 뒤 여운.
 *
 * [2026-09-27 사용자 지시] 전체를 **2.4초로 줄였다.** 페이드·라이팅 2.3초,
 * 그림자 1.7~2.4초, 여운 0.1초 → 2.4초에 홈. 시간만 줄였으므로 곡선은 그대로고
 * 같은 거리를 더 짧은 시간에 지나가 속도가 올라간다.
 */
const SHINE_TAIL_MS = 100;

/**
 * [2026-09-27 사용자 지시] 마지막 구간에 로고 **그림자**가 붙는다 — 오른쪽·아래로
 * 3px씩 움직이며 투명 → rgba(0,0,0,0.4)로 나타나고, 끝나는 순간이 홈 전환 시점이다.
 */
const SHADOW_DELAY_MS = 1700;
const SHADOW_DURATION_MS = 700;
const SHADOW_OFFSET = 3;
const SHADOW_OPACITY = 0.4;
/** 스플래시를 내리지 않는 최소 시간 = 빛이 한 번 완전히 지나가는 시간. */
const SPLASH_HOLD_MS = Math.max(
  SHINE_DELAY_MS + SHINE_DURATION_MS + SHINE_TAIL_MS,
  SHADOW_DELAY_MS + SHADOW_DURATION_MS,
);

/** 빛 띠 이미지는 로고 상자보다 크다 — 기울어져 있어 모서리까지 덮어야 한다. */
const SHINE_SCALE = 2.6;

/**
 * 앱이 준비되기 전까지 보여 주는 화면.
 *
 * [2026-09-27 사용자 지시] **네이티브 스플래시와 똑같이 보여야 한다.** 예전에는
 * 흰 배경에 스피너였다 — 빨간 스플래시가 사라지고 흰 화면이 한 번 번쩍인 뒤 홈이
 * 떴다. 사용자에게는 "스플래시가 두 번" 나오는 것처럼 보인다.
 *
 * 로고 크기 41%의 근거: 네이티브 스플래시는 로고를 **168dp**로 그리고(app.json의
 * expo-splash-screen.imageWidth), 일반적인 기기 폭이 411dp다 — 168/411 = 0.409.
 * 같은 비율로 그리면 네이티브 스플래시에서 이 화면으로 넘어갈 때 로고가 움직이지
 * 않는다.
 *
 * [2026-09-27 사용자 지시] **흰 로고 부분에만 빛(shine)이 대각선으로 한 번 지나간다.**
 *
 * 두 가지가 핵심이다.
 *
 * 하나, **로고는 순백 100%에서 전혀 건드리지 않는다.** 빛이 안 닿은 자리까지
 * 어두워지면 "띠가 지나간다"가 아니라 "로고 전체가 변한다"로 보인다.
 *
 * 둘, 빛은 **흰색 번짐**이고(사용자 지시) 실제 빛이 표면을 스칠 때의 모양을 그대로
 * 그려 넣었다 — 아주 좁고 밝은 심지, 진행 방향 앞은 짧고 뒤는 길게 끌리는 비대칭
 * 번짐(혜성 꼬리), 뒤따르는 가는 줄, 그리고 띠 끝으로 갈수록 약해지는 감쇠(광원이
 * 점이라 띠 가운데가 가장 밝다). 여기에 세기가 켜졌다 꺼지는 것(shineOpacity)까지
 * 더해야 "완성된 띠가 들어왔다 나간다"가 아니라 "빛이 스쳐 간다"로 보인다.
 *
 * 이미 순백인 획에서는 더 밝아질 여지가 없으므로, 변화는 로고 아래쪽 그라데이션
 * 구간에서 가장 크게 보인다 — 빛이 지나가는 동안 그 구간이 순백으로 떠올랐다가
 * 되돌아간다.
 *
 * 겹치는 순서가 전부다:
 *   1. 로고(순백 100%)
 *   2. 그 위로 지나가는 빛 띠 — 가로로만 움직이지만 띠 자체가 20° 기울어져 있어
 *      대각선으로 지나간다. 회전 변환을 쓰지 않으므로 안드로이드에서 회전+overflow
 *      조합이 잘리는 문제를 피한다.
 *   3. **로고 실루엣만 뚫린 배경색 판** — 띠가 로고 바깥(빨간 배경)에서는 보이지 않게
 *      덮는다. 판 바깥은 배경과 같은 #D70202라 있는지 알 수 없다.
 *
 *      [2026-09-27 사용자 지시] 구멍을 로고의 알파 그대로가 아니라 **실루엣**으로
 *      뚫는다. 알파를 그대로 뒤집으면 'd' 아래쪽 그라데이션 구간에서 판이 진해져
 *      빛이 그 구간에서만 사라졌다 — 빛은 그라데이션 위로도 지나가야 한다.
 *
 * 이 방식을 고른 이유: expo-linear-gradient와 masked-view를 새로 깔면 네이티브 모듈이
 * 둘 늘어난다. 띠와 판을 이미지로 미리 만들어 두면 Animated의 translateX 하나로 끝나고
 * (useNativeDriver 가능) 새 의존성이 없다.
 */
function AppSplash() {
  const { width } = useWindowDimensions();
  const size = Math.round(width * SPLASH_LOGO_RATIO);
  const shineSize = Math.round(size * SHINE_SCALE);
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  // 빛의 **세기**는 거리가 아니라 시간에 맞춰야 한다. progress는 감속 곡선이 이미
  // 적용된 값이라, 이걸로 세기를 만들면 끝부분(거리는 거의 다 갔지만 시간은 절반
  // 남은 구간)에서 빛이 먼저 꺼져 버린다 — 슬로우모션 구간이 통째로 비어 보인다.
  const timeline = useRef(new Animated.Value(0)).current;
  const shadow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: FADE_DURATION_MS,
      // [2026-09-27 사용자 지시] **처음 나타나는 부분을 슬로우모션처럼 더 느리게.**
      //
      // out(quad)는 반대였다 — 시작하자마자 확 밝아지고 끝에서 느려진다(0.85초에
      // 이미 44%). inOut 계열은 한참 은은하게 떠오르다가 중반에 드러나고 끝에서
      // 다시 부드럽게 멈춘다. 같은 0.85초에 cubic은 6%, **poly(4)는 3%**다.
      // (RN Easing에 quart는 없다 — poly(4)가 같은 곡선이다.)
      easing: Easing.inOut(Easing.poly(4)),
      useNativeDriver: true,
    }).start();
  }, [fade]);

  useEffect(() => {
    Animated.timing(shadow, {
      toValue: 1,
      delay: SHADOW_DELAY_MS,
      duration: SHADOW_DURATION_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [shadow]);

  useEffect(() => {
    Animated.timing(timeline, {
      toValue: 1,
      // 빛과 같은 시점에 시작해야 세기와 위치가 어긋나지 않는다.
      delay: SHINE_DELAY_MS,
      duration: SHINE_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [timeline]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      delay: SHINE_DELAY_MS,
      duration: SHINE_DURATION_MS,
      // [2026-09-27 사용자 지시] 처음부터 나타나면서 점점 느려지고, **끝부분은
      // 슬로우모션처럼** 더 느리게.
      //
      // 지수 2.6 — quad(2)보다 끝이 느리고 cubic(3)보다는 초반이 덜 급하다.
      // 시간이 2.3초로 줄어도 곡선은 그대로라 전체 속도만 올라간다.
      easing: Easing.out(Easing.poly(2.6)),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  // 왼쪽 바깥(-1.5)에서 오른쪽 끝(+1.0)까지.
  //
  // 끝값을 1.6에서 1.0으로 줄인 이유: 감속 곡선에서는 느려지는 구간이 **끝 지점
  // 근처**다. 끝을 로고에서 멀리 두면 그 슬로우모션이 로고 밖에서 일어나 화면에는
  // 아무것도 안 보인다. 끝을 로고 오른쪽 가장자리에 붙여야 빛이 로고 위에서
  // 천천히 빠져나간다.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-size * 1.5, size * 1.0],
  });

  // 가림판(cutout)에는 페이드를 걸지 않는다. 같이 흐려지면 그 사이로 빛이 로고
  // 밖으로 새고, 그룹 투명도 처리 방식에 결과가 좌우된다.
  //
  // [2026-09-27 사용자 지시] 실제 빛처럼 **세기가 켜졌다 꺼진다.** 위치만 움직이면
  // 빛이 화면 밖에서 완성된 채로 들어왔다 그대로 나가는 것처럼 보인다.
  const shineOpacity = timeline.interpolate({
    inputRange: [0, 0.1, 0.85, 1],
    outputRange: [0, 1, 1, 0],
  });

  // 그림자는 최종 자리(오른쪽·아래 3px)에 그려 둔 조각이라, -3에서 0으로 밀어
  // 넣으면 "로고 뒤에서 오른쪽 아래로 빠져나오는" 움직임이 된다.
  const shadowOpacity = shadow.interpolate({ inputRange: [0, 1], outputRange: [0, SHADOW_OPACITY] });
  const shadowShift = shadow.interpolate({ inputRange: [0, 1], outputRange: [-SHADOW_OFFSET, 0] });

  const box = { width: size, height: size };
  const shineBox = {
    width: shineSize,
    height: shineSize,
    left: (size - shineSize) / 2,
    top: (size - shineSize) / 2,
  };

  return (
    <View style={styles.splash}>
      {/* overflow:"hidden"이 없으면 안 된다. 띠 이미지는 로고 상자의 2배라, 상자
          밖으로 삐져나온 부분은 아래의 가림판(로고 상자 크기)이 덮지 못해 빨간
          배경 위에 그대로 보인다 — 화면을 가로지르는 흰 띠가 된다. */}
      <View style={[box, styles.clip]}>
        <Animated.Image
          source={require("@/assets/images/splash-logo.png")}
          style={[styles.layer, box, { opacity: fade }]}
          resizeMode="contain"
        />
        <Animated.Image
          source={require("@/assets/images/splash-shine.png")}
          style={[
            styles.layer,
            shineBox,
            // 빛도 로고와 함께 떠오른다 — 로고가 반쯤 보이는데 빛만 온전하면 따로 논다.
            { opacity: Animated.multiply(shineOpacity, fade), transform: [{ translateX }] },
          ]}
          resizeMode="contain"
        />
        <Image
          source={require("@/assets/images/splash-logo-cutout.png")}
          style={[styles.layer, box]}
          resizeMode="contain"
        />
        {/* 그림자는 가림판 **위에** 온다. 로고 뒤에 깔면 가림판이 실루엣 바깥을
            배경색으로 덮으면서 통째로 가려진다. 그래서 이미지 자체를 "로고 밖으로
            삐져나오는 조각"만으로 만들어(splash-shadow.png) 맨 위에 얹는다 —
            로고와 겹치지 않으므로 흰 획을 가리지 않는다. */}
        <Animated.Image
          source={require("@/assets/images/splash-shadow.png")}
          style={[styles.layer, box, {
              opacity: shadowOpacity,
              transform: [{ translateX: shadowShift }, { translateY: shadowShift }],
            }]}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

const styles = createScaledStyles(() => ({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SPLASH_BACKGROUND,
  },
  layer: {
    position: "absolute",
  },
  clip: {
    overflow: "hidden",
  },
}));
