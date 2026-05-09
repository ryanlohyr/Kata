// Cron endpoint — hit this on a schedule to drive polling. Picks up every video
// whose next_poll_at is in the past and runs them with concurrency 5.
//
// Auth: pass header `Authorization: Bearer ${CRON_SECRET}`.

import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq, lte } from "drizzle-orm";
import { db, schema } from "~/db";
import { pollVideo } from "~/server/poll";

const CONCURRENCY = 5;
const BATCH_SIZE = 100;

export const Route = createFileRoute("/api/cron/poll")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const d = db();
  const videos = await d
    .select()
    .from(schema.videos)
    .where(and(eq(schema.videos.pollStatus, "active"), lte(schema.videos.nextPollAt, new Date())))
    .orderBy(asc(schema.videos.nextPollAt))
    .limit(BATCH_SIZE);

  const results = await runPool(videos, CONCURRENCY, async (v) => {
    try {
      await pollVideo(v);
      return { id: v.id, ok: true as const };
    } catch (err) {
      return {
        id: v.id,
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  return Response.json({
    polled: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    failures: results.filter((r) => !r.ok),
  });
}

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
