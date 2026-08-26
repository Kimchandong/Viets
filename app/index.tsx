import { Redirect } from "expo-router";

// 앱 진입점. STEP 03 범위에는 Intro 화면(YouTube 5초 인트로)이 포함되지 않으므로
// 바로 HOME 탭으로 이동한다. Intro 화면은 Phase 3에서 이 파일을 대체/확장한다.
export default function Index() {
  return <Redirect href="/home" />;
}
