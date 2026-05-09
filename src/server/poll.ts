// Core polling logic: scrape one video, write a snapshot, schedule the next poll.
// Called from both the manual "poll now" server function and the cron route.

import { eq } from "drizzle-orm";
import { db, schema } from "~/db";
import type { Video } from "~/db/schema";
import { scrapeVideo } from "./decodo";

export type VideoRow = Video;

export async function pollVideo(video: VideoRow): Promise<void> {
  const d = db();
  const parsed = {
    platform: video.platform,
    externalId: video.externalId,
    url: video.url,
  };

  try {
    const { metrics, raw } = await scrapeVideo(parsed);

    await d.insert(schema.snapshots).values({
      videoId: video.id,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      plays: metrics.plays,
      raw,
    });

    const isFirst = video.lastPolledAt === null;
    const updates: Partial<typeof schema.videos.$inferInsert> = {
      lastPolledAt: new Date(),
      nextPollAt: nextPollTime(video.firstSeenAt),
      consecutiveErrors: 0,
      pollStatus: "active",
    };
    if (isFirst) {
      if (metrics.authorUsername) updates.authorUsername = metrics.authorUsername;
      if (metrics.authorId) updates.authorId = metrics.authorId;
      if (metrics.caption) updates.caption = metrics.caption;
      if (metrics.durationSeconds) updates.durationSeconds = metrics.durationSeconds;
      if (metrics.postedAt) updates.postedAt = metrics.postedAt;
    }
    await d.update(schema.videos).set(updates).where(eq(schema.videos.id, video.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errors = video.consecutiveErrors + 1;
    await d.insert(schema.pollErrors).values({ videoId: video.id, message });
    await d
      .update(schema.videos)
      .set({
        consecutiveErrors: errors,
        nextPollAt: backoffTime(errors),
        pollStatus: errors >= 10 ? "failed" : "active",
      })
      .where(eq(schema.videos.id, video.id));
    throw err;
  }
}

// Adaptive cadence based on age of the video. Younger = poll more often, since
// that's when the curve is interesting. After a week we drop to daily.
function nextPollTime(firstSeenAt: Date): Date {
  const ageMs = Date.now() - firstSeenAt.getTime();
  const minute = 60 * 1000;
  let intervalMs: number;
  if (ageMs < 6 * 60 * minute) intervalMs = 5 * minute;
  else if (ageMs < 24 * 60 * minute) intervalMs = 15 * minute;
  else if (ageMs < 7 * 24 * 60 * minute) intervalMs = 60 * minute;
  else intervalMs = 24 * 60 * minute;
  return new Date(Date.now() + intervalMs);
}

function backoffTime(errors: number): Date {
  const minutes = Math.min(60 * 24, 5 * 2 ** Math.min(errors, 8));
  return new Date(Date.now() + minutes * 60 * 1000);
}
