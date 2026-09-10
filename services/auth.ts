import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";

import { supabase } from "./supabase";

/**
 * Supabase Auth — 세션 조회/구독 + email/password 인증 + Google/Apple OAuth.
 *
 * 이 파일은 (a) 현재 로그인 세션 조회, (b) 현재 사용자 조회, (c) Auth 상태
 * 변화 구독, (d) email/password 로그인/회원가입(STEP 4-9), (e) Google/Apple
 * 소셜 로그인(STEP 4-13)을 제공한다. 세션 영구 저장소(expo-secure-store) 연동은
 * 포함하지 않는다 — 별도 STEP에서 다룬다(security.md §8 참조).
 *
 * services/supabase.ts의 `supabase`는 환경변수(EXPO_PUBLIC_SUPABASE_URL /
 * EXPO_PUBLIC_SUPABASE_ANON_KEY) 미설정 시 null이다. 이 파일의 모든 함수는
 * 반드시 null을 먼저 체크하고, 앱을 crash시키지 않는다.
 *
 * STEP 4-13 — Google / Apple Social Login 실제 구현.
 * 웹 표시 후 앱으로 돌아오는 리다이렉트를 자체적으로 가로채는 "AuthSession" 방식
 * (WebBrowser.openAuthSessionAsync)을 Google/Apple 공통으로 사용한다 — 두 provider
 * 모두 Supabase가 발급하는 OAuth authorize URL(공급자별 UI만 다름)로 이동시키고,
 * 동일한 코드 경로로 콜백을 처리하므로 provider별 분기가 필요 없다. 이 방식을
 * 선택한 이유(신규 의존성 최소화, §22):
 * - `expo-web-browser`(1개)만 새로 추가한다. 공식 Supabase Expo 가이드가 함께
 *   쓰는 `expo-auth-session`(makeRedirectUri/QueryParams 유틸리티)은 추가하지
 *   않았다 — redirect URI는 이미 설치된 expo-linking의 Linking.createURL()로,
 *   콜백 URL의 code 파라미터는 아래 extractParamFromUrl()의 간단한 정규식
 *   파싱으로 대체할 수 있어 별도 패키지가 꼭 필요하지 않다(REMAINING ISSUES에
 *   트레이드오프를 기록한다).
 * - Apple 네이티브 Sign in with Apple(`expo-apple-authentication`, iOS 전용,
 *   두 번째 신규 의존성)은 채택하지 않았다 — 같은 signInWithOAuth 경로를 Google과
 *   공유하면 Android에서도 Apple 로그인이 동작하고(Supabase의 Apple OAuth
 *   Provider는 웹 기반 "Sign in with Apple" 플로우를 지원한다) 의존성이 늘지
 *   않는다. 다만 Apple의 App Store 심사 가이드라인 4.8은 네이티브 Sign in with
 *   Apple을 권장/요구하는 경우가 있어, 실제 iOS 앱스토어 출시 전에는 재검토가
 *   필요하다 — 이 STEP의 명시적 범위가 아니므로 결과 보고서에만 기록한다.
 *
 * STEP 4-13-4 — Deep Link redirect URI를 `viets://login` 문자열로 하드코딩하지
 * 않고 `Linking.createURL("/login")`을 그대로 유지한다. Expo 공식 문서
 * (docs.expo.dev/versions/latest/sdk/linking)로 재확인한 결과 이 함수는 환경을
 * 자동으로 인식한다 — Development Build/Standalone 빌드에서는 app.json의
 * `scheme: "viets"`를 그대로 사용해 정확히 `viets://login`을 반환하고(이번 STEP의
 * 요구사항과 이미 일치), Expo Go에서는 `exp://<LAN-IP>:8081/--/login`을 반환한다.
 * `viets://login`을 문자열로 고정하면 Expo Go는 커스텀 스킴(`viets://`)에 대한 OS
 * 레벨 등록이 없어(Expo Go 자체는 `exp://`만 처리) `WebBrowser.openAuthSessionAsync`가
 * 콜백을 영영 받지 못하고 멈춘다 — 즉 Expo Go 테스트가 완전히 불가능해진다. 이는
 * 코드 버그가 아니라 Expo Go의 구조적 제약이며, `Linking.createURL()`을 유지하는
 * 현재 방식이 "코드에 localhost/LAN IP를 하드코딩하지 않는다"는 요구사항과
 * "production에서는 항상 viets://login을 쓴다"는 요구사항을 모두 만족하면서
 * Expo Go 호환성(§6)도 지키는 유일한 방법이다. 자세한 근거와 Dashboard 조치 항목은
 * 결과 보고서(STEP 4-13-4)를 참고한다.
 *
 * STEP 4-13-7 — 위 STEP 4-13-4의 트레이드오프 분석(신규 의존성 회피)을 명시적으로
 * 재검토해 `expo-auth-session`의 `makeRedirectUri()`로 교체했다(Expo/Supabase
 * 공식 React Native OAuth 가이드가 권장하는 API 표면과 일치시키기 위함). 아래
 * 사실 두 가지는 이 교체가 Expo Go의 런타임 동작 자체를 바꾸지 않는다는 것을
 * 분명히 하기 위해 기록한다(추측 금지 원칙 — docs.expo.dev/versions/latest/sdk/auth-session
 * 로 재확인, STEP 4-13-6 ROOT CAUSE 결론과 일관성 유지):
 * - `makeRedirectUri({ path: "login" })`는 Expo Go에서 `Linking.createURL("/login")`과
 *   동일한 형식(`exp://<LAN-IP>:8081/--/login`)을 반환한다 — 과거 `useProxy`
 *   옵션이 쓰던 `auth.expo.io` 프록시는 폐기되어 더 이상 존재하지 않는다.
 * - Development Build/Standalone 빌드에서는 `app.json`의 `scheme: "viets"`를 그대로
 *   사용해 `viets://login`을 반환한다(STEP 4-13-4의 결론과 동일).
 * 즉 이 변경은 "공식 API 사용"이라는 요구사항은 충족하지만, Expo Go에서 반복
 * 관찰된 localhost 이동 문제 자체의 코드 레벨 원인은 아니었다(STEP 4-13-6에서
 * Supabase 서버의 redirect_to 허용목록 검증 단계로 이미 격리됨) — 이 변경만으로
 * 문제가 해결됐다고 보고하지 않는다(결과 보고서 STEP 4-13-7 참고).
 *
 * PKCE 플로우를 명시적으로 사용한다(services/supabase.ts의 `flowType: 'pkce'`) —
 * supabase-js의 기본 flowType은 버전에 따라 달라질 수 있어(구버전 implicit
 * 기본값 vs 최신 권장값), 모바일 앱에 Supabase가 공식 권장하는 PKCE로 명시
 * 고정해 해시 프래그먼트(access_token) 파싱 대신 안전한 code exchange
 * (exchangeCodeForSession)만 사용하도록 했다.
 */

WebBrowser.maybeCompleteAuthSession();

/**
 * 리다이렉트 URL의 query 파라미터 하나를 추출한다. PKCE 콜백의 `code`,
 * OAuth 실패 시의 `error`/`error_description`을 읽는 데 쓴다. React Native
 * 환경에 URL/URLSearchParams 전역이 보장되지 않으므로(react-native-url-polyfill
 * 미설치 — package.json 확인됨) 정규식으로 직접 파싱한다.
 *
 * STEP 4-13-7 — `expo-auth-session`의 `QueryParams` 유틸리티로 교체하는 방안도
 * 검토했으나, 현재 설치 대상 버전(~7.0.11)에서 그 API의 정확한 시그니처/반환
 * 형태를 문서로 확인하지 못해(추측 금지 원칙) 채택하지 않았다. 이 함수는 이미
 * STEP 4-13부터 실사용으로 검증된 안전한 구현이며, 콜백 URL에서 `code`/`error`/
 * `error_description`만 추출하는 좁은 용도에는 충분하다 — 불확실한 API로
 * 교체해 동작하던 코드를 깨뜨리는 것보다 이 편이 안전하다고 판단했다.
 */
function extractParamFromUrl(url: string, key: string): string | null {
  const match = url.match(new RegExp(`[?&]${key}=([^&#]+)`));
  if (!match) {
    return null;
  }
  return decodeURIComponent(match[1].replace(/\+/g, " "));
}

/**
 * STEP 4-13-3 — URL에서 쿼리스트링(예: code)과 fragment를 제거한 origin+path만
 * 남긴다. OAuth 콜백이 실제로 "어디로" 돌아왔는지(예: localhost로 갔는지, 우리가
 * 요청한 스킴으로 갔는지)를 code 값 등 민감한 쿼리 파라미터 노출 없이 확인하기
 * 위한 용도다. extractParamFromUrl과 동일한 이유로 URL 전역 대신 문자열 처리로
 * 구현한다.
 */
function safeUrlOrigin(url: string): string {
  return url.split(/[?#]/)[0];
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.warn("[services/auth] getSession failed:", error.message);
    return null;
  }

  return data.session;
}

export async function getCurrentUser(): Promise<User | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.warn("[services/auth] getCurrentUser failed:", error.message);
    return null;
  }

  return data.user;
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): { unsubscribe: () => void } {
  if (!supabase) {
    return { unsubscribe: () => {} };
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(callback);

  return { unsubscribe: () => subscription.unsubscribe() };
}

/**
 * STEP 4-9 — Login/Register UI에서 사용하는 email/password 인증 결과.
 * error는 항상 사용자에게 그대로 노출 가능한 형태가 아니므로(Supabase 원문 메시지),
 * 호출부(화면)가 mapAuthErrorToMessageKey로 i18n 메시지 key로 변환해 표시한다.
 */
export type AuthResult = {
  session: Session | null;
  user: User | null;
  error: string | null;
};

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!supabase) {
    return { session: null, user: null, error: "auth/unavailable" };
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.warn("[services/auth] signInWithPassword failed:", error.message);
    return { session: null, user: null, error: error.message };
  }

  return { session: data.session, user: data.user, error: null };
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!supabase) {
    return { session: null, user: null, error: "auth/unavailable" };
  }

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.warn("[services/auth] signUpWithPassword failed:", error.message);
    return { session: null, user: null, error: error.message };
  }

  return { session: data.session, user: data.user, error: null };
}

export type OAuthProvider = "google" | "apple";

/**
 * STEP 4-13 — Google/Apple 공통 OAuth 로그인.
 *
 * 흐름: supabase.auth.signInWithOAuth(provider, { skipBrowserRedirect: true })로
 * authorize URL만 발급받는다 → WebBrowser.openAuthSessionAsync로 앱 내 브라우저
 * 세션을 열고 앱 스킴으로의 리다이렉트를 직접 가로챈다(별도 Linking 리스너 불필요) →
 * 콜백 URL에서 PKCE `code`를 추출해 supabase.auth.exchangeCodeForSession(code)로
 * 세션을 교환한다.
 *
 * 이 함수는 세션을 반환할 뿐 어떤 네비게이션도 수행하지 않는다 — 성공 시 세션이
 * 만들어지면 onAuthStateChange 구독을 통해 app/_layout.tsx의 기존 Auth Guard가
 * 자동으로 /login·/register → /home 전환을 처리한다(STEP 4-10 구조 재사용, 이
 * 함수/호출부 어느 쪽에도 router.replace 등 새 네비게이션 로직을 추가하지 않는다).
 *
 * 보안(§16, STEP 4-13-2에서도 재확인): access_token/refresh_token/code_verifier/
 * authorization code/Supabase key 값 자체는 어디에도 로그로 남기지 않는다 —
 * console.log/console.warn은 항상 "단계 이름 + provider + (에러의 경우) message
 * 문자열/불리언 상태"만 남긴다. STEP 4-13-2에서 추가한 진단 로그(OAUTH_START 등)도
 * 이 원칙을 그대로 따른다 — 자세한 이유는 결과 보고서(STEP 4-13-2 §8) 참고.
 *
 * STEP 4-13-3 — Google이 "localhost"로 이동하는 문제를 진단하기 위해 로그 3종을
 * 추가했다(OAUTH_BROWSER_OPEN/OAUTH_BROWSER_RESULT/OAUTH_ERROR, 결과 보고서 §5).
 * 모두 기존 로그와 동일한 원칙(민감정보 미포함)을 따른다:
 * - OAUTH_BROWSER_OPEN: Supabase가 발급한 authorize URL(data.url) 안의 redirect_to
 *   쿼리 파라미터 값만 추출해 우리가 보낸 redirectTo와 일치하는지 로그로 남긴다.
 *   전체 URL(code_challenge 등 포함)은 절대 로그로 남기지 않는다.
 * - OAUTH_BROWSER_RESULT: 콜백 URL(result.url)에서 쿼리스트링(code 포함)과 fragment를
 *   제거한 origin+path만 남긴다(safeUrlOrigin) — 실제로 어느 호스트로 돌아왔는지
 *   (예: localhost:3000 vs exp://<lan-ip>:8081)를 code 노출 없이 확인할 수 있다.
 *   기존 AUTH_SESSION_RESULT 로그는 STEP 4-13-2와의 연속성을 위해 그대로 유지한다.
 * - OAUTH_ERROR: 이 함수 전체를 try/catch로 감싸 추가했다. 기존에는 이 구간에
 *   try/catch가 없어 signInWithOAuth/openAuthSessionAsync/exchangeCodeForSession이
 *   예상치 못한 예외(네트워크 단절 등)를 던지면 그대로 상위(app/login.tsx,
 *   app/(tabs)/my.tsx의 handleSocialLogin)로 전파되어 setLoadingProvider(null)이
 *   호출되지 못하고 버튼이 계속 로딩 상태로 멈추는 문제가 있었다. 이제는 예외가
 *   나도 항상 AuthResult를 반환해 호출부의 loading 상태가 해제된다. 기존
 *   OAUTH_PROVIDER_ERROR/OAUTH_CODE_EXCHANGE_FAILED 태그는 그대로 유지하고,
 *   OAUTH_ERROR는 stage 필드로 구분되는 보조 태그로 병행 출력한다(태그 제거 없음).
 */
async function signInWithOAuthProvider(provider: OAuthProvider): Promise<AuthResult> {
  // STEP 4-13-2 — 안전한 진단 로그(§2/§8). access_token/refresh_token/code_verifier/
  // authorization code/Supabase key는 어디에도 출력하지 않는다 — 단계 이름과 그
  // 단계의 "성공/실패/타입" 같은 비민감 정보만 남긴다. Google/Apple이 이 함수 하나를
  // 공유하므로 태그는 제공자와 무관하게 공통이며 provider 인자로 구분한다.
  console.log(`[services/auth] OAUTH_START provider=${provider}`);

  if (!supabase) {
    console.warn(`[services/auth] OAUTH_ABORTED provider=${provider} reason=supabase-client-null`);
    return { session: null, user: null, error: "auth/unavailable" };
  }

  try {
    // STEP 4-13-7 — expo-auth-session의 makeRedirectUri()로 교체(파일 상단 STEP
    // 4-13-7 주석 참고). path: "login"은 app/login.tsx 라우트와 동일하게 유지해
    // STEP 4-13-3에서 결정한 "새 콜백 라우트를 만들지 않는다" 원칙을 그대로
    // 따른다. LAN IP/localhost는 어디에도 하드코딩하지 않는다 — 이 값은 전적으로
    // makeRedirectUri()가 런타임 환경(Expo Go vs Development Build)에 따라
    // 자동으로 생성한다.
    const redirectTo = makeRedirectUri({ path: "login" });
    // redirectTo 자체는 비밀값이 아니다(브라우저 주소창에도 그대로 노출되는 값) —
    // Supabase Dashboard의 Redirect URLs와 실제로 일치하는지 사용자가 직접 대조할 수
    // 있도록 그대로 남긴다(§3 Redirect URL 진단의 핵심 근거).
    console.log(`[services/auth] OAUTH_REDIRECT_CREATED provider=${provider} redirectTo=${redirectTo}`);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      console.warn(
        `[services/auth] OAUTH_AUTHORIZE_URL_FAILED provider=${provider} message=${error?.message ?? "no-url-returned"}`
      );
      return { session: null, user: null, error: error?.message ?? "auth/unavailable" };
    }
    // STEP 4-13-5 — authorize URL(data.url)의 hostname/pathname/provider 파라미터만
    // 안전하게 확인한다(§4) — code_challenge 등 나머지 쿼리는 남기지 않는다.
    // hostname이 실제 Supabase 프로젝트 도메인과 다르면 EXPO_PUBLIC_SUPABASE_URL
    // 설정 자체가 잘못됐다는 뜻이므로, 여기서부터 어긋나는지 먼저 구분할 수 있다.
    const authorizeUrlOrigin = safeUrlOrigin(data.url);
    const authorizeUrlProviderParam = extractParamFromUrl(data.url, "provider");
    console.log(
      `[services/auth] OAUTH_AUTHORIZE_URL_READY provider=${provider} urlOrigin=${authorizeUrlOrigin} providerParam=${authorizeUrlProviderParam ?? "(not-found)"}`
    );

    // STEP 4-13-3 — Supabase가 실제로 authorize URL에 심어 보낸 redirect_to 값을
    // 확인한다. 이 값이 위 OAUTH_REDIRECT_CREATED의 redirectTo와 다르면(또는
    // 비어있으면) Supabase가 우리가 보낸 redirectTo를 그대로 쓰지 않았다는 뜻이다.
    // STEP 4-13-5 — 다만 이 값이 일치한다는 것은 "클라이언트가 올바른 값을
    // 요청했다"는 것만 증명할 뿐, Supabase 서버가 이 값을 실제로 허용했는지는
    // 증명하지 않는다(§2 ROOT CAUSE 참고 — 서버 측 allow-list 검증은 별도 단계다).
    const embeddedRedirectTo = extractParamFromUrl(data.url, "redirect_to");
    console.log(
      `[services/auth] OAUTH_BROWSER_OPEN provider=${provider} embeddedRedirectTo=${embeddedRedirectTo ?? "(not-found)"} matchesRequested=${embeddedRedirectTo === redirectTo}`
    );

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    // result.type은 "success" | "cancel" | "dismiss" | "locked" 중 하나 — 브라우저
    // 세션이 어떻게 끝났는지(민감정보 없이) 구분할 수 있는 가장 중요한 신호다.
    const hasCallbackUrl = result.type === "success" && !!result.url;
    const callbackOrigin = hasCallbackUrl ? safeUrlOrigin(result.url as string) : null;
    // STEP 4-13-3 — 콜백이 실제로 어느 호스트로 돌아왔는지(예: localhost:3000 vs
    // 우리가 요청한 exp://<lan-ip>:8081)를 code 등 민감한 쿼리 없이 확인한다.
    // STEP 4-13-5 — Metro 로그에서 한눈에 "Site URL 폴백이 실제로 일어났는지"를
    // 구분할 수 있도록 isLocalhostFallback 플래그를 추가했다(§9 CASE 판정용).
    const isLocalhostFallback = !!callbackOrigin && /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(callbackOrigin);
    console.log(
      `[services/auth] OAUTH_BROWSER_RESULT provider=${provider} type=${result.type} hasUrl=${hasCallbackUrl} callbackOrigin=${callbackOrigin ?? "(none)"} isLocalhostFallback=${isLocalhostFallback}`
    );
    console.log(`[services/auth] AUTH_SESSION_RESULT provider=${provider} type=${result.type} hasUrl=${hasCallbackUrl}`);

    if (result.type !== "success" || !result.url) {
      // 사용자가 브라우저 세션을 취소/닫은 경우 — 정상적인 취소 흐름이므로 에러로
      // 취급하지 않는다(화면에 에러 토스트를 띄우지 않는다).
      return { session: null, user: null, error: null };
    }
    console.log(`[services/auth] OAUTH_CALLBACK_RECEIVED provider=${provider}`);

    const oauthError =
      extractParamFromUrl(result.url, "error_description") ?? extractParamFromUrl(result.url, "error");
    if (oauthError) {
      console.warn(`[services/auth] OAUTH_PROVIDER_ERROR provider=${provider} message=${oauthError}`);
      console.warn(`[services/auth] OAUTH_ERROR provider=${provider} stage=provider-callback message=${oauthError}`);
      return { session: null, user: null, error: oauthError };
    }

    const code = extractParamFromUrl(result.url, "code");
    if (!code) {
      console.warn(`[services/auth] OAUTH_CALLBACK_MISSING_CODE provider=${provider}`);
      return { session: null, user: null, error: "auth/unavailable" };
    }

    console.log(`[services/auth] OAUTH_CODE_EXCHANGE_STARTED provider=${provider}`);
    const { data: sessionData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.warn(`[services/auth] OAUTH_CODE_EXCHANGE_FAILED provider=${provider} message=${exchangeError.message}`);
      console.warn(`[services/auth] OAUTH_ERROR provider=${provider} stage=code-exchange message=${exchangeError.message}`);
      return { session: null, user: null, error: exchangeError.message };
    }

    console.log(`[services/auth] OAUTH_CODE_EXCHANGE_SUCCESS provider=${provider} hasSession=${!!sessionData.session}`);
    return { session: sessionData.session, user: sessionData.user, error: null };
  } catch (err) {
    // STEP 4-13-3 — 위 try 블록 전체에 대한 안전망. err 자체(스택 등)는 로그로
    // 남기지 않고 message 문자열만 남긴다(민감정보 포함 가능성 배제 원칙 유지).
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn(`[services/auth] OAUTH_ERROR provider=${provider} stage=unexpected-exception message=${message}`);
    return { session: null, user: null, error: "auth/unavailable" };
  }
}

export async function signInWithGoogle(): Promise<AuthResult> {
  return signInWithOAuthProvider("google");
}

export async function signInWithApple(): Promise<AuthResult> {
  return signInWithOAuthProvider("apple");
}

/**
 * Supabase 원문 에러 메시지 → i18n 메시지 key. 알 수 없는 메시지는 항상
 * "auth.errors.generic"으로 폴백한다(기술적 원문을 화면에 그대로 노출하지 않는다).
 */
export function mapAuthErrorToMessageKey(message: string): string {
  const normalized = message.toLowerCase();

  if (message === "auth/unavailable") {
    return "auth.errors.unavailable";
  }
  if (normalized.includes("invalid login credentials")) {
    return "auth.errors.invalidCredentials";
  }
  if (normalized.includes("already registered") || normalized.includes("already exists")) {
    return "auth.errors.emailInUse";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "auth.errors.network";
  }
  if (normalized.includes("password") && normalized.includes("character")) {
    return "auth.errors.weakPassword";
  }
  return "auth.errors.generic";
}
