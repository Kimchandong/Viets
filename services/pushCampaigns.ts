import { hasSession, supabase } from "./supabase";

/**
 * [2026-09-27 사용자 지시] 관리자가 전체/관심/투자자 계정에 보내는 푸시 메시지.
 *
 * 화면(app/admin-push.tsx)이 쓰는 얇은 층이다. 대상 계산과 알림함 적재는 전부 DB
 * 함수가 한다(supabase/migrations/20260928000000_push_campaigns.sql) — 앱이 사용자
 * 목록을 직접 읽게 되면 그 자체가 열면 안 되는 문이 된다.
 */

/** 발송 대상 — DB의 push_campaigns.audience와 같은 값이어야 한다. */
export type PushAudience = "all" | "interest" | "investors";

/** 관심 계정을 고를 때의 종류. audience === "interest"에서만 쓴다. */
export type PushTopic = "property" | "invest";

export type PushCampaignInput = {
  title: string;
  body: string;
  topic: PushTopic;
  audience: PushAudience;
  audienceTopics: PushTopic[];
  youtubeUrl: string | null;
  linkUrl: string | null;
  imageUrls: string[];
};

export type PushCampaign = {
  id: string;
  title: string;
  body: string;
  topic: PushTopic;
  youtubeUrl: string | null;
  linkUrl: string | null;
  imageUrls: string[];
  sentCount: number;
  createdAt: string;
};

type Row = {
  id: string;
  title: string;
  body: string;
  topic: string;
  youtube_url: string | null;
  link_url: string | null;
  image_urls: string[] | null;
  sent_count: number;
  created_at: string;
};

function toCampaign(row: Row): PushCampaign {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    topic: row.topic === "invest" ? "invest" : "property",
    youtubeUrl: row.youtube_url,
    linkUrl: row.link_url,
    imageUrls: row.image_urls ?? [],
    sentCount: row.sent_count,
    createdAt: row.created_at,
  };
}

/**
 * 지금 조건으로 보낼 수 있는 사람 수.
 *
 * 화면에 "발송가능인원"으로 띄운다. 보내는 쪽과 **같은 DB 함수**를 거치므로
 * 여기 숫자와 실제 발송 수가 어긋나지 않는다.
 */
export async function getPushAudienceCount(
  audience: PushAudience,
  topics: PushTopic[],
): Promise<number> {
  if (!supabase) return 0;
  if (!(await hasSession())) return 0;

  const { data, error } = await supabase.rpc("push_audience_count", {
    p_audience: audience,
    p_topics: topics,
  });
  if (error) {
    console.warn("[services/pushCampaigns] push_audience_count failed:", error.message);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

/** 본문 한 건. 알림을 눌러 들어온 화면이 읽는다. */
export async function getPushCampaign(id: string): Promise<PushCampaign | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("push_campaigns")
    .select("id,title,body,topic,youtube_url,link_url,image_urls,sent_count,created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("[services/pushCampaigns] getPushCampaign failed:", error.message);
    return null;
  }
  return data ? toCampaign(data as Row) : null;
}

/**
 * 본문을 저장하고 대상 계정의 알림함에 넣는다. 넣은 수를 돌려준다.
 *
 * 푸시 발송(엣지 함수 호출)은 **여기서 하지 않는다** — 화면이 이어서 부른다.
 * 알림함 적재와 발송을 한 함수에 묶으면, 발송이 실패했을 때 알림함까지 되돌릴지
 * 판단이 애매해진다. 알림함은 남고 푸시만 실패하는 편이 낫다(앱을 열면 보인다).
 */
export async function createPushCampaign(
  input: PushCampaignInput,
): Promise<{ id: string; sentCount: number } | null> {
  if (!supabase) return null;

  const { data: created, error: insertError } = await supabase
    .from("push_campaigns")
    .insert({
      title: input.title,
      body: input.body,
      topic: input.topic,
      audience: input.audience,
      audience_topics: input.audience === "interest" ? input.audienceTopics : [],
      youtube_url: input.youtubeUrl,
      link_url: input.linkUrl,
      image_urls: input.imageUrls,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.warn("[services/pushCampaigns] insert failed:", insertError?.message);
    return null;
  }

  const { data: count, error: sendError } = await supabase.rpc("send_push_campaign", {
    p_campaign_id: created.id,
  });
  if (sendError) {
    console.warn("[services/pushCampaigns] send_push_campaign failed:", sendError.message);
    return { id: created.id, sentCount: 0 };
  }
  return { id: created.id, sentCount: typeof count === "number" ? count : 0 };
}

/**
 * 유튜브 링크에서 영상 id만 뽑는다. 본문 위에 미리보기를 띄울 때 쓴다.
 * youtu.be/ID, watch?v=ID, embed/ID, shorts/ID를 모두 받는다.
 */
export function youtubeIdFrom(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const patterns = [
    /youtu\.be\/([\w-]{6,})/,
    /[?&]v=([\w-]{6,})/,
    /youtube\.com\/embed\/([\w-]{6,})/,
    /youtube\.com\/shorts\/([\w-]{6,})/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }
  return null;
}
