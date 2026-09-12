import { useEffect, useState } from "react";
import { Stack, usePathname, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";

import { Loading } from "@/components/Loading";
import { initI18n } from "@/i18n";
import { getSession, onAuthStateChange } from "@/services/auth";
import { registerPushToken, subscribeToNotificationTaps } from "@/services/push";
import { useLocaleStore } from "@/store/useLocaleStore";
import { refreshTypography } from "@/constants/theme";

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
 * [2026-09-12 사용자 지시] **시스템 글꼴 배율을 앱에 적용하지 않는다.**
 *
 * 이것이 "해상도에 따라 글자가 조정되지 않는다"의 실제 원인이었다. React Native의
 * Text는 기본적으로 기기 설정(설정 → 디스플레이 → 글꼴 크기)의 배율을 곱한다. 그래서
 * 글꼴을 크게 써 온 기기에서는 앱이 화면 폭으로 계산한 크기 위에 그 배율이 다시
 * 곱해져, 좁은 화면에서도 글자가 그대로 커 보였다 — 앱의 계산이 무력화된 것이다.
 *
 * 이 앱은 크기를 화면 폭 하나로만 정한다(constants/theme.ts). 두 개의 기준이 겹쳐
 * 곱해지면 어느 쪽으로도 예측할 수 없으므로, 배율 쪽을 끈다.
 *
 * defaultProps는 함수형 컴포넌트에서 사라졌지만 Text/TextInput 같은 RN 내장
 * 컴포넌트에서는 여전히 동작한다 — 화면마다 allowFontScaling={false}를 일일이
 * 붙이는 것(빠뜨리면 그 글자만 배율을 타는)보다 이 한 곳이 확실하다.
 */
type FontScalable = { defaultProps?: { allowFontScaling?: boolean } };
for (const component of [Text, TextInput] as unknown as FontScalable[]) {
  component.defaultProps = { ...component.defaultProps, allowFontScaling: false };
}

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
  const { width } = useWindowDimensions();
  const [typographyVersion, setTypographyVersion] = useState(0);

  useEffect(() => {
    if (refreshTypography(width)) {
      setTypographyVersion((current) => current + 1);
    }
  }, [width]);

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

  useEffect(() => {
    return subscribeToNotificationTaps((route) => {
      router.push(route as "/my");
    });
  }, [router]);

  if (!i18nReady) {
    // STEP 4-10A-3: 이 분기는 i18n이 "아직" 준비되지 않은 상태다 — 여기서 Loading을
    // 쓰면 안 된다. Loading은 내부에서 무조건 useTranslation()을 호출하므로, i18n이
    // 준비되기 전에 Loading을 마운트했다가 i18n이 준비되는 순간 그대로 다시 렌더되며
    // (컴포넌트는 언마운트되지 않은 채) useTranslation() 내부 hook 개수가 달라진다 —
    // 이것이 실제 로그의 "Rendered more hooks than during the previous render"의
    // 원인이었다. 그래서 이 분기에서는 번역에 의존하지 않는 최소한의 스플래시만
    // 그린다 — Loading의 공개 API(`<Loading fullscreen />`)는 그대로 유지하고,
    // 다른 화면에서의 사용처는 전혀 건드리지 않는다.
    return (
      <SafeAreaProvider>
        <View style={styles.splash}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (sessionLoading) {
    // i18n은 이미 완전히 준비된 뒤이므로 이제부터는 Loading(useTranslation 포함)을
    // 안전하게 쓸 수 있다 — 초기 getSession() 조회가 끝나기 전에는 Login/Home
    // 어느 쪽도 보여주지 않는다는 기존 요구사항(STEP 4-10 §5)은 그대로다.
    return (
      <SafeAreaProvider>
        <Loading fullscreen />
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

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
});
