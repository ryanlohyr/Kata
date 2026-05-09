// TanStack Start server functions — type-safe RPC between client and server.
// Each createServerFn returns a function callable from any component / loader;
// the body only ever runs on the server.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "~/lib/supabase";
import { parseVideoUrl } from "./parse-url";
import { pollVideo, type VideoRow } from "./poll";

// ---------------------------------------------------------------------------
// addVideo — paste a link, save the video row, kick off an immediate first poll
// ---------------------------------------------------------------------------
export const addVideo = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().url() }).parse)
  .handler(async ({ data }) => {
    const parsed = await parseVideoUrl(data.url);
    const sb = supabaseServer();

    // Upsert (don't error if user pastes the same link twice).
    const { data: row, error } = await sb
      .from("videos")
      .upsert(
        {
          platform: parsed.platform,
          external_id: parsed.externalId,
          url: parsed.url,
        },
        { onConflict: "platform,external_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Fire-and-forget the first poll so the UI shows numbers fast.
    pollVideo(row as VideoRow).catch(() => {
      // poll() already records errors to poll_errors; swallow here so add() returns.
    });

    return { id: row!.id };
  });

// ---------------------------------------------------------------------------
// listVideos — dashboard list with latest snapshot joined in
// ---------------------------------------------------------------------------
export const listVideos = createServerFn({ method: "GET" }).handler(async () => {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("videos")
    .select(
      `
      id, platform, external_id, url, author_username, caption,
      first_seen_at, last_polled_at, poll_status, consecutive_errors,
      latest:snapshots(views, likes, comments, shares, saves, scraped_at)
    `,
    )
    .order("first_seen_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Snapshots come back as an array of all snapshots; we only want the latest one.
  // Easier to do the trim here than to fight Supabase's PostgREST embedding.
  return (data ?? []).map((v: any) => {
    const latest = (v.latest ?? []).sort(
      (a: any, b: any) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime(),
    )[0];
    return { ...v, latest: latest ?? null };
  });
});

// ---------------------------------------------------------------------------
// getVideo — single video + its full snapshot history (for the chart)
// ---------------------------------------------------------------------------
export const getVideo = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data }) => {
    const sb = supabaseServer();
    const [{ data: video, error: ve }, { data: snapshots, error: se }] = await Promise.all([
      sb.from("videos").select("*").eq("id", data.id).single(),
      sb
        .from("snapshots")
        .select("scraped_at, views, likes, comments, shares, saves, plays")
        .eq("video_id", data.id)
        .order("scraped_at", { ascending: true }),
    ]);
    if (ve) throw new Error(ve.message);
    if (se) throw new Error(se.message);
    return { video, snapshots: snapshots ?? [] };
  });

// ---------------------------------------------------------------------------
// pollNow — manual "refresh" button on a video detail page
// ---------------------------------------------------------------------------
export const pollNow = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data }) => {
    const sb = supabaseServer();
    const { data: video, error } = await sb.from("videos").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    await pollVideo(video as VideoRow);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// deleteVideo — stop tracking + remove all snapshots
// ---------------------------------------------------------------------------
export const deleteVideo = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data }) => {
    const sb = supabaseServer();
    const { error } = await sb.from("videos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
