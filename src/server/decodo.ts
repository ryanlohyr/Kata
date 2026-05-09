// Decodo Web Scraping API client.
// Docs: https://help.decodo.com/docs/web-scraping-api-quick-start
//
// We hit the synchronous endpoint (POST /v2/scrape) and ask for parsed JSON
// where Decodo supports it. For TikTok we fall back to extracting metrics from
// the embedded __UNIVERSAL_DATA_FOR_REHYDRATION__ blob. For Instagram we use
// the GraphQL target which always returns parsed JSON.

import type { ParsedVideo } from "./parse-url";

const DECODO_URL = "https://scraper-api.decodo.com/v2/scrape";

export type Metrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  plays: number | null;
  // Metadata captured opportunistically — we only write it on the first snapshot.
  authorUsername?: string | null;
  authorId?: string | null;
  caption?: string | null;
  durationSeconds?: number | null;
  postedAt?: Date | null;
};

export type ScrapeResult = {
  metrics: Metrics;
  raw: unknown;
};

function authHeader(): string {
  const user = process.env.DECODO_USERNAME;
  const pass = process.env.DECODO_PASSWORD;
  if (!user || !pass) {
    throw new Error("DECODO_USERNAME / DECODO_PASSWORD env vars are required");
  }
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${token}`;
}

async function decodoScrape(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(DECODO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Decodo ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

export async function scrapeVideo(video: ParsedVideo): Promise<ScrapeResult> {
  if (video.platform === "tiktok") return scrapeTikTok(video.url);
  return scrapeInstagram(video.url);
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

async function scrapeTikTok(url: string): Promise<ScrapeResult> {
  // Try parsed mode first; fall back to HTML extraction if Decodo returns raw.
  const raw = (await decodoScrape({ target: "tiktok_post", url, parse: true })) as DecodoResponse;
  const content = raw?.results?.[0]?.content;

  // Parsed JSON path
  if (content && typeof content === "object") {
    const m = parseTikTokJson(content);
    if (m) return { metrics: m, raw };
  }

  // HTML fallback — extract __UNIVERSAL_DATA_FOR_REHYDRATION__
  if (typeof content === "string") {
    const m = extractTikTokFromHtml(content);
    if (m) return { metrics: m, raw };
  }

  throw new Error("TikTok: could not extract metrics from Decodo response");
}

function parseTikTokJson(obj: any): Metrics | null {
  // Decodo's TikTok parser shape varies; probe a few likely paths.
  const stats = obj?.stats ?? obj?.itemInfo?.itemStruct?.stats ?? obj?.aweme_detail?.statistics;
  const author = obj?.author ?? obj?.itemInfo?.itemStruct?.author ?? obj?.aweme_detail?.author;
  const desc = obj?.desc ?? obj?.itemInfo?.itemStruct?.desc ?? obj?.aweme_detail?.desc;
  const created = obj?.createTime ?? obj?.itemInfo?.itemStruct?.createTime ?? obj?.aweme_detail?.create_time;
  if (!stats) return null;
  return {
    views: num(stats.playCount ?? stats.play_count),
    likes: num(stats.diggCount ?? stats.digg_count),
    comments: num(stats.commentCount ?? stats.comment_count),
    shares: num(stats.shareCount ?? stats.share_count),
    saves: num(stats.collectCount ?? stats.collect_count),
    plays: num(stats.playCount ?? stats.play_count),
    authorUsername: author?.uniqueId ?? author?.unique_id ?? null,
    authorId: author?.id ?? null,
    caption: typeof desc === "string" ? desc : null,
    durationSeconds: num(obj?.video?.duration ?? obj?.aweme_detail?.video?.duration),
    postedAt: created ? new Date(Number(created) * 1000) : null,
  };
}

function extractTikTokFromHtml(html: string): Metrics | null {
  // Modern TikTok pages embed a JSON blob in <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">.
  const m = html.match(
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  let blob: any;
  try {
    blob = JSON.parse(m[1]!);
  } catch {
    return null;
  }
  const item =
    blob?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct ?? null;
  if (!item) return null;
  const stats = item.stats ?? item.statsV2 ?? {};
  const author = item.author ?? {};
  return {
    views: num(stats.playCount),
    likes: num(stats.diggCount),
    comments: num(stats.commentCount),
    shares: num(stats.shareCount),
    saves: num(stats.collectCount),
    plays: num(stats.playCount),
    authorUsername: author.uniqueId ?? null,
    authorId: author.id ?? null,
    caption: item.desc ?? null,
    durationSeconds: num(item?.video?.duration),
    postedAt: item.createTime ? new Date(Number(item.createTime) * 1000) : null,
  };
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

async function scrapeInstagram(url: string): Promise<ScrapeResult> {
  // instagram_graphql_post returns parsed JSON for both posts and reels.
  const raw = (await decodoScrape({
    target: "instagram_graphql_post",
    url,
    parse: true,
  })) as DecodoResponse;
  const content = raw?.results?.[0]?.content;
  if (content && typeof content === "object") {
    const m = parseInstagramJson(content);
    if (m) return { metrics: m, raw };
  }
  // Fallback: try the plain instagram_post target which returns HTML.
  const raw2 = (await decodoScrape({ target: "instagram_post", url })) as DecodoResponse;
  const html = raw2?.results?.[0]?.content;
  if (typeof html === "string") {
    const m = extractInstagramFromHtml(html);
    if (m) return { metrics: m, raw: raw2 };
  }
  throw new Error("Instagram: could not extract metrics from Decodo response");
}

function parseInstagramJson(obj: any): Metrics | null {
  // Common shapes: { data: { shortcode_media: {...} } } or top-level shortcode_media.
  const media =
    obj?.data?.shortcode_media ??
    obj?.shortcode_media ??
    obj?.data?.xdt_shortcode_media ??
    obj?.xdt_shortcode_media;
  if (!media) return null;
  const owner = media.owner ?? {};
  const captionEdge = media.edge_media_to_caption?.edges?.[0]?.node?.text ?? null;
  return {
    views: num(media.video_view_count ?? media.video_play_count),
    plays: num(media.video_play_count ?? media.video_view_count),
    likes: num(media.edge_media_preview_like?.count ?? media.edge_liked_by?.count),
    comments: num(media.edge_media_to_comment?.count ?? media.edge_media_to_parent_comment?.count),
    shares: null, // IG doesn't expose share counts publicly
    saves: null, // IG doesn't expose save counts publicly
    authorUsername: owner.username ?? null,
    authorId: owner.id ?? null,
    caption: captionEdge,
    durationSeconds: num(media.video_duration),
    postedAt: media.taken_at_timestamp ? new Date(Number(media.taken_at_timestamp) * 1000) : null,
  };
}

function extractInstagramFromHtml(html: string): Metrics | null {
  // IG embeds initial state in inline scripts; look for the shortcode_media blob.
  const m = html.match(/"shortcode_media":(\{[\s\S]*?\}),"\w+":/);
  if (!m) return null;
  try {
    const media = JSON.parse(m[1]!);
    return parseInstagramJson({ shortcode_media: media });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type DecodoResponse = {
  results?: Array<{ content?: unknown; status_code?: number }>;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
