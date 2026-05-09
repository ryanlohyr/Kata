// Cron endpoint — hit this on a schedule (Vercel cron, Supabase pg_cron, GitHub
// Actions, whatever) to drive polling. Picks up every video whose next_poll_at
// is in the past, runs them in parallel with a small concurrency cap.
//
// Auth: pass header `Authorization: Bearer ${CRON_SECRET}`.

import { createServerFileRoute } from "@tanstack/react-start/server";
import { supabaseServer } from "~/lib/supabase";
import { pollVideo, type VideoRow } from "~/server/poll";

const CONCURRENCY = 5;
const BATCH_SIZE = 100;

export const ServerRoute = createServerFileRoute("/api/cron/poll").methods({
  GET: async ({ request }) => handle(request),
  POST: async ({ request }) => handle(request),
});

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("videos")
    .select("id, platform, external_id, url, first_seen_at, last_polled_at, consecutive_errors")
    .eq("poll_status", "active")
    .lte("next_poll_at", new Date().toISOString())
    .order("next_poll_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  const videos = (data ?? []) as VideoRow[];

  const results = await runPool(videos, CONCURRENCY, async (v) => {
    try {
      await pollVideo(v);
      return { id: v.id, ok: true as const };
    } catch (err) {
      return { id: v.id, ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  return Response.json({
    polled: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    failures: results.filter((r) => !r.ok),
  });
}

// Tiny concurrency pool — keeps Decodo from getting hammered when batches are large.
async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}
