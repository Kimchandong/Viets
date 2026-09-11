/**
 * 앱 전역에서 공유하는 브랜드 아이콘 상수.
 *
 * [STEP: 2026-09-09] 사용자 요청 — 로그인 팝업(components/LoginPromptModal.tsx)에서도
 * app/(tabs)/my.tsx와 동일한 Google 브랜드 컬러 아이콘을 써야 해서, my.tsx에 로컬로
 * 있던 GOOGLE_ICON_URI를 이 파일로 공용 추출했다.
 *
 * [2026-09-11 수정] 여기 들어 있던 base64 PNG는 **깨진 파일**이었다. PNG 청크를
 * 검사해 보면 IHDR / PLTE / tRNS / IEND는 멀쩡한데 IDAT(실제 픽셀 데이터)의 CRC가
 * 맞지 않아 디코딩 자체가 실패한다. <Image>는 조용히 아무것도 그리지 않으므로
 * "아이콘이 안 보인다"로만 드러났다 — 주석에는 4색 로고를 내장했다고 적혀 있었지만
 * 실제로는 유효한 이미지가 아니었다.
 *
 * 대신 Google이 자사 로그인 연동 문서에서 공개적으로 제공하는 공식 로고 파일을
 * 가리킨다. 브랜드 로고는 임의로 다시 그리면 안 되고(모양·색·비율이 가이드라인으로
 * 정해져 있다), Google도 공식 에셋 사용을 요구한다.
 *
 * @expo/vector-icons의 "logo-google"은 단일 색상 글리프라 4색 마크를 표현할 수 없고,
 * 이 프로젝트에는 벡터 아이콘 라이브러리를 추가하지 않는다(새 npm dependency 추가
 * 금지 원칙).
 *
 * 트레이드오프: 원격 이미지라 첫 표시에 네트워크가 필요하다. 이 아이콘이 쓰이는
 * 곳은 로그인 버튼뿐이고 로그인 자체가 네트워크를 쓰므로 실사용에서는 문제가 없다.
 * 완전한 오프라인 표시가 필요해지면 Google 브랜딩 가이드라인 페이지에서 공식 에셋을
 * 내려받아 assets/images/google-logo.png 로 두고 아래를 require(...)로 바꾸면 된다.
 * https://developers.google.com/identity/branding-guidelines
 */
export const GOOGLE_ICON_URI = "https://developers.google.com/identity/images/g-logo.png";
