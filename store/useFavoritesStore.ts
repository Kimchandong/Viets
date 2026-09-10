/**
 * [FULL-DEV] 관심 매물/투자상품 전역 상태 (Zustand, in-memory).
 *
 * DATABASE.md의 favorites 테이블(target_type/target_id 패턴, D-무관 — Public
 * 스키마의 일반적인 폴리모픽 관심목록 패턴)과 동일한 key shape을 사용해, 이후
 * Supabase 연동 시 이 store의 내부 구현(favorites 객체)만 실제 favorites 테이블
 * 조회/insert/delete로 교체하면 되도록 구성했다. store/useLocaleStore.ts와
 * 동일한 제약으로 AsyncStorage 등 영구 저장 패키지가 설치되어 있지 않으므로
 * (새 dependency 추가 금지 원칙) 메모리 상태만 관리한다 — 앱을 재시작하면
 * 초기화되며, 실제 영구 저장은 Phase 9(Supabase 연동)에서 교체한다.
 */
import { create } from "zustand";

export type FavoriteTargetType = "property" | "investment_product";

function keyOf(targetType: FavoriteTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

type FavoritesState = {
  /** key = "property:p1" 형태. Set 대신 plain Record를 써서 새 객체 참조를 만들어야
   * React/Zustand가 변경을 감지한다(Set을 그대로 mutate하면 참조가 안 바뀐다). */
  favorites: Record<string, true>;
  isFavorite: (targetType: FavoriteTargetType, targetId: string) => boolean;
  /** 토글 후의 새 상태(true = 방금 추가됨)를 반환한다 — 호출부가 Toast 문구(추가됨/제거됨)를 분기할 때 쓴다. */
  toggleFavorite: (targetType: FavoriteTargetType, targetId: string) => boolean;
  favoriteIdsByType: (targetType: FavoriteTargetType) => string[];
};

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: {},

  isFavorite: (targetType, targetId) => !!get().favorites[keyOf(targetType, targetId)],

  toggleFavorite: (targetType, targetId) => {
    const key = keyOf(targetType, targetId);
    const current = get().favorites;
    const willBeFavorite = !current[key];
    const next = { ...current };
    if (willBeFavorite) {
      next[key] = true;
    } else {
      delete next[key];
    }
    set({ favorites: next });
    return willBeFavorite;
  },

  favoriteIdsByType: (targetType) => {
    const prefix = `${targetType}:`;
    return Object.keys(get().favorites)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  },
}));
