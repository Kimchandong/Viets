import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ExpoCrypto from "expo-crypto";
import { Platform } from "react-native";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client singleton.
 *
 * 이 파일은 client 생성만 책임진다 — Auth/Database/Storage/Realtime 호출 로직은
 * 포함하지 않는다(각각 별도 STEP에서 다룬다).
 *
 * EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY가 아직 설정되지 않은
 * 개발 환경(.env 미생성 상태)에서는 fake 값을 넣거나 앱을 강제 crash시키지 않고,
 * `supabase`를 null로 유지한다. 실제 값이 설정되면 정상적인 client가 생성된다.
 * 이 client를 사용하는 코드는 반드시 null을 먼저 체크해야 한다(사용처는 이후 STEP에서 결정).
 */

/**
 * STEP 4-13-1 — PKCE S256 WebCrypto 폴리필.
 *
 * 원인: React Native(Hermes)는 브라우저의 WebCrypto SubtleCrypto(`crypto.subtle`)를
 * 구현하지 않는다. @supabase/auth-js의 generatePKCEChallenge()(src/lib/helpers.ts)는
 * 매번 `typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined" &&
 * typeof TextEncoder !== "undefined"`를 확인하고, 이 중 하나라도 없으면 — 오류를
 * 던지는 대신 RFC 7636이 허용하는 안전한 폴백으로 — code_challenge_method를
 * "S256" 대신 "plain"으로 낮추면서 다음 경고를 남긴다(auth-js 소스에서 직접 확인):
 * "WebCrypto API is not supported. Code challenge method will default to use plain
 * instead of sha256."
 * generatePKCEVerifier()도 `crypto.getRandomValues`가 없으면 Math.random() 기반
 * 문자열로 대체한다.
 *
 * 해결(plain 강제도, 경고 suppress도 아님 — 실제로 SHA-256을 계산해 S256을
 * 정상 생성한다): auth-js가 실제로 호출하는 표면은 정확히 두 곳뿐이다 —
 * crypto.subtle.digest("SHA-256", Uint8Array) 한 곳(sha256() 헬퍼, 알고리즘 인자는
 * 항상 문자열 "SHA-256" 리터럴)과 crypto.getRandomValues(typedArray) 한 곳
 * (generatePKCEVerifier()). 이 두 메서드만 Expo Go에 기본 포함된 expo-crypto의
 * digest()/getRandomValues()(둘 다 SubtleCrypto/Crypto와 동일한 입출력 계약)로
 * 최소 폴리필한다 — crypto.subtle 전체를 흉내내지 않고 실제로 쓰이는 부분만 채운다.
 * 이미 존재하는 crypto/crypto.subtle/crypto.getRandomValues는 절대 덮어쓰지 않는다.
 *
 * TextEncoder는 별도로 폴리필하지 않았다 — React Native 0.81(Hermes)이 기본
 * 제공한다고 판단했으나 이 세션에서 실기기로 직접 확인할 수는 없었다. 이 폴리필
 * 적용 후에도 동일 경고가 재현된다면 TextEncoder 누락이 남은 원인일 가능성이
 * 높다 — 결과 보고서 REMAINING CONFIGURATION 참고.
 */
type MinimalCryptoSubtle = {
  digest: (algorithm: string, data: BufferSource) => Promise<ArrayBuffer>;
};
type MinimalCrypto = {
  subtle?: MinimalCryptoSubtle;
  getRandomValues?: typeof ExpoCrypto.getRandomValues;
};

function toExpoDigestAlgorithm(algorithm: string): ExpoCrypto.CryptoDigestAlgorithm {
  switch (algorithm.toUpperCase()) {
    case "SHA-1":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA1;
    case "SHA-256":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA256;
    case "SHA-384":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA384;
    case "SHA-512":
      return ExpoCrypto.CryptoDigestAlgorithm.SHA512;
    default:
      // auth-js는 실제로 "SHA-256"만 호출한다 — 다른 값이 오면 plain으로 조용히
      // 낮아지는 대신 명확한 오류로 드러낸다(§4: 경고를 숨기지 않는다).
      throw new Error(`[services/supabase] PKCE 폴리필이 지원하지 않는 digest algorithm: ${algorithm}`);
  }
}

function installPkceCryptoPolyfill(): void {
  const target = globalThis as unknown as { crypto?: MinimalCrypto };

  if (!target.crypto) {
    target.crypto = {};
  }

  if (!target.crypto.getRandomValues) {
    target.crypto.getRandomValues = (array) => ExpoCrypto.getRandomValues(array);
  }

  if (!target.crypto.subtle) {
    target.crypto.subtle = {
      digest: (algorithm, data) => ExpoCrypto.digest(toExpoDigestAlgorithm(algorithm), data),
    };
  }
}

installPkceCryptoPolyfill();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * STEP 4-13 — Google/Apple 소셜 로그인(services/auth.ts)이 PKCE 콜백의 `code`
 * 파라미터를 exchangeCodeForSession(code)로 교환하는 방식을 쓰므로, flowType을
 * 'pkce'로 명시 고정한다. supabase-js 버전에 따라 기본 flowType이 달라질 수
 * 있어(레거시 implicit 기본값 vs 최신 권장값) 명시하지 않으면 콜백 URL에 code
 * 대신 access_token/refresh_token이 해시 프래그먼트로 오는 implicit 플로우로
 * 동작할 수 있다 — 이 프로젝트는 모바일 앱이므로 Supabase가 공식 권장하는
 * PKCE만 사용한다(해시 프래그먼트 파싱을 하지 않는다).
 */
/**
 * [2026-09-11] 세션 유지 — 앱을 완전히 종료하면 로그인이 풀리던 버그 수정.
 *
 * 원인: supabase-js는 세션을 `storage` 옵션에 저장하는데, 기본값이 브라우저의
 * `localStorage`다. React Native에는 localStorage가 없어 auth-js가 메모리 저장으로
 * 조용히 물러나고, 그 결과 세션이 **프로세스가 살아 있는 동안에만** 유지됐다.
 * 앱을 내렸다 올리면 매번 다시 로그인해야 했다(2026-09-11 실기기 QA에서 확인).
 *
 * 해결: 네이티브에서는 AsyncStorage를 저장소로 넘긴다. 웹(Expo web)에서는 기본
 * localStorage가 정상 동작하므로 건드리지 않는다 — AsyncStorage의 웹 구현도
 * 결국 localStorage지만, 굳이 한 겹 더 감쌀 이유가 없다.
 *
 * 나머지 옵션의 의미:
 *   - persistSession: 저장소에 세션을 쓴다(기본 true지만, 이 설정의 의도를 명시한다).
 *   - autoRefreshToken: access token 만료 전에 자동 갱신한다. 이게 없으면 한 시간쯤
 *     뒤 모든 요청이 401이 되고 사용자에게는 "갑자기 로그아웃된" 것처럼 보인다.
 *   - detectSessionInUrl: URL 해시에서 세션을 읽는 웹 전용 동작이다. 이 앱의
 *     OAuth 콜백은 services/auth.ts가 exchangeCodeForSession()으로 직접 처리하므로
 *     네이티브에서는 꺼 둔다(웹에서는 기본값 그대로 둔다).
 */
const isNative = Platform.OS !== "web";

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          ...(isNative
            ? { storage: AsyncStorage, detectSessionInUrl: false }
            : {}),
        },
      })
    : null;

if (!supabase) {
  console.warn(
    "[services/supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않아 Supabase client를 생성하지 않았습니다. .env를 확인하세요."
  );
}
