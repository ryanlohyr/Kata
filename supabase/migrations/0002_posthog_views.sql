-- Convenience views for PostHog. PostHog's Postgres source can read tables and
-- views; views let you reshape data without changing the source schema.

-- Flat denormalised view: one row per snapshot with video metadata. Easiest to
-- chart in PostHog (filter by platform / author / video).
create or replace view v_video_snapshots as
select
  s.id              as snapshot_id,
  s.scraped_at,
  v.id              as video_id,
  v.platform,
  v.external_id,
  v.url,
  v.author_username,
  v.posted_at,
  s.views,
  s.likes,
  s.comments,
  s.shares,
  s.saves,
  s.plays
from snapshots s
join videos v on v.id = s.video_id;

-- Hourly rollup using the latest value per hour bucket — useful when polling
-- frequency is dense and you only need hourly resolution in PostHog.
create or replace view v_video_hourly as
select distinct on (video_id, bucket)
  video_id,
  date_trunc('hour', scraped_at) as bucket,
  scraped_at,
  views, likes, comments, shares, saves, plays
from snapshots
order by video_id, bucket, scraped_at desc;

-- Per-snapshot deltas (views/hour-ish); handy for "view velocity" charts.
create or replace view v_video_deltas as
select
  s.id              as snapshot_id,
  s.video_id,
  s.scraped_at,
  s.views,
  s.views - lag(s.views) over w as delta_views,
  s.likes - lag(s.likes) over w as delta_likes,
  s.comments - lag(s.comments) over w as delta_comments,
  extract(epoch from (s.scraped_at - lag(s.scraped_at) over w)) as elapsed_seconds
from snapshots s
window w as (partition by s.video_id order by s.scraped_at);
