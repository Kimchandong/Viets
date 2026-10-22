import { createContext, useContext } from "react";

/**
 * [2026-10-22 사용자 지시] MY의 운영 메뉴를 "메뉴 클릭 → 탭으로 전환" 구조로 바꾼다.
 *
 * 한 탭의 내용은 이미 독립 화면으로 존재한다(my-properties, ad-manage, chat-inbox …).
 * 그 화면들을 탭 안에 그대로 끼워 넣으면 화면마다 들어 있는 <Header>가 탭 화면의
 * 헤더와 겹쳐 제목이 두 줄로 쌓인다.
 *
 * 각 화면의 본문을 컴포넌트로 떼어내는 방법도 있었지만, 여덟 화면 모두가 권한 체크·
 * 로딩·빈 상태마다 **자기 Header를 가진 return을 따로** 갖고 있어(예: my-properties는
 * 3개) 분해하면 그만큼 깨질 자리가 늘어난다. 잘 돌아가는 화면을 건드리지 않는 쪽을
 * 택했다 — 끼워 넣은 화면에서는 Header가 스스로 그리지 않는다.
 *
 * 기존 경로(/my-properties 등)는 그대로 살아 있다. 푸시 알림과 딥링크가 그 주소로
 * 들어오므로 없애면 알림을 눌렀을 때 갈 곳이 사라진다.
 */
const EmbeddedScreenContext = createContext(false);

export function EmbeddedScreen({ children }: { children: React.ReactNode }) {
  return <EmbeddedScreenContext.Provider value>{children}</EmbeddedScreenContext.Provider>;
}

/** 지금 이 컴포넌트가 다른 화면 안에 끼워진 상태인가. */
export function useIsEmbedded(): boolean {
  return useContext(EmbeddedScreenContext);
}
