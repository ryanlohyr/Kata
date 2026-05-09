# Viral Analytics

Track TikTok videos and Instagram Reels over time. Paste a link, and a polling
worker hits Decodo on an adaptive schedule, writing each snapshot to Supabase
Postgres via Drizzle. PostHog reads from the same DB via its Postgres source —
that's where the minute / hour / day breakdowns live.

```
TanStack Start (UI)  →  Supabase Postgres  ←  Decodo polling worker
                            (Drizzle)
                              ↓
                          PostHog (Postgres source → insights)
```

The TanStack frontend has a basic chart for spot-checking. PostHog is where you
build the real dashboards.

## Stack

- **Frontend / API:** TanStack Start (Vite, file-based routes, server functions)
- **DB:** Supabase Postgres
- **ORM / migrations:** Drizzle + drizzle-kit
- **Scraper:** Decodo Web Scraping API
- **Hosting:** Railway
- **Dashboards:** PostHog Postgres data warehouse source

## Setup

### 1. Supabase

1. Create a Supabase project.
2. Get the connection string from `Project Settings → Database → Connection
   string → Transaction` (the pooler, port 6543). Copy it as `DATABASE_URL`.

### 2. Env

```bash
cp .env.example .env
# fill in DATABASE_URL, DECODO_USERNAME, DECODO_PASSWORD, CRON_SECRET
```

### 3. Run migrations

Schema lives in TypeScript at [src/db/schema.ts](src/db/schema.ts). To apply:

```bash
npm install
npm run db:migrate    # applies drizzle/0000_init.sql to $DATABASE_URL
```

After future schema changes:
```bash
npm run db:generate -- --name some_change   # creates a new migration
npm run db:migrate                          # applies it
```

`npm run db:studio` opens Drizzle Studio for browsing data.

### 4. Run the app

```bash
npm run dev          # http://localhost:3000
```

Paste a TikTok or IG Reel link. The first poll runs immediately so the row is
populated; subsequent polls happen on the cron schedule below.

### 5. Decodo

1. From [Decodo dashboard](https://dashboard.decodo.com/), grab your Web
   Scraping API username / password (NOT your proxy creds).
2. Confirm your plan covers the `tiktok_post` and `instagram_graphql_post`
   targets.

### 6. Drive the polling cron

The cron endpoint is `POST /api/cron/poll`, protected by `Authorization: Bearer ${CRON_SECRET}`.

**Local Mac / Linux** — add to crontab:
```cron
*/5 * * * *  curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/poll
```

**Railway cron service** (recommended for production) — see Railway docs; create
a separate service in the same project that hits the URL on a schedule.

**No server?** Just run `npm run poll:once` from cron — it polls all due videos
and exits.

The job runs every 5 min, but each video has its own `next_poll_at`. Adaptive
cadence in [src/server/poll.ts](src/server/poll.ts):

| Video age   | Poll interval |
|-------------|---------------|
| 0–6h        | 5 min         |
| 6–24h       | 15 min        |
| 1–7 days    | hourly        |
| 7+ days     | daily         |

So a 5-min cron + a 1-hour-old video = polled every 15 min. The cron just needs
to fire at least as often as your shortest interval.

### 7. Connect PostHog

1. **PostHog → Data warehouse → Sources → Postgres → Create**.
2. Use the Supabase connection string (same as `DATABASE_URL`, but use the
   *direct* connection on port 5432 if PostHog has trouble with the pooler).
3. Pick the `public` schema and select tables:
   - `videos` — one row per tracked link
   - `snapshots` — the time series (this is the important one)
   - `poll_errors` — debugging
4. Set sync schedule to `Every hour` (or `Every 5 minutes` for near-real-time).
5. Use `snapshots.id` as the incremental column so PostHog only pulls new rows.

Once synced, in PostHog:

- **SQL Insight** → join `snapshots` and `videos`, group by
  `dateTrunc('minute' | 'hour' | 'day', scraped_at)`, plot `max(views)` per
  bucket. Filter by `videos.platform` or `videos.author_username`.
- **Trends Insight** → use `snapshots` as the event source, treat `scraped_at`
  as the timestamp, `views` / `likes` as numeric properties, aggregate with
  `max` (since metrics are cumulative).

## Architecture notes

- **Schema** is intentionally boring: three tables defined in
  [src/db/schema.ts](src/db/schema.ts). No TimescaleDB — at MVP scale, Postgres
  + a `(video_id, scraped_at desc)` index handles minute-resolution fine. Cross
  ~10M rows? Add `pg_partman` partitioning.
- **Decodo client** ([src/server/decodo.ts](src/server/decodo.ts)) tries
  parsed-JSON mode first, then falls back to extracting the
  `__UNIVERSAL_DATA_FOR_REHYDRATION__` blob (TikTok) or `shortcode_media`
  (Instagram) from raw HTML. Resilient to Decodo's parser shape changing.
- **Adaptive polling** ([src/server/poll.ts](src/server/poll.ts)) uses
  `next_poll_at` per video, so cron is dumb — it picks up everything that's
  due and runs them with concurrency 5.
- **Errors** logged to `poll_errors` with exponential backoff. After 10
  consecutive failures, a video is marked `failed` and stops polling.

## File map

- [src/routes/index.tsx](src/routes/index.tsx) — dashboard
- [src/routes/videos.$videoId.tsx](src/routes/videos.$videoId.tsx) — detail + chart
- [src/routes/api/cron/poll.ts](src/routes/api/cron/poll.ts) — cron endpoint
- [src/server/functions.ts](src/server/functions.ts) — server fns
- [src/server/decodo.ts](src/server/decodo.ts) — Decodo client + parsers
- [src/server/parse-url.ts](src/server/parse-url.ts) — URL → canonical form
- [src/server/poll.ts](src/server/poll.ts) — scrape + write snapshot + reschedule
- [src/db/schema.ts](src/db/schema.ts) — Drizzle schema (source of truth)
- [src/db/index.ts](src/db/index.ts) — Drizzle client
- [drizzle/](drizzle/) — generated SQL migrations
- [scripts/poll-once.ts](scripts/poll-once.ts) — standalone cron-friendly script
