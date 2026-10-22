import { supabase } from "./supabase";
import { localizedText } from "@/utils/format";

/**
 * [2026-10-22] 자동 수집된 부동산 정보 — 홈 리스트와 내부 상세가 쓴다.
 *
 * 번역은 **수집 시점에 이미 끝나 있다**(research-news가 6개 언어를 저장한다).
 * 그래서 이 서비스는 번역을 요청하지 않는다 — 목록 10건마다 번역 API를 부르면
 * 첫 로드가 20번 왕복이 된다. 여기서는 저장된 값 중 보는 사람 언어를 고를 뿐이다.
 *
 * 권한에 따라 화면 동작이 갈린다(요구사항 §7):
 *   · internal_allowed → 앱 내부 상세페이지
 *   · link_only        → 원문을 외부 브라우저로
 * 그 판정은 화면이 `contentPermission`을 보고 한다. 이 서비스는 값을 전달만 한다.
 */

export type ArticleContentPermission =
  | "internal_allowed"
  | "link_only"
  | "pending_review"
  | "revoked";

export type Article = {
  id: string;
  /** 보는 사람 언어로 고른 제목. 그 언어가 없으면 원문으로 폴백한다. */
  title: string;
  summary: string;
  /** 출처 기관명·매체명. 카드에 노출된다. */
  sourceName: string;
  sourceDomain: string;
  originalUrl: string;
  /** 원문 게시일(ISO). 없으면 null — 추정하지 않는다. */
  publishedAt: string | null;
  collectedAt: string;
  lastCheckedAt: string | null;
  region: string | null;
  propertyType: string | null;
  /** 원문에 명시된 기간. 셋 다 비면 화면에서 기간 칸을 숨긴다. */
  periodStart: string | null;
  periodEnd: string | null;
  periodLabel: string | null;
  thumbnailUrl: string | null;
  imageCount: number;
  contentPermission: ArticleContentPermission;
  trustScore: number;
};

/** 내부 상세에서만 쓰는 추가 정보 — 사진 여러 장. */
export type ArticleDetail = Article & {
  images: { url: string; caption: string | null }[];
};

const LIST_COLUMNS = `
  id, title, summary, title_i18n, summary_i18n, source_lang,
  original_url, source_published_at, collected_at, last_checked_at,
  region, property_type, period_start, period_end, period_label,
  thumbnail_url, image_count, content_permission,
  article_sources ( name, domain, trust_score )
`;

type Row = {
  id: string;
  title: string;
  summary: string | null;
  title_i18n: Record<string, string> | null;
  summary_i18n: Record<string, string> | null;
  source_lang: string;
  original_url: string;
  source_published_at: string | null;
  collected_at: string;
  last_checked_at: string | null;
  region: string | null;
  property_type: string | null;
  period_start: string | null;
  period_end: string | null;
  period_label: string | null;
  thumbnail_url: string | null;
  image_count: number;
  content_permission: ArticleContentPermission;
  article_sources: { name: string; domain: string; trust_score: number } | null;
};

/**
 * 저장된 원문과 번역맵에서 보는 사람 언어를 고른다.
 *
 * 원문을 원문 언어 자리에 넣어 두는 이유: 베트남어 사용자는 번역이 아니라 원문을
 * 읽어야 한다. 번역맵에는 원문 언어가 들어 있지 않다(같은 언어는 번역하지 않는다).
 */
function pick(
  original: string,
  i18n: Record<string, string> | null,
  sourceLang: string,
  lang: string,
): string {
  const map: Record<string, string> = { ...(i18n ?? {}) };
  map[sourceLang] = original;
  return localizedText(map, lang);
}

function mapRow(row: Row, lang: string): Article {
  return {
    id: row.id,
    title: pick(row.title, row.title_i18n, row.source_lang, lang),
    summary: pick(row.summary ?? "", row.summary_i18n, row.source_lang, lang),
    sourceName: row.article_sources?.name ?? "",
    sourceDomain: row.article_sources?.domain ?? "",
    originalUrl: row.original_url,
    publishedAt: row.source_published_at,
    collectedAt: row.collected_at,
    lastCheckedAt: row.last_checked_at,
    region: row.region,
    propertyType: row.property_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodLabel: row.period_label,
    thumbnailUrl: row.thumbnail_url,
    imageCount: row.image_count ?? 0,
    contentPermission: row.content_permission,
    trustScore: Number(row.article_sources?.trust_score ?? 0),
  };
}

export const ARTICLES_PAGE_SIZE = 10;

export type ArticlePage = {
  items: Article[];
  /** 다음 페이지가 있는가. 한 건 더 받아 보고 판단한다(count 쿼리를 따로 돌리지 않는다). */
  hasMore: boolean;
};

/**
 * 게시된 기사 목록 — 최신순, 페이지 단위.
 *
 * RLS가 status='published'만 돌려주므로 여기서 상태를 다시 걸지 않는다. 비로그인
 * 사용자도 읽는다(매물 상세와 같은 정책).
 *
 * `revoked`는 **클라이언트에서 한 번 더 제외한다.** 권한이 철회된 글은 게시 상태가
 * 남아 있어도 노출하지 않는 것이 맞고, 수집기가 상태를 내리기 전까지의 틈을 막는다.
 */
export async function listArticles(page = 0, lang = "vi"): Promise<ArticlePage> {
  if (!supabase) return { items: [], hasMore: false };

  const from = page * ARTICLES_PAGE_SIZE;
  // 한 건 더 받아 "다음 페이지가 있는지"를 판단한다.
  const to = from + ARTICLES_PAGE_SIZE;

  const { data, error } = await supabase
    .from("articles")
    .select(LIST_COLUMNS)
    .neq("content_permission", "revoked")
    // 게시일이 없는 기사는 애초에 게시되지 않지만, 정렬 기준이 null이면 맨 뒤로.
    .order("source_published_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (error) {
    console.warn("[services/articles] 목록 조회 실패:", error.message);
    return { items: [], hasMore: false };
  }

  const rows = (data ?? []) as unknown as Row[];
  const hasMore = rows.length > ARTICLES_PAGE_SIZE;
  return {
    items: rows.slice(0, ARTICLES_PAGE_SIZE).map((row) => mapRow(row, lang)),
    hasMore,
  };
}

/**
 * 기사 한 건 + 사진.
 *
 * 내부 상세페이지에서만 부른다. 권한이 internal_allowed가 아니면 null을 돌려준다 —
 * 화면이 실수로 link_only 콘텐츠를 앱 안에 펼치지 않게 **서비스에서 막는다**.
 * (화면 분기를 믿고 여기를 열어 두면, 딥링크로 직접 들어오는 경로가 남는다.)
 */
export async function getArticleDetail(id: string, lang = "vi"): Promise<ArticleDetail | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("articles")
    .select(LIST_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[services/articles] 상세 조회 실패:", error.message);
    return null;
  }

  const row = data as unknown as Row;
  if (row.content_permission !== "internal_allowed") return null;

  const article = mapRow(row, lang);

  const { data: imageRows } = await supabase
    .from("article_images")
    .select("url, caption")
    .eq("article_id", id)
    .order("sort_order", { ascending: true });

  return {
    ...article,
    images: ((imageRows ?? []) as { url: string; caption: string | null }[]).map((i) => ({
      url: i.url,
      caption: i.caption,
    })),
  };
}
