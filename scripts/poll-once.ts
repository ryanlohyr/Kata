// One-shot polling script for local dev / Mac launchd / a plain crontab entry.
// Usage:  tsx scripts/poll-once.ts
// Reads .env from the project root and polls every video that's due.

import "dotenv/config";
import { supabaseServer } from "../src/lib/supabase";
import { pollVideo, type VideoRow } from "../src/server/poll";

async function main() {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("videos")
    .select("id, platform, external_id, url, first_seen_at, last_polled_at, consecutive_errors")
    .eq("poll_status", "active")
    .lte("next_poll_at", new Date().toISOString())
    .order("next_poll_at", { ascending: true })
    .limit(100);
  if (error) throw error;

  const videos = (data ?? []) as VideoRow[];
  console.log(`polling ${videos.length} videos`);

  for (const v of videos) {
    try {
      await pollVideo(v);
      console.log(`  ✓ ${v.platform} ${v.external_id}`);
    } catch (err) {
      console.log(`  ✗ ${v.platform} ${v.external_id}: ${(err as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
