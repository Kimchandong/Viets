import { supabase } from "./supabase";

/**
 * [STEP 04] 찜하기(즐겨찾기) 서버 저장 — DATABASE.md §4 favorites 테이블.
 *
 * 지금까지 store/useFavoritesStore.ts가 메모리에만 들고 있던 찜 목록을 실제
 * Supabase 테이블로 옮긴다. 이 테이블은 RLS(Owner-Only)로 본인 행만 다룰 수 있어
 * 클라이언트가 직접 insert/delete한다(DATABASE.md §4 원문 — 금전 데이터가 아니므로
 * Edge Function을 경유하지 않는 예외).
 *
 * services 전역 원칙에 따라 이 파일의 함수는 예외를 던지지 않는다 — 실패는
 * boolean(또는 빈 배열)로 반환하고, 호출부(store)가 낙관적 업데이트를 되돌린다.
 */

export type FavoriteTargetType = "property" | "investment_product";

const FAVORITES_TABLE = "favorites";

type FavoriteRow = { target_type: FavoriteTargetType; target_id: string };

/** 현재 로그인 사용자의 찜 목록 전체. 비로그인/미설정이면 빈 배열. */
export async function fetchFavorites(): Promise<FavoriteRow[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.from(FAVORITES_TABLE).select("target_type,target_id");

  if (error) {
    console.warn("[services/favorites] fetchFavorites failed:", error.message);
    return [];
  }
  return (data ?? []) as FavoriteRow[];
}

/** 찜 추가. 이미 있으면(UNIQUE 위반) 성공으로 취급한다 — 결과 상태가 동일하기 때문. */
export async function addFavorite(targetType: FavoriteTargetType, targetId: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      console.warn("[services/favorites] addFavorite: no authenticated user");
      return false;
    }

    const { error } = await supabase
      .from(FAVORITES_TABLE)
      .insert({ user_id: userId, target_type: targetType, target_id: targetId });

    if (error) {
      // 23505 = unique_violation — 다른 기기/탭에서 이미 찜한 경우로, 실패가 아니다.
      if (error.code === "23505") {
        return true;
      }
      console.warn("[services/favorites] addFavorite failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/favorites] addFavorite threw:", message);
    return false;
  }
}

/** 찜 해제. 이미 없으면 삭제 0건이지만 결과 상태가 동일하므로 성공으로 취급한다. */
export async function removeFavorite(targetType: FavoriteTargetType, targetId: string): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { error } = await supabase
    .from(FAVORITES_TABLE)
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId);

  if (error) {
    console.warn("[services/favorites] removeFavorite failed:", error.message);
    return false;
  }
  return true;
}
