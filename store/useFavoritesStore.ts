/**
 * [FULL-DEV] 관심 매물/투자상품 전역 상태 (Zustand).
 *
 * DATABASE.md의 favorites 테이블(target_type/target_id 폴리모픽 패턴)과 동일한 key
 * shape을 쓴다.
 *
 * [STEP 04, 2026-09-10] 메모리 전용 → 실제 Supabase `favorites` 테이블 연동으로
 * 교체했다(migration: 20260910063736_favorites.sql). 화면(app/property-detail,
 * app/invest-detail)이 쓰는 API — isFavorite(동기 boolean) / toggleFavorite(동기
 * boolean 반환) — 는 그대로 유지했다. 서버 왕복을 기다리면 하트가 늦게 반응하므로
 * **낙관적 업데이트**로 동작한다: 탭한 즉시 로컬 상태를 바꿔 boolean을 반환하고,
 * 서버 반영은 백그라운드로 진행하며 실패하면 원래 상태로 되돌린다.
 *
 * 로그인 상태 변화(services/auth.ts onAuthStateChange)를 이 모듈에서 직접 구독해,
 * 로그인 시 서버 목록을 불러오고 로그아웃 시 비운다 — 화면마다 로드 코드를 넣지
 * 않기 위한 선택이다(비로그인 상태에서는 찜 자체가 불가능하며, 화면들이 이미
 * 세션 체크 후 로그인 유도 팝업을 띄운다).
 */
import { create } from "zustand";

import { addFavorite, fetchFavorites, removeFavorite } from "@/services/favorites";
import { getSession, onAuthStateChange } from "@/services/auth";

export type FavoriteTargetType = "property" | "investment_product";

function keyOf(targetType: FavoriteTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

type FavoritesState = {
  /** key = "property:<uuid>" 형태. Set 대신 plain Record를 써서 새 객체 참조를 만들어야
   * React/Zustand가 변경을 감지한다(Set을 그대로 mutate하면 참조가 안 바뀐다).
   * 값 타입에 undefined를 포함시키는 이유: 찜하지 않은 key는 실제로 undefined인데
   * `Record<string, true>`로 두면 TS가 인덱스 접근 결과를 항상 true로 좁혀버려
   * 존재 여부 비교가 "겹치지 않는 타입" 오류가 된다. */
  favorites: Record<string, true | undefined>;
  isFavorite: (targetType: FavoriteTargetType, targetId: string) => boolean;
  /** 토글 후의 새 상태(true = 방금 추가됨)를 즉시 반환한다 — 호출부가 Toast 문구
   * (추가됨/제거됨)를 분기할 때 쓴다. 서버 반영은 백그라운드에서 진행되며, 실패 시
   * 로컬 상태를 자동으로 되돌린다. */
  toggleFavorite: (targetType: FavoriteTargetType, targetId: string) => boolean;
  favoriteIdsByType: (targetType: FavoriteTargetType) => string[];
  /** 서버에서 찜 목록을 다시 불러와 로컬 상태를 교체한다(로그인 직후 자동 호출). */
  syncFromServer: () => Promise<void>;
  /** 로그아웃 시 로컬 상태를 비운다 — 다음 사용자에게 이전 사용자의 찜이 보이면 안 된다. */
  clear: () => void;
};

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: {},

  isFavorite: (targetType, targetId) => !!get().favorites[keyOf(targetType, targetId)],

  toggleFavorite: (targetType, targetId) => {
    const key = keyOf(targetType, targetId);
    const current = get().favorites;
    const willBeFavorite = !current[key];

    // 1) 낙관적 업데이트 — 화면은 즉시 반응한다.
    const next = { ...current };
    if (willBeFavorite) {
      next[key] = true;
    } else {
      delete next[key];
    }
    set({ favorites: next });

    // 2) 서버 반영 — 실패하면 이 토글만 되돌린다(그 사이 사용자가 다시 토글했다면
    //    그 결과를 존중해 되돌리지 않는다).
    const request = willBeFavorite
      ? addFavorite(targetType, targetId)
      : removeFavorite(targetType, targetId);

    void request.then((ok) => {
      if (ok) return;
      const latest = get().favorites;
      const stillSameAsOptimistic = !!latest[key] === willBeFavorite;
      if (!stillSameAsOptimistic) return;

      const reverted = { ...latest };
      if (willBeFavorite) {
        delete reverted[key];
      } else {
        reverted[key] = true;
      }
      set({ favorites: reverted });
    });

    return willBeFavorite;
  },

  favoriteIdsByType: (targetType) => {
    const prefix = `${targetType}:`;
    return Object.keys(get().favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  },

  syncFromServer: async () => {
    const rows = await fetchFavorites();
    const next: Record<string, true | undefined> = {};
    rows.forEach((row) => {
      next[keyOf(row.target_type, row.target_id)] = true;
    });
    set({ favorites: next });
  },

  clear: () => set({ favorites: {} }),
}));

// 앱 시작 시 이미 로그인 상태라면(세션 복원) 바로 한 번 불러온다.
void getSession().then((session) => {
  if (session) {
    void useFavoritesStore.getState().syncFromServer();
  }
});

// 이후 로그인/로그아웃에 따라 동기화한다.
onAuthStateChange((_event, session) => {
  if (session) {
    void useFavoritesStore.getState().syncFromServer();
  } else {
    useFavoritesStore.getState().clear();
  }
});
