import { readImageBytes } from "@/utils/imageBytes";
import { supabase } from "./supabase";

/**
 * [2026-09-11 사용자 지시] MY 화면 프로필 사진.
 *
 * 저장 위치는 이미 있는 public.profiles.avatar_url이다(20260828083711). 파일은
 * 공개 버킷 avatars에 `<uid>/<timestamp>.<ext>`로 올린다 — 경로 첫 칸을 uid로 두는
 * 규칙은 storage 정책(20260911210000_avatars.sql)이 강제한다.
 *
 * 파일 이름에 timestamp를 붙이는 이유: 같은 이름으로 덮어쓰면 CDN/앱 이미지 캐시가
 * 옛 사진을 계속 보여 준다. 새 이름으로 올리고 avatar_url만 바꾸면 즉시 반영된다.
 */

const AVATARS_BUCKET = "avatars";

/** 내 프로필 사진 URL. 없거나 비로그인이면 null. */
export async function getMyAvatarUrl(): Promise<string | null> {
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[services/profile] getMyAvatarUrl failed:", error.message);
    return null;
  }
  return data?.avatar_url ?? null;
}

/**
 * 고른 사진을 올리고 profiles.avatar_url을 갱신한다.
 * 성공하면 새 공개 URL, 실패하면 null(호출부가 안내 문구를 띄운다).
 */
export async function uploadMyAvatar(localUri: string): Promise<string | null> {
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  try {
    const { bytes, contentType, fileExt } = await readImageBytes(localUri);
    const path = `${userId}/${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(path, bytes, { contentType });

    if (uploadError) {
      console.warn("[services/profile] avatar upload failed:", uploadError.message);
      return null;
    }

    const { data: publicData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
    const publicUrl = publicData?.publicUrl ?? null;
    if (!publicUrl) return null;

    // URL을 못 적으면 업로드는 됐어도 화면에는 계속 옛 사진이 보인다 — 실패로 처리한다.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", userId);

    if (updateError) {
      console.warn("[services/profile] avatar_url update failed:", updateError.message);
      return null;
    }
    return publicUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/profile] uploadMyAvatar threw:", message);
    return null;
  }
}
