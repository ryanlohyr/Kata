// Parse TikTok / Instagram URLs into a canonical {platform, externalId, url}.
// Accepts the messy real-world variants users will paste (mobile share links,
// vm.tiktok shortlinks, ?si= tracking params, /reel/ vs /reels/, etc.).

export type Platform = "tiktok" | "instagram";

export type ParsedVideo = {
  platform: Platform;
  externalId: string;
  url: string; // canonical URL we'll feed to Decodo
};

const TIKTOK_VIDEO_RE = /tiktok\.com\/@([\w.-]+)\/video\/(\d+)/i;
const TIKTOK_SHORT_RE = /(?:vm|vt)\.tiktok\.com\/([\w]+)/i;
const IG_REEL_RE = /instagram\.com\/(?:reel|reels|p)\/([\w-]+)/i;

export async function parseVideoUrl(input: string): Promise<ParsedVideo> {
  const trimmed = input.trim();

  let m = trimmed.match(TIKTOK_VIDEO_RE);
  if (m) {
    const [, username, videoId] = m;
    return {
      platform: "tiktok",
      externalId: videoId!,
      url: `https://www.tiktok.com/@${username}/video/${videoId}`,
    };
  }

  m = trimmed.match(TIKTOK_SHORT_RE);
  if (m) {
    // Resolve vm.tiktok.com / vt.tiktok.com shortlinks via HEAD redirect.
    const resolved = await resolveRedirect(trimmed);
    const inner = resolved.match(TIKTOK_VIDEO_RE);
    if (inner) {
      const [, username, videoId] = inner;
      return {
        platform: "tiktok",
        externalId: videoId!,
        url: `https://www.tiktok.com/@${username}/video/${videoId}`,
      };
    }
    throw new Error(`Could not resolve TikTok short link: ${trimmed}`);
  }

  m = trimmed.match(IG_REEL_RE);
  if (m) {
    const shortcode = m[1]!;
    return {
      platform: "instagram",
      externalId: shortcode,
      url: `https://www.instagram.com/reel/${shortcode}/`,
    };
  }

  throw new Error(`Unrecognised URL — paste a TikTok video or Instagram reel link: ${trimmed}`);
}

async function resolveRedirect(url: string): Promise<string> {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return res.url;
}
