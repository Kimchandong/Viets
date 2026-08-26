// Expo SDK 54의 공식 flat ESLint config를 사용한다.
// 이 설정은 실행 검증(npm install/eslint 실행)을 하지 못한 상태로 작성되었으므로,
// 문제가 있으면 `npx expo lint`를 실행해 Expo 공식 스캐폴딩으로 재생성하는 것을 권장한다.
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  {
    ignores: ["dist/*"],
  },
];
