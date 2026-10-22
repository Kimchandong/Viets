// Supabase Edge Function: research-news
//
// [2026-10-20] 부동산 정보 자동 수집 — STEP 04.
//
// status='verified' + access_method='rss'인 정보원의 피드를 읽어 신규 기사를
// articles에 넣는다. 품질 게이트를 통과한 것만 published로, 못 넘은 것은
// rejected + reject_reason으로 남긴다(사용자 결정: 관리자 검토 없이 자동 게시이므로
// 사람이 보는 대기 큐가 없다).
//
// 이 함수가 **하지 않는 것**:
//   · 본문 전문 수집 — 피드가 주는 요약까지만 쓴다. 원문 페이지를 긁지 않는다.
//   · 이미지 다운로드 — URL만 저장한다. link_only 출처의 사진은 저장하지 않는다.
//   · AI 요약·분류 — 별도 함수(STEP 05). 부동산 섹션 피드에서 온 것은 관련성이
//     이미 보장되므로, AI 없이도 게시가 성립한다.
//
// 번역은 **여기서 한다**(2026-10-22 사용자 지시 "언어별 자동번역이 되어 노출").
// 볼 때 번역하지 않는 이유: 홈은 목록이라 10건 × (제목+요약) = 20번 호출이 첫
// 로드에 걸린다. 수집은 하루 1회 10건뿐이라 그때 6개 언어를 만들어 두면 목록
// 조회가 DB 읽기 한 번으로 끝난다.
//
// 게시 확정된 기사만 번역한다 — 탈락분을 번역하면 화면에 안 나오는 글에 돈을 쓴다.
//   · 원문에 없는 값 채우기 — 가격·기간·지역을 추정하지 않는다. 없으면 NULL이다.
//
// 인증: 관리자만. 스케줄러는 STEP 07에서 별도 비밀값으로 붙인다 —
// 지금 cron 경로를 열어 두면 아무나 수집을 돌릴 수 있다.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { extractRegion } from "../_shared/vietnamRegions.ts";
import { translateArticleFields } from "../_shared/translateText.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * 피드 한 건을 읽는 데 쓰는 시간 상한. 죽은 서버 하나가 실행 전체를 잡지 않게 둔다.
 *
 * [2026-10-22 실측] 15초로 두었더니 Thanh Niên이 매번 중단됐다("The signal has been
 * aborted"). 피드 자체는 정상이고(STEP 01에서 확인) 엣지 리전에서 베트남 서버까지
 * 왕복이 느린 것이다. 30초로 올린다.
 *
 * 한 번 더 시도하지 않는 이유: 출처가 늘면 재시도가 실행 전체 시간을 배로 늘린다.
 * 느린 출처는 connective_failures로 드러나고, 매일 돌므로 한 번 놓쳐도 다음 날
 * 같은 기사를 다시 본다(url_hash로 중복이 걸러진다).
 */
const FETCH_TIMEOUT_MS = 30_000;
/** 한 출처에서 한 번에 살펴볼 항목 수 상한. 피드가 50~100건을 주므로 충분하다. */
const MAX_ITEMS_PER_SOURCE = 60;

// ─────────────────────────────────────────────────────────────────────────────
// RSS 파싱
//
// XML 파서를 import하지 않고 정규식으로 읽는다. RSS 2.0의 item 구조는 단순하고,
// 우리가 쓰는 태그는 6개뿐이다. 다만 CDATA와 HTML 엔티티는 실제로 들어오므로
// 그 둘은 반드시 처리한다 — 안 하면 제목에 `<![CDATA[`가 그대로 박힌다.
// ─────────────────────────────────────────────────────────────────────────────

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // &amp;는 **마지막에** 푼다. 먼저 풀면 "&amp;lt;"가 "<"로 두 번 변환된다.
    .replace(/&amp;/g, "&");
}

/** CDATA를 벗기고 엔티티를 풀고 공백을 정리한다. */
function cleanText(raw: string | null): string {
  if (!raw) return "";
  let value = raw.trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1];
  value = decodeEntities(value);
  // 요약에 HTML이 섞여 오는 피드가 있다(CafeF는 description 안에 <img>와 <a>를 넣는다).
  value = value.replace(/<[^>]*>/g, " ");
  return value.replace(/\s+/g, " ").trim();
}

function tagValue(xml: string, tag: string): string | null {
  // 속성이 붙은 태그도 잡는다(<description type="html">).
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function attrValue(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*>`, "i");
  const m = xml.match(re);
  return m ? decodeEntities(m[1]) : null;
}

type FeedItem = {
  title: string;
  summary: string;
  link: string;
  pubDate: string | null;
  imageUrl: string | null;
};

function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  // RSS 2.0은 <item>, Atom은 <entry>. 둘 다 받는다.
  const blocks = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];

  for (const block of blocks.slice(0, MAX_ITEMS_PER_SOURCE)) {
    const title = cleanText(tagValue(block, "title"));
    // Atom은 link를 속성으로 준다.
    const link = cleanText(tagValue(block, "link")) || attrValue(block, "link", "href") || "";
    if (title.length === 0 || link.length === 0) continue;

    const descriptionRaw = tagValue(block, "description") ?? tagValue(block, "summary") ?? tagValue(block, "content");
    const summary = cleanText(descriptionRaw);

    // 게시일 — 피드마다 태그가 다르다. 없으면 null로 두고 게이트에서 탈락시킨다.
    const pubDate = cleanText(
      tagValue(block, "pubDate") ?? tagValue(block, "published") ?? tagValue(block, "updated") ?? tagValue(block, "dc:date"),
    ) || null;

    // 이미지는 네 경로로 온다. STEP 01에서 출처마다 다른 것을 확인했다
    // (VnExpress는 enclosure, CafeF는 본문 img, VnEconomy는 media:*).
    // **첫 장만** 쓴다 — 본문 img를 다 긁으면 광고·로고까지 들어온다.
    const imageUrl =
      attrValue(block, "enclosure", "url") ??
      attrValue(block, "media:content", "url") ??
      attrValue(block, "media:thumbnail", "url") ??
      (descriptionRaw ? firstImgSrc(decodeEntities(descriptionRaw)) : null);

    items.push({ title, summary, link, pubDate, imageUrl });
  }
  return items;
}

function firstImgSrc(html: string): string | null {
  const m = html.match(/<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// URL 정규화 · 해시
// ─────────────────────────────────────────────────────────────────────────────

/** 추적 파라미터. 이것만 붙은 같은 주소를 서로 다른 기사로 세지 않게 한다. */
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "zarsrc", "ref", "source",
];

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    // http/https만. javascript:·data: 같은 것이 피드에 섞여 들어올 수 있다.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
    // 쿼리 순서가 달라도 같은 주소로 보도록 정렬한다.
    url.searchParams.sort();
    let out = url.toString();
    // 끝 슬래시만 다른 주소를 같게 본다(경로가 "/"뿐인 경우는 남긴다).
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 제목+요약의 해시. URL이 달라도 같은 기사인 경우를 잡는다 — 여러 매체가 같은
 * 보도자료를 받아쓰면 제목이 거의 같다.
 *
 * 공백·구두점을 지우고 소문자로 내린다. 매체마다 제목 끝에 붙이는 기호
 * ("…", "!", 매체명)가 달라 그대로 비교하면 거의 걸리지 않는다.
 */
function contentKey(title: string, summary: string): string {
  const base = `${title} ${summary}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return base.slice(0, 500);
}

/**
 * 게시일 파싱.
 *
 * RFC822(`Tue, 20 Oct 2026 08:00:00 +0700`)와 ISO를 Date가 그대로 읽는다.
 * [STEP 01 메모] Tuổi Trẻ는 `MM/DD/YYYY h:mm:ss AM/PM`을 쓴다 — 지금 등록된
 * 출처에는 없지만 추가되면 여기서 분기해야 한다. Date가 그 형식을 미국식으로
 * 읽어 **조용히 잘못된 날짜**가 들어갈 수 있으므로, 결과가 미래이거나
 * 20년 전이면 버린다.
 */
function parsePubDate(raw: string | null): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  const now = Date.now();
  // 하루 이상 미래이거나 20년 이상 과거면 파싱이 틀린 것으로 본다.
  if (ms > now + 86_400_000) return null;
  if (ms < now - 20 * 365 * 86_400_000) return null;
  return new Date(ms).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// 수집
// ─────────────────────────────────────────────────────────────────────────────

type Source = {
  id: string;
  name: string;
  domain: string;
  feed_url: string | null;
  content_permission: string;
  trust_score: number;
  language: string;
  daily_limit: number;
};

type Settings = {
  daily_limit: number;
  per_source_limit: number;
  max_age_days: number;
  min_trust_score: number;
};

type SourceStat = {
  source: string;
  fetched: number;
  parsed: number;
  duplicate: number;
  published: number;
  rejected: number;
  /** 번역 — api_call은 과금 대상, cache_hit은 무과금. */
  translated: number;
  translate_cached: number;
  translate_failed: number;
  error: string | null;
};

async function fetchFeed(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 신원을 밝힌다. 차단당하면 차단당한 채로 기록하고, 숨기지 않는다.
        "User-Agent": "RealtyReitBot/1.0 (+https://github.com/Kimchandong/Viets)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function collectSource(
  admin: SupabaseClient,
  googleApiKey: string | undefined,
  source: Source,
  settings: Settings,
  remainingTotal: number,
): Promise<SourceStat> {
  const stat: SourceStat = {
    source: source.name,
    fetched: 0,
    parsed: 0,
    duplicate: 0,
    published: 0,
    rejected: 0,
    translated: 0,
    translate_cached: 0,
    translate_failed: 0,
    error: null,
  };

  if (!source.feed_url) {
    stat.error = "feed_url 없음";
    return stat;
  }

  let items: FeedItem[] = [];
  try {
    const xml = await fetchFeed(source.feed_url);
    stat.fetched = 1;
    items = parseFeed(xml);
    stat.parsed = items.length;
  } catch (err) {
    stat.error = err instanceof Error ? err.message : "unknown-error";

    // 연속 실패를 누적한다 — 관리자 화면이 이 값으로 죽은 출처를 가려낸다.
    // PostgREST로는 `consecutive_failures = consecutive_failures + 1`을 한 번에
    // 쓸 수 없어(컬럼 자기 참조를 표현할 수 없다) 읽고 더해서 쓴다. 같은 출처를
    // 동시에 두 번 수집하는 일은 없으므로 경합을 걱정하지 않는다.
    const { data: current } = await admin
      .from("article_sources")
      .select("consecutive_failures")
      .eq("id", source.id)
      .maybeSingle();

    await admin
      .from("article_sources")
      .update({
        last_fetched_at: new Date().toISOString(),
        last_error: stat.error,
        consecutive_failures: ((current?.consecutive_failures as number) ?? 0) + 1,
      })
      .eq("id", source.id);

    return stat;
  }

  // 이 출처의 상한: 출처별 값과 전체 설정 중 작은 쪽. 그리고 남은 전체 칸.
  const cap = Math.min(source.daily_limit, settings.per_source_limit, remainingTotal);

  const maxAgeMs = settings.max_age_days * 86_400_000;
  const now = Date.now();
  // 이번 실행 안에서의 중복도 막는다 — 같은 피드에 같은 기사가 두 번 들어올 수 있다.
  const seenInRun = new Set<string>();

  for (const item of items) {
    if (stat.published >= cap) break;

    const normalized = normalizeUrl(item.link);
    if (!normalized) {
      stat.rejected += 1;
      continue;
    }
    const urlHash = await sha256(normalized);
    if (seenInRun.has(urlHash)) {
      stat.duplicate += 1;
      continue;
    }
    seenInRun.add(urlHash);

    // 이미 있는 기사인가. 있으면 "원문을 다시 확인했다"만 기록한다.
    const { data: existing } = await admin
      .from("articles")
      .select("id")
      .eq("url_hash", urlHash)
      .maybeSingle();

    if (existing) {
      stat.duplicate += 1;
      await admin
        .from("articles")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", existing.id);
      continue;
    }

    const publishedAt = parsePubDate(item.pubDate);
    const contentHash = await sha256(contentKey(item.title, item.summary));

    // ── 품질 게이트 ──
    // 사람이 검토하지 않으므로 여기서 걸러진 것이 그대로 묻힌다. 왜 묻혔는지는
    // reject_reason에 남긴다 — 없으면 "수집은 됐는데 안 보인다"를 조사할 수 없다.
    const reasons: string[] = [];
    if (!publishedAt) reasons.push("게시일 없음 또는 파싱 실패");
    else if (now - Date.parse(publishedAt) > maxAgeMs) {
      reasons.push(`게시일이 ${settings.max_age_days}일보다 오래됨`);
    }
    if (source.trust_score < settings.min_trust_score) reasons.push("출처 신뢰도 미달");

    const region = extractRegion(item.title, item.summary);
    if (!region) reasons.push("지역을 찾지 못함");

    // 제목이 같은 기사가 이미 있으면(다른 매체의 같은 보도자료) 게시하지 않는다.
    if (reasons.length === 0) {
      const { data: sameContent } = await admin
        .from("articles")
        .select("id")
        .eq("content_hash", contentHash)
        .limit(1);
      if (sameContent && sameContent.length > 0) {
        stat.duplicate += 1;
        continue;
      }
    }

    const willPublish = reasons.length === 0;

    // ── 번역 ──
    // 게시 확정분만. 탈락한 글은 화면에 안 나오므로 번역하면 돈만 나간다.
    //
    // 한 언어가 실패해도 나머지는 저장한다. 비어 있는 언어는 화면이 원문으로
    // 폴백하므로(localizedText) 빈 칸이 보이지 않는다.
    let titleI18n: Record<string, string> | null = null;
    let summaryI18n: Record<string, string> | null = null;

    if (willPublish) {
      const translated = await translateArticleFields(
        admin,
        googleApiKey,
        item.title,
        item.summary,
        source.language,
      );
      titleI18n = Object.keys(translated.titleI18n).length > 0 ? translated.titleI18n : null;
      summaryI18n = Object.keys(translated.summaryI18n).length > 0 ? translated.summaryI18n : null;
      stat.translated += translated.apiCalls;
      stat.translate_cached += translated.cacheHits;
      stat.translate_failed += translated.failures;
    }

    // link_only 출처의 사진은 저장하지 않는다 — 썸네일 1장만 쓴다.
    // (피드가 공유용으로 내놓은 이미지라 카드 썸네일로는 쓰되, article_images에
    //  여러 장을 쌓는 것은 권한이 있는 출처에서만 한다.)
    const { error: insertError } = await admin.from("articles").insert({
      source_id: source.id,
      title: item.title,
      summary: item.summary.length > 0 ? item.summary.slice(0, 1000) : null,
      source_lang: source.language,
      title_i18n: titleI18n,
      summary_i18n: summaryI18n,
      original_url: normalized,
      url_hash: urlHash,
      content_hash: contentHash,
      source_published_at: publishedAt,
      last_checked_at: new Date().toISOString(),
      region,
      transaction_type: "news",
      content_permission: source.content_permission,
      status: willPublish ? "published" : "rejected",
      reject_reason: willPublish ? null : reasons.join(" / "),
      published_at: willPublish ? new Date().toISOString() : null,
      thumbnail_url: item.imageUrl,
      image_count: 0,
    });

    if (insertError) {
      // url_hash unique 충돌은 동시 실행에서 정상적으로 생길 수 있다.
      if (insertError.code === "23505") {
        stat.duplicate += 1;
      } else {
        stat.rejected += 1;
        console.warn(`[research-news] insert 실패 (${source.name}):`, insertError.message);
      }
      continue;
    }

    if (willPublish) stat.published += 1;
    else stat.rejected += 1;
  }

  // 피드가 조용히 죽는 것을 잡으려면 **마지막 항목의 시각**이 필요하다.
  // 조회 성공(last_fetched_at)만으로는 "열리지만 비어 있는" 피드를 구분할 수 없다.
  const newestItem = items
    .map((i) => parsePubDate(i.pubDate))
    .filter((d): d is string => d !== null)
    .sort()
    .pop() ?? null;

  await admin
    .from("article_sources")
    .update({
      last_fetched_at: new Date().toISOString(),
      last_item_at: newestItem,
      last_error: null,
      consecutive_failures: 0,
    })
    .eq("id", source.id);

  return stat;
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  // 번역용. 없으면 번역만 건너뛰고 수집은 계속한다 — 번역이 안 되면 원문이
  // 보이지만, 수집 자체가 멈추면 아무것도 안 보인다.
  const googleApiKey = Deno.env.get("GOOGLE_TRANSLATE_API_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server misconfigured" }, 500);

  // 두 가지 방법으로만 호출된다.
  //
  //  1) 관리자 계정 — 판정은 DB가 한다(is_admin_or_above). 관리자 화면의 "지금
  //     수집" 버튼이 이 경로를 쓴다.
  //  2) 비밀값(RESEARCH_CRON_SECRET) — 스케줄러가 쓸 경로다(STEP 07). 스케줄러에는
  //     로그인한 사용자가 없어 1)을 쓸 수 없다. 지금은 수동 실행에도 이 경로를
  //     쓴다 — CLI의 functions invoke는 anon key를 보내므로 1)로는 통과하지 못한다.
  //
  // 비밀값이 설정되지 않은 환경에서는 2)를 **닫는다.** 빈 값과 빈 헤더가 같다고
  // 보면 누구나 수집을 돌릴 수 있다.
  const cronSecret = Deno.env.get("RESEARCH_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  // [2026-10-22] 이 함수는 게이트웨이 JWT 검사 없이(--no-verify-jwt) 배포한다.
  // 그래서 **아무나 요청을 보낼 수는 있다.** 자격 증명이 하나도 없는 요청은
  // DB를 건드리기 전에 끝낸다 — 그러지 않으면 빈 요청마다 is_admin_or_above
  // 조회가 한 번씩 돌아 DB가 스팸의 과녁이 된다.
  if (providedSecret.length === 0 && authHeader.length === 0) {
    return json({ error: "forbidden" }, 403);
  }

  // 1) 스케줄러 경로 — 비밀값. 비밀값이 설정되지 않은 환경에서는 이 경로를 닫는다
  //    (빈 값과 빈 헤더가 같다고 보면 누구나 수집을 돌릴 수 있다).
  let allowed = cronSecret.length > 0 && providedSecret === cronSecret;

  // 2) 관리자 경로 — 판정은 DB가 한다. 여기서 역할을 다시 해석하지 않는다.
  if (!allowed && authHeader.length > 0) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isAdmin } = await userClient.rpc("is_admin_or_above");
    allowed = isAdmin === true;
  }

  if (!allowed) return json({ error: "forbidden" }, 403);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // ── 백필 모드 ──
  // 번역 기능이 붙기 전에 수집된 기사는 title_i18n이 비어 있다. 다시 수집하면
  // url_hash 중복으로 걸러지므로 채울 방법이 없다 — 그래서 전용 모드를 둔다.
  //
  // 한 번에 처리할 건수를 받는다(기본 20). 기사 한 건에 번역 호출이 10회라,
  // 수백 건을 한 번에 돌리면 실행 시간 상한에 걸린다. 남으면 다시 호출한다.
  let body: { backfill?: boolean; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.backfill === true) {
    const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);

    const { data: pending } = await admin
      .from("articles")
      .select("id,title,summary,source_lang")
      .eq("status", "published")
      .is("title_i18n", null)
      .order("published_at", { ascending: false })
      .limit(limit);

    const rows = (pending ?? []) as {
      id: string;
      title: string;
      summary: string | null;
      source_lang: string;
    }[];

    let filled = 0;
    let apiCalls = 0;
    let cacheHits = 0;
    let failures = 0;

    for (const row of rows) {
      const translated = await translateArticleFields(
        admin,
        googleApiKey,
        row.title,
        row.summary,
        row.source_lang,
      );
      apiCalls += translated.apiCalls;
      cacheHits += translated.cacheHits;
      failures += translated.failures;

      if (Object.keys(translated.titleI18n).length === 0) continue;

      const { error } = await admin
        .from("articles")
        .update({
          title_i18n: translated.titleI18n,
          summary_i18n:
            Object.keys(translated.summaryI18n).length > 0 ? translated.summaryI18n : null,
        })
        .eq("id", row.id);

      if (!error) filled += 1;
    }

    // 남은 건수를 함께 돌려준다 — 부르는 쪽이 더 돌릴지 판단할 수 있게.
    const { count: stillPending } = await admin
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .is("title_i18n", null);

    return json({
      ok: true,
      mode: "backfill",
      candidates: rows.length,
      filled,
      still_pending: stillPending ?? 0,
      translate_api_calls: apiCalls,
      translate_cache_hits: cacheHits,
      translate_failures: failures,
      translate_configured: !!googleApiKey,
    });
  }

  // 실행 기록을 먼저 만든다 — 중간에 터져도 시도한 사실이 남아야 한다.
  const { data: job } = await admin
    .from("research_jobs")
    .insert({ job_type: "collect", status: "running", started_at: new Date().toISOString() })
    .select("id")
    .maybeSingle();
  const jobId = job?.id as string | undefined;

  try {
    const { data: settingsRow } = await admin
      .from("article_publish_settings")
      .select("daily_limit,per_source_limit,max_age_days,min_trust_score")
      .eq("id", true)
      .maybeSingle();

    const settings: Settings = {
      daily_limit: settingsRow?.daily_limit ?? 10,
      per_source_limit: settingsRow?.per_source_limit ?? 5,
      max_age_days: settingsRow?.max_age_days ?? 7,
      min_trust_score: Number(settingsRow?.min_trust_score ?? 0.5),
    };

    // 오늘 이미 게시한 건수를 빼서 일일 상한을 지킨다 — 같은 날 두 번 실행해도
    // 상한을 넘기지 않는다(멱등성 요구사항).
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count: publishedToday } = await admin
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .gte("published_at", todayStart.toISOString());

    let remaining = Math.max(0, settings.daily_limit - (publishedToday ?? 0));

    const { data: sourceRows } = await admin
      .from("article_sources")
      .select("id,name,domain,feed_url,content_permission,trust_score,language,daily_limit")
      .eq("status", "verified")
      .eq("access_method", "rss")
      // 신뢰도 높은 출처가 먼저 칸을 차지한다.
      .order("trust_score", { ascending: false });

    const sources = (sourceRows ?? []) as Source[];
    const stats: SourceStat[] = [];

    for (const source of sources) {
      if (remaining <= 0) break;
      const stat = await collectSource(admin, googleApiKey, source, settings, remaining);
      stats.push(stat);
      remaining -= stat.published;
    }

    const summary = {
      sources: sources.length,
      published: stats.reduce((n, s) => n + s.published, 0),
      duplicate: stats.reduce((n, s) => n + s.duplicate, 0),
      rejected: stats.reduce((n, s) => n + s.rejected, 0),
      translate_api_calls: stats.reduce((n, s) => n + s.translated, 0),
      translate_cache_hits: stats.reduce((n, s) => n + s.translate_cached, 0),
      translate_failures: stats.reduce((n, s) => n + s.translate_failed, 0),
      translate_configured: !!googleApiKey,
      published_today_before: publishedToday ?? 0,
      daily_limit: settings.daily_limit,
      per_source: stats,
    };

    if (jobId) {
      await admin
        .from("research_jobs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          stats: summary,
        })
        .eq("id", jobId);
    }

    return json({ ok: true, job_id: jobId ?? null, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown-error";
    if (jobId) {
      await admin
        .from("research_jobs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error: message })
        .eq("id", jobId);
    }
    console.warn("[research-news] 실행 실패:", message);
    return json({ error: message }, 500);
  }
});
