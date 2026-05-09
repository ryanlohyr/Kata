// TanStack Start server functions — type-safe RPC between client and server.
// Each createServerFn returns a function callable from any component / loader;
// the body only ever runs on the server.

import { createServerFn } from "@tanstack/react-start";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "~/db";
import { parseVideoUrl } from "./parse-url";
import { pollVideo, type VideoRow } from "./poll";

// ---------------------------------------------------------------------------
// addVideo — paste a link, save the video row, kick off an immediate first poll
// ---------------------------------------------------------------------------
export const addVideo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ url: z.string().url() }))
  .handler(async ({ data }) => {
    const parsed = await parseVideoUrl(data.url);
    const d = db();

    const [row] = await d
      .insert(schema.videos)
      .values({
        platform: parsed.platform,
        externalId: parsed.externalId,
        url: parsed.url,
      })
      .onConflictDoUpdate({
        target: [schema.videos.platform, schema.videos.externalId],
        set: { url: parsed.url },
      })
      .returning();

    if (!row) throw new Error("Failed to insert video");

    // Fire-and-forget the first poll so the UI shows numbers fast.
    pollVideo(row).catch(() => {
      // pollVideo already logs to poll_errors.
    });

    return { id: row.id };
  });

// ---------------------------------------------------------------------------
// listVideos — dashboard list with the latest snapshot joined in
// ---------------------------------------------------------------------------
export const listVideos = createServerFn({ method: "GET" }).handler(async () => {
  const d = db();
  // DISTINCT ON gives us "latest snapshot per video" in one query.
  const rows = await d.execute<{
    id: string;
    platform: "tiktok" | "instagram";
    external_id: string;
    url: string;
    author_username: string | null;
    caption: string | null;
    first_seen_at: Date;
    last_polled_at: Date | null;
    poll_status: string;
    consecutive_errors: number;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    scraped_at: Date | null;
  }>(sql`
    select
      v.id, v.platform, v.external_id, v.url, v.author_username, v.caption,
      v.first_seen_at, v.last_polled_at, v.poll_status, v.consecutive_errors,
      s.views, s.likes, s.comments, s.shares, s.saves, s.scraped_at
    from ${schema.videos} v
    left join lateral (
      select * from ${schema.snapshots} s
      where s.video_id = v.id
      order by s.scraped_at desc
      limit 1
    ) s on true
    order by v.first_seen_at desc
  `);

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    external_id: r.external_id,
    url: r.url,
    author_username: r.author_username,
    caption: r.caption,
    first_seen_at: r.first_seen_at,
    last_polled_at: r.last_polled_at,
    poll_status: r.poll_status,
    consecutive_errors: r.consecutive_errors,
    latest:
      r.scraped_at === null
        ? null
        : {
            views: r.views,
            likes: r.likes,
            comments: r.comments,
            shares: r.shares,
            saves: r.saves,
            scraped_at: r.scraped_at,
          },
  }));
});

// ---------------------------------------------------------------------------
// getVideo — single video + its full snapshot history (for the chart)
// ---------------------------------------------------------------------------
export const getVideo = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const d = db();
    const [video] = await d.select().from(schema.videos).where(eq(schema.videos.id, data.id));
    if (!video) throw new Error("Video not found");
    const snaps = await d
      .select({
        scraped_at: schema.snapshots.scrapedAt,
        views: schema.snapshots.views,
        likes: schema.snapshots.likes,
        comments: schema.snapshots.comments,
        shares: schema.snapshots.shares,
        saves: schema.snapshots.saves,
        plays: schema.snapshots.plays,
      })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.videoId, data.id))
      .orderBy(schema.snapshots.scrapedAt);
    return { video, snapshots: snaps };
  });

// ---------------------------------------------------------------------------
// pollNow — manual "refresh" button on a video detail page
// ---------------------------------------------------------------------------
export const pollNow = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const d = db();
    const [video] = await d.select().from(schema.videos).where(eq(schema.videos.id, data.id));
    if (!video) throw new Error("Video not found");
    await pollVideo(video as VideoRow);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// deleteVideo — stop tracking + remove all snapshots
// ---------------------------------------------------------------------------
export const deleteVideo = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const d = db();
    await d.delete(schema.videos).where(eq(schema.videos.id, data.id));
    return { ok: true };
  });

