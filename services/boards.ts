import { SUPPORTED_LANGUAGES } from "@/i18n";
import { readImageBytes } from "@/utils/imageBytes";
import { translateOnce } from "./contentTranslation";
import { supabase } from "./supabase";

/**
 * [2026-09-11 사용자 지시] 게시판 — 공지사항 / QA / FAQ.
 *
 * 홈의 "시장 소식"은 코드에 박힌 목업 3건이었다. 그 자리를 관리자가 올린 공지사항
 * 최신 10건으로 바꾼다.
 *
 * 번역(사용자 결정): 공지사항과 FAQ는 **등록할 때** 6개 언어를 미리 만들어 둔다.
 * 조회할 때 번역하면 처음 여는 사람이 기다려야 하고, 같은 글을 여는 사람이 늘수록
 * 호출이 늘어난다. 등록 시점에 한 번 만들어 두면 비용이 글 건수만큼으로 고정된다.
 * QA는 번역하지 않는다 — 익명 사용자 글이라 원문 그대로 둔다.
 *
 * 번역은 services/chat.ts와 같은 translate 엣지 함수를 쓴다. API 키를 앱에 두지
 * 않기 위해서이고(EXPO_PUBLIC_* 는 APK에 평문으로 박힌다), 그 함수가 전역 캐시와
 * 사용량 로그를 함께 처리하기 때문이기도 하다 — 관리자 화면의 번역 사용량 집계에
 * 이 글들도 같이 잡혀야 한다.
 */

/**
 * [2026-09-14 사용자 결정] terms·privacy 추가.
 *
 * 약관과 개인정보처리방침을 i18n에 문구로 박지 않고 게시판 글로 두는 이유:
 * 원문이 베트남 법무법인에서 **출시 직전에** 온다. 코드에 박아 두면 그때 재빌드와
 * 재심사를 해야 하지만, 글로 두면 관리자 화면에서 붙여넣는 것으로 끝난다.
 * 기존 자동 번역 파이프라인(6개 언어)도 그대로 탄다.
 *
 * 목록으로 훑어보는 글이 아니므로 공개 게시판 탭(app/(tabs)/boards.tsx)에는 넣지
 * 않는다 — MY 설정에서 각각 전용 화면으로 연다.
 */
export type BoardKind = "notice" | "qa" | "faq" | "terms" | "privacy";

/** 법적 고지 문서. 종류당 "현재 시행 중인 것" 한 건만 화면에 보여 준다. */
export type LegalKind = "terms" | "privacy";

export const LEGAL_KINDS: LegalKind[] = ["terms", "privacy"];

export type BoardPost = {
  id: string;
  kind: BoardKind;
  /** 뷰어의 언어로 고른 제목(번역본이 있으면 번역본, 없으면 원문). */
  title: string;
  body: string;
  /** 원문 — 관리자 수정 화면은 번역본이 아니라 이걸 고쳐야 한다. */
  originalTitle: string;
  originalBody: string;
  sourceLang: string;
  authorId: string | null;
  answerBody: string;
  answeredAt: string | null;
  pinned: boolean;
  published: boolean;
  createdAt: string;
  images: string[];
};

const BOARD_IMAGES_BUCKET = "board-images";

const POST_COLUMNS =
  "id,kind,title,body,source_lang,title_i18n,body_i18n,author_id,answer_body,answered_at,pinned,published,created_at,board_post_images(url,sort_order)";

type LangMap = Record<string, string> | null;

type PostRow = {
  id: string;
  kind: BoardKind;
  title: string;
  body: string | null;
  source_lang: string | null;
  title_i18n: LangMap;
  body_i18n: LangMap;
  author_id: string | null;
  answer_body: string | null;
  answered_at: string | null;
  pinned: boolean;
  published: boolean;
  created_at: string;
  board_post_images?: { url: string; sort_order: number | null }[] | null;
};

/**
 * 뷰어 언어로 보여 줄 문장을 고른다.
 *
 * 번역본이 없으면 원문으로 떨어진다 — 번역이 실패했거나(등록 시 API 오류) 아직
 * 번역 대상이 아닌 글(QA)이 그렇다. 빈 화면보다 원문이 낫다.
 */
function pickLang(original: string, map: LangMap, sourceLang: string, lang: string): string {
  if (lang === sourceLang) return original;
  const translated = map?.[lang];
  return translated && translated.length > 0 ? translated : original;
}

function mapPost(row: PostRow, lang: string): BoardPost {
  const sourceLang = row.source_lang ?? "ko";
  const body = row.body ?? "";
  return {
    id: row.id,
    kind: row.kind,
    title: pickLang(row.title, row.title_i18n, sourceLang, lang),
    body: pickLang(body, row.body_i18n, sourceLang, lang),
    originalTitle: row.title,
    originalBody: body,
    sourceLang,
    authorId: row.author_id,
    answerBody: row.answer_body ?? "",
    answeredAt: row.answered_at,
    pinned: row.pinned,
    published: row.published,
    createdAt: row.created_at,
    images: (row.board_post_images ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((image) => image.url),
  };
}

/**
 * 게시판 글 목록.
 *
 * @param includeUnpublished 관리자 화면에서만 true — 내려둔 글도 같이 본다.
 *   RLS가 어차피 남의 비공개 글을 주지 않으므로, 이 플래그는 "관리자가 자기 화면에서
 *   숨긴 글까지 보겠다"는 뜻일 뿐 권한을 넓히지 않는다.
 */
export async function listBoardPosts(
  kind: BoardKind,
  lang: string,
  options: { limit?: number; includeUnpublished?: boolean } = {},
): Promise<BoardPost[]> {
  if (!supabase) return [];

  let request = supabase
    .from("board_posts")
    .select(POST_COLUMNS)
    .eq("kind", kind)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (!options.includeUnpublished) {
    request = request.eq("published", true);
  }
  if (options.limit) {
    request = request.limit(options.limit);
  }

  const { data, error } = await request;
  if (error) {
    console.warn("[services/boards] listBoardPosts failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as PostRow[]).map((row) => mapPost(row, lang));
}

export async function getBoardPost(id: string, lang: string): Promise<BoardPost | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("board_posts")
    .select(POST_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/boards] getBoardPost failed:", error.message);
    return null;
  }
  return mapPost(data as unknown as PostRow, lang);
}

/**
 * 지금 시행 중인 약관 / 개인정보처리방침 한 건.
 *
 * 공개된 것 중 가장 최근 글을 쓴다 — 개정하면 새 글을 올리고 이전 글은 내려두는
 * 방식이라, 개정 이력이 board_posts에 그대로 남는다.
 */
export async function getLegalDocument(
  kind: LegalKind,
  lang: string,
): Promise<BoardPost | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("board_posts")
    .select(POST_COLUMNS)
    .eq("kind", kind)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/boards] getLegalDocument failed:", error.message);
    return null;
  }
  return mapPost(data as unknown as PostRow, lang);
}

/**
 * [2026-09-11 사용자 지시] 상세 화면 하단의 이전글 / 다음글 한 건씩.
 *
 * 목록은 "고정 먼저, 그다음 최신순"으로 뽑지만 여기서는 **작성일 하나로만** 앞뒤를
 * 정한다. 고정 글을 섞으면 다음글을 눌렀을 때 이전글이 방금 보던 글이 아닌 상황이
 * 생겨(고정 글이 사이에 끼어) 앞뒤로 오가는 흐름이 끊긴다.
 *
 * previous = 이 글보다 먼저 쓴 글(더 오래된 것), next = 나중에 쓴 글(더 새것).
 * 각각 한 건씩, 없으면 null.
 */
export async function getAdjacentPosts(
  kind: BoardKind,
  createdAt: string,
  lang: string,
): Promise<{ previous: BoardPost | null; next: BoardPost | null }> {
  if (!supabase) return { previous: null, next: null };

  const [olderResult, newerResult] = await Promise.all([
    supabase
      .from("board_posts")
      .select(POST_COLUMNS)
      .eq("kind", kind)
      .eq("published", true)
      .lt("created_at", createdAt)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("board_posts")
      .select(POST_COLUMNS)
      .eq("kind", kind)
      .eq("published", true)
      .gt("created_at", createdAt)
      .order("created_at", { ascending: true })
      .limit(1),
  ]);

  if (olderResult.error) {
    console.warn("[services/boards] getAdjacentPosts (previous) failed:", olderResult.error.message);
  }
  if (newerResult.error) {
    console.warn("[services/boards] getAdjacentPosts (next) failed:", newerResult.error.message);
  }

  const older = (olderResult.data ?? []) as unknown as PostRow[];
  const newer = (newerResult.data ?? []) as unknown as PostRow[];

  return {
    previous: older[0] ? mapPost(older[0], lang) : null,
    next: newer[0] ? mapPost(newer[0], lang) : null,
  };
}

// ============================================================================
// 번역
// ============================================================================

// [2026-09-12] translateOnce는 services/contentTranslation.ts로 옮겼다 — 매물·투자상품
// 설명도 같은 방식으로 번역하게 되면서 구현이 두 벌이 됐기 때문이다. 동작은 그대로다.

/**
 * 제목과 본문을 원문 언어 외 5개 언어로 번역한다.
 *
 * 실패한 언어는 결과 맵에 넣지 않는다 — 빈 문자열을 넣으면 화면이 원문 폴백 대신
 * 빈 칸을 보여 준다. 한 언어가 실패해도 나머지는 저장한다(전부 아니면 전무로 하면
 * 일시적인 API 오류에 글 등록 자체가 막힌다).
 *
 * 언어를 순차로 도는 이유: 동시에 열 개를 던지면 Google 쪽 rate limit에 걸린다.
 * 글 등록은 자주 일어나는 일이 아니므로 몇 초 더 걸려도 된다.
 */
export async function translateForAllLanguages(
  title: string,
  body: string,
  sourceLang: string,
): Promise<{ titleI18n: Record<string, string>; bodyI18n: Record<string, string> }> {
  const titleI18n: Record<string, string> = {};
  const bodyI18n: Record<string, string> = {};

  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang === sourceLang) continue;

    const translatedTitle = await translateOnce(title, sourceLang, lang);
    if (translatedTitle) titleI18n[lang] = translatedTitle;

    if (body.length > 0) {
      const translatedBody = await translateOnce(body, sourceLang, lang);
      if (translatedBody) bodyI18n[lang] = translatedBody;
    }
  }

  return { titleI18n, bodyI18n };
}

// ============================================================================
// 이미지
// ============================================================================

export async function uploadBoardImage(localUri: string): Promise<string | null> {
  if (!supabase) return null;

  try {
    const { bytes, contentType, fileExt } = await readImageBytes(localUri);
    const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

    const { error } = await supabase.storage
      .from(BOARD_IMAGES_BUCKET)
      .upload(path, bytes, { contentType });

    if (error) {
      console.warn("[services/boards] uploadBoardImage failed:", error.message);
      return null;
    }
    const { data } = supabase.storage.from(BOARD_IMAGES_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    console.warn("[services/boards] uploadBoardImage threw:", message);
    return null;
  }
}

// ============================================================================
// 쓰기
// ============================================================================

export type SaveBoardPostInput = {
  kind: BoardKind;
  title: string;
  body: string;
  sourceLang: string;
  /** 공지사항만 — 이미 업로드된 공개 URL 목록(최대 3장). */
  imageUrls?: string[];
  pinned?: boolean;
  published?: boolean;
};

/**
 * 공지사항 / FAQ 등록. 번역까지 함께 끝낸 뒤 저장한다.
 *
 * 번역을 먼저 하고 한 번에 insert하는 이유: 글을 먼저 넣고 번역을 나중에 update하면,
 * 번역이 실패했을 때 원문만 있는 글이 남아 다른 언어 사용자에게는 베트남어/한국어가
 * 그대로 보인다. 그런 상태를 만들 바에는 저장 자체가 몇 초 걸리는 편이 낫다.
 */
export async function createBoardPost(
  input: SaveBoardPostInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!supabase) return { ok: false, reason: "no-client" };

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return { ok: false, reason: "not-signed-in" };

  // QA는 번역하지 않는다(사용자 결정).
  const translated =
    input.kind === "qa"
      ? { titleI18n: {}, bodyI18n: {} }
      : await translateForAllLanguages(input.title, input.body, input.sourceLang);

  const { data, error } = await supabase
    .from("board_posts")
    .insert({
      kind: input.kind,
      title: input.title,
      body: input.body,
      source_lang: input.sourceLang,
      title_i18n: input.kind === "qa" ? null : translated.titleI18n,
      body_i18n: input.kind === "qa" ? null : translated.bodyI18n,
      author_id: userId,
      pinned: input.pinned ?? false,
      published: input.published ?? true,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.warn("[services/boards] createBoardPost failed:", error?.message);
    return { ok: false, reason: error?.message ?? "insert-failed" };
  }

  const urls = input.imageUrls ?? [];
  if (urls.length > 0) {
    const { error: imageError } = await supabase.from("board_post_images").insert(
      urls.slice(0, 3).map((url, index) => ({
        post_id: data.id,
        url,
        sort_order: index,
      })),
    );
    if (imageError) {
      console.warn("[services/boards] board_post_images insert failed:", imageError.message);
    }
  }

  return { ok: true, id: data.id };
}

/**
 * 공지사항 / FAQ 수정.
 *
 * 제목이나 본문이 바뀌면 번역을 다시 만든다 — 안 그러면 원문만 바뀌고 다른 언어는
 * 예전 내용이 남는다. 고정/게시 여부만 바꿀 때는 번역을 건드리지 않는다(불필요한
 * 과금).
 */
export async function updateBoardPost(
  id: string,
  input: SaveBoardPostInput,
  textChanged: boolean,
): Promise<boolean> {
  if (!supabase) return false;

  const patch: Record<string, unknown> = {
    title: input.title,
    body: input.body,
    source_lang: input.sourceLang,
    pinned: input.pinned ?? false,
    published: input.published ?? true,
    updated_at: new Date().toISOString(),
  };

  if (textChanged && input.kind !== "qa") {
    const translated = await translateForAllLanguages(input.title, input.body, input.sourceLang);
    patch.title_i18n = translated.titleI18n;
    patch.body_i18n = translated.bodyI18n;
  }

  const { error } = await supabase.from("board_posts").update(patch).eq("id", id);
  if (error) {
    console.warn("[services/boards] updateBoardPost failed:", error.message);
    return false;
  }

  // 이미지는 통째로 다시 붙인다 — 순서까지 화면과 맞추려면 부분 갱신이 더 복잡하다.
  if (input.imageUrls) {
    await supabase.from("board_post_images").delete().eq("post_id", id);
    if (input.imageUrls.length > 0) {
      await supabase.from("board_post_images").insert(
        input.imageUrls.slice(0, 3).map((url, index) => ({
          post_id: id,
          url,
          sort_order: index,
        })),
      );
    }
  }
  return true;
}

export async function deleteBoardPost(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("board_posts").delete().eq("id", id);
  if (error) {
    console.warn("[services/boards] deleteBoardPost failed:", error.message);
    return false;
  }
  return true;
}

/** QA 답변 — 관리자만. 답변자와 시각을 서버가 박는다. */
export async function answerQuestion(postId: string, answer: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("admin_answer_question", {
    target_post: postId,
    answer,
  });
  if (error) {
    console.warn("[services/boards] answerQuestion failed:", error.message);
    return false;
  }
  return true;
}
