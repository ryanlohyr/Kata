// One-shot polling script for local dev / Mac launchd / a plain crontab entry.
// Usage:  tsx scripts/poll-once.ts

import "dotenv/config";
import { and, asc, eq, lte } from "drizzle-orm";
import { db, schema } from "../src/db";
import { pollVideo } from "../src/server/poll";

async function main() {
  const d = db();
  const videos = await d
    .select()
    .from(schema.videos)
    .where(and(eq(schema.videos.pollStatus, "active"), lte(schema.videos.nextPollAt, new Date())))
    .orderBy(asc(schema.videos.nextPollAt))
    .limit(100);

  console.log(`polling ${videos.length} videos`);

  for (const v of videos) {
    try {
      await pollVideo(v);
      console.log(`  ✓ ${v.platform} ${v.externalId}`);
    } catch (err) {
      console.log(`  ✗ ${v.platform} ${v.externalId}: ${(err as Error).message}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
