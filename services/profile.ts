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

/**
 * [2026-09-14 사용자 결정] 본인 계정 삭제 — 스토어 심사 필수 기능.
 *
 * 실제 삭제는 DB 함수 delete_my_account()가 한다(20260917000000). 클라이언트가
 * 표를 하나씩 지우지 않는 이유: 지우는 순서를 틀리면 외래키에 막혀 중간에서 멈추고,
 * 그러면 "반쯤 지워진 계정"이 남는다. 서버 함수 하나가 트랜잭션으로 처리한다.
 *
 * 거부 사유를 그대로 돌려주는 이유: 화면이 "관리자라서"인지 "잔액이 남아서"인지
 * 구분해 안내해야 사용자가 다음에 무엇을 할지 안다.
 */
export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: "admin" | "balance" | "not_signed_in" | "failed" };

export async function deleteMyAccount(): Promise<DeleteAccountResult> {
  if (!supabase) return { ok: false, reason: "failed" };

  const { data, error } = await supabase.rpc("delete_my_account");

  if (error) {
    console.warn("[services/profile] deleteMyAccount failed:", error.message);
    return { ok: false, reason: "failed" };
  }

  const row = data as { ok?: boolean; reason?: string } | null;
  if (row?.ok) return { ok: true };

  const reason = row?.reason;
  if (reason === "admin" || reason === "balance" || reason === "not_signed_in") {
    return { ok: false, reason };
  }
  return { ok: false, reason: "failed" };
}
