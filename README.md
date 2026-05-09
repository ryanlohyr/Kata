# Viral Analytics

Track TikTok videos and Instagram Reels over time. Paste a link, and a polling
worker hits Decodo on an adaptive schedule, writing each snapshot to Supabase.
PostHog reads from Supabase via its Postgres source — that's where the
minute / hour / day breakdowns live.

```
TanStack Start (UI)  →  Supabase Postgres  ←  Decodo polling worker
                              ↓
                          PostHog (Postgres source → insights)
```

The TanStack frontend has a basic chart for spot-checking. PostHog is where you
build the real dashboards.

## Setup

### 1. Supabase

1. Create a Supabase project (Postgres 15 or 17 — we don't use TimescaleDB).
2. Run both migrations against your DB:
   ```bash
   supabase db push           # if using the Supabase CLI with a linked project
   # or paste each .sql file into the SQL editor manually:
   #   supabase/migrations/0001_init.sql
   #   supabase/migrations/0002_posthog_views.sql
   ```
3. Copy `Project URL` and `service_role` key from `Project Settings → API`.

### 2. Decodo

1. From [Decodo dashboard](https://dashboard.decodo.com/), grab your Web
   Scraping API username / password (NOT your proxy creds).
2. Confirm your plan covers the `tiktok_post` and `instagram_graphql_post`
   targets.

### 3. Env

```bash
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DECODO_USERNAME,
# DECODO_PASSWORD, CRON_SECRET (any long random string)
```

### 4. Run

```bash
npm install
npm run dev          # http://localhost:3000
```

Paste a TikTok or IG Reel link. The first poll runs immediately so the row is
populated; subsequent polls happen on the cron schedule below.

### 5. Drive the polling cron

The cron endpoint is `POST /api/cron/poll`, protected by `Authorization: Bearer ${CRON_SECRET}`.
Pick whichever of these fits your hosting:

**Local Mac / Linux** — add to crontab:
```cron
*/5 * * * *  curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/poll
```

**Vercel** — add to `vercel.json`:
```json
{ "crons": [{ "path": "/api/cron/poll", "schedule": "*/5 * * * *" }] }
```
(Vercel cron auto-includes the auth header if you set `CRON_SECRET` as an env var.)

**Supabase pg_cron** — schedule a `pg_net` HTTP call from inside the DB:
```sql
select cron.schedule(
  'viral-analytics-poll', '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://your-app.com/api/cron/poll',
       headers := '{"Authorization":"Bearer YOUR_SECRET"}'::jsonb
     ); $$
);
```

**No server?** Just run `npm run poll:once` from cron — it polls all due videos
and exits.

The job runs every 5 min, but each video has its own `next_poll_at`. The
adaptive cadence in [src/server/poll.ts](src/server/poll.ts):

| Video age   | Poll interval |
|-------------|---------------|
| 0–6h        | 5 min         |
| 6–24h       | 15 min        |
| 1–7 days    | hourly        |
| 7+ days     | daily         |

So a 5-min cron + a 1-hour-old video = polled every 15 min, regardless of how
often the cron fires. Cron just needs to fire at least as often as your
shortest interval.

### 6. Connect PostHog

This is the bit you screenshotted. In PostHog:

1. **Data warehouse → Sources → Postgres → Create**.
2. Use Supabase's connection string (Project Settings → Database → Connection
   string → URI — make sure you tick "Use connection pooling" if PostHog asks).
3. Pick the schema `public` and select these tables/views:
   - `videos` — one row per tracked link
   - `snapshots` — the time series (this is the important one)
   - `v_video_snapshots` — denormalised view, easiest to build insights from
   - `v_video_deltas` — pre-computed view-velocity for "views/hour" charts
4. Set the sync schedule to `Every hour` (or `Every 5 minutes` if you want
   near-real-time dashboards).
5. Use `snapshots.id` as the incremental column so PostHog only pulls new rows.

Once synced, in PostHog:

- **SQL Insight** → query `v_video_snapshots`, group by
  `dateTrunc('minute' | 'hour' | 'day', scraped_at)`, plot `max(views)` per
  bucket. Filter by `platform` or `author_username` for per-video / per-creator
  views.
- **Trends Insight** → use `snapshots` as the event source, treat `scraped_at`
  as the timestamp, `views` / `likes` as numeric properties, and aggregate
  with `max` (since metrics are cumulative).

## Architecture notes

- **Schema** is intentionally boring: two tables ([videos](supabase/migrations/0001_init.sql),
  [snapshots](supabase/migrations/0001_init.sql)). No TimescaleDB — at MVP scale,
  Postgres + a `(video_id, scraped_at desc)` index handles minute-resolution
  fine. If you ever cross ~10M snapshot rows, add `pg_partman` partitioning.
- **Decodo client** ([src/server/decodo.ts](src/server/decodo.ts)) tries
  parsed-JSON mode first, then falls back to extracting the
  `__UNIVERSAL_DATA_FOR_REHYDRATION__` blob (TikTok) or `shortcode_media`
  (Instagram) from raw HTML. Resilient to Decodo's parser shape changing.
- **Adaptive polling** ([src/server/poll.ts](src/server/poll.ts)) uses
  `next_poll_at` per video so the cron is dumb — it just picks up everything
  that's due and runs them with concurrency 5.
- **Errors** are logged to `poll_errors` and trigger exponential backoff. After
  10 consecutive failures, a video is marked `failed` and stops polling.

## File map

- [src/routes/index.tsx](src/routes/index.tsx) — dashboard (add link, list videos)
- [src/routes/videos.$videoId.tsx](src/routes/videos.$videoId.tsx) — detail + chart
- [src/routes/api/cron/poll.ts](src/routes/api/cron/poll.ts) — cron endpoint
- [src/server/functions.ts](src/server/functions.ts) — server fns (addVideo, etc)
- [src/server/decodo.ts](src/server/decodo.ts) — Decodo client + parsers
- [src/server/parse-url.ts](src/server/parse-url.ts) — URL → canonical form
- [src/server/poll.ts](src/server/poll.ts) — scrape + write snapshot + reschedule
- [supabase/migrations/](supabase/migrations/) — schema + PostHog views
- [scripts/poll-once.ts](scripts/poll-once.ts) — standalone cron-friendly script
