import { Loading } from "@/components/Loading";

// 앱 진입점. STEP 03 범위에는 Intro 화면(YouTube 5초 인트로)이 포함되지 않으므로
// Intro 화면은 Phase 3에서 이 파일을 대체/확장한다.
//
// STEP 4-10: STEP 4-9A의 임시 "무조건 /login" 리다이렉트를 제거했다. 실제 라우팅
// 분기(세션 있음 → /home, 없음 → /login)는 app/_layout.tsx의 Auth Guard가 최상위에서
// 담당한다 — 이 파일은 라우팅 로직을 갖지 않는다. RootLayout은 getSession() 조회가
// 끝날 때까지 Stack 자체를 마운트하지 않으므로, 이 화면은 Auth Guard가 리다이렉트를
// 실행하는 그 짧은 순간에만(세션은 이미 조회된 상태) 중립 로딩 화면으로 보인다.
export default function Index() {
  return <Loading fullscreen />;
}
