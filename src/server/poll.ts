// Core polling logic: scrape one video, write a snapshot, schedule the next poll.
// Called from both the manual "poll now" server function and the cron route.

import { supabaseServer } from "~/lib/supabase";
import { scrapeVideo } from "./decodo";
import type { ParsedVideo } from "./parse-url";

export type VideoRow = {
  id: string;
  platform: "tiktok" | "instagram";
  external_id: string;
  url: string;
  first_seen_at: string;
  last_polled_at: string | null;
  consecutive_errors: number;
};

export async function pollVideo(video: VideoRow): Promise<void> {
  const sb = supabaseServer();
  const parsed: ParsedVideo = {
    platform: video.platform,
    externalId: video.external_id,
    url: video.url,
  };

  try {
    const { metrics, raw } = await scrapeVideo(parsed);

    await sb.from("snapshots").insert({
      video_id: video.id,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      plays: metrics.plays,
      raw,
    });

    // Backfill metadata on first successful poll.
    const isFirst = video.last_polled_at === null;
    const updates: Record<string, unknown> = {
      last_polled_at: new Date().toISOString(),
      next_poll_at: nextPollTime(video.first_seen_at).toISOString(),
      consecutive_errors: 0,
      poll_status: "active",
    };
    if (isFirst) {
      if (metrics.authorUsername) updates.author_username = metrics.authorUsername;
      if (metrics.authorId) updates.author_id = metrics.authorId;
      if (metrics.caption) updates.caption = metrics.caption;
      if (metrics.durationSeconds) updates.duration_seconds = metrics.durationSeconds;
      if (metrics.postedAt) updates.posted_at = metrics.postedAt.toISOString();
    }
    await sb.from("videos").update(updates).eq("id", video.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errors = video.consecutive_errors + 1;
    await sb.from("poll_errors").insert({ video_id: video.id, message });
    await sb
      .from("videos")
      .update({
        consecutive_errors: errors,
        next_poll_at: backoffTime(errors).toISOString(),
        poll_status: errors >= 10 ? "failed" : "active",
      })
      .eq("id", video.id);
    throw err;
  }
}

// Adaptive cadence based on age of the video. Younger = poll more often, since
// that's when the curve is interesting. After a week we drop to daily.
function nextPollTime(firstSeenAt: string): Date {
  const ageMs = Date.now() - new Date(firstSeenAt).getTime();
  const minute = 60 * 1000;
  let intervalMs: number;
  if (ageMs < 6 * 60 * minute) intervalMs = 5 * minute; // first 6h: 5 min
  else if (ageMs < 24 * 60 * minute) intervalMs = 15 * minute; // 6–24h: 15 min
  else if (ageMs < 7 * 24 * 60 * minute) intervalMs = 60 * minute; // 1–7d: hourly
  else intervalMs = 24 * 60 * minute; // 7d+: daily
  return new Date(Date.now() + intervalMs);
}

function backoffTime(errors: number): Date {
  const minutes = Math.min(60 * 24, 5 * 2 ** Math.min(errors, 8));
  return new Date(Date.now() + minutes * 60 * 1000);
}
