// Expo SDK 54의 공식 flat ESLint config를 사용한다.
// 이 설정은 실행 검증(npm install/eslint 실행)을 하지 못한 상태로 작성되었으므로,
// 문제가 있으면 `npx expo lint`를 실행해 Expo 공식 스캐폴딩으로 재생성하는 것을 권장한다.
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  {
    // dist/*        — 빌드 산출물
    //
    // supabase/functions/** — **Deno 런타임**이다. 이 파일들은 Node가 아니라 Deno가
    //   실행하므로 `jsr:@supabase/supabase-js@2` 같은 JSR/URL import를 쓴다.
    //   Node용 resolver는 이 스키마를 모르므로 "Unable to resolve path to module"
    //   오류를 5건 낸다 — 코드가 잘못된 게 아니라 린터가 다른 런타임을 보고 있는 것이다.
    //   (문법 검사가 필요하면 `deno check supabase/functions/*/index.ts`)
    //
    // .expo/**      — expo-router가 자동 생성하는 타입 파일. 사람이 고치는 파일이 아니다.
    ignores: ["dist/*", "supabase/functions/**", ".expo/**"],
  },
];
