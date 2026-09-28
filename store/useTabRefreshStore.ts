import { create } from "zustand";

/**
 * [2026-09-28 사용자 지시] 하단 탭을 누르면 **그 탭은 항상 새로 시작한다.**
 *
 * 요구사항이 둘이다:
 *   1. 이전에 고른 필터·펼친 항목·스크롤 위치가 남아 있으면 안 된다
 *   2. 그 사이에 올라온 새 정보가 바로 보여야 한다
 *
 * 둘 다 "화면을 다시 마운트한다" 하나로 해결된다 — 상태는 초기값으로 돌아가고,
 * 마운트 시 조회가 다시 돈다.
 *
 * 왜 이런 store가 필요한가: React Navigation 7에서 `unmountOnBlur` 옵션이 없어졌다.
 * 대신 탭 바가 눌린 순간(tabPress)에 이 카운터를 올리고, 각 탭 화면은 그 값을
 * React key로 써서 스스로 다시 마운트한다.
 *
 * 왜 포커스가 아니라 **탭 누름**인가: 상세 화면에서 뒤로 돌아올 때까지 초기화하면
 * 목록을 한참 내려보다 매물 하나를 열어 본 사람이 돌아올 때마다 맨 위로 튕긴다.
 * 탭을 누르는 것은 "처음부터 다시 본다"는 분명한 의사표시다(이미 그 탭에 있을 때
 * 한 번 더 누르는 것도 새로고침이 된다).
 */
/**
 * [2026-09-28 사용자 지시] **AI는 빠져 있다.** 다른 탭은 목록이라 다시 그려도
 * 잃을 게 없지만 AI 탭은 대화라, 탭을 한 번 더 누른 것만으로 주고받던 내용이
 * 사라지면 안 된다.
 */
export type TabKey = "home" | "property" | "invest" | "my";

type TabRefreshState = {
  /** 탭별 누적 횟수. 이 값이 바뀌면 해당 화면이 다시 마운트된다. */
  counters: Record<TabKey, number>;
  bump: (tab: TabKey) => void;
};

export const useTabRefreshStore = create<TabRefreshState>((set) => ({
  counters: { home: 0, property: 0, invest: 0, my: 0 },
  bump: (tab) =>
    set((state) => ({ counters: { ...state.counters, [tab]: state.counters[tab] + 1 } })),
}));

/** 탭 화면이 자기 remount key를 읽는다. */
export function useTabRefreshKey(tab: TabKey): number {
  return useTabRefreshStore((state) => state.counters[tab]);
}
