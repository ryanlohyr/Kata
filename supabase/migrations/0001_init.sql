-- Viral Analytics schema
-- Two tables: videos (one row per tracked link) + snapshots (one row per poll).
-- Designed to be PostHog-friendly: monotonic ids and timestamps for incremental sync.

create extension if not exists pgcrypto;

create type platform as enum ('tiktok', 'instagram');

create table videos (
  id                uuid primary key default gen_random_uuid(),
  platform          platform not null,
  external_id       text not null,                  -- TikTok video id or IG shortcode
  url               text not null,
  author_username   text,
  author_id         text,
  caption           text,
  duration_seconds  int,
  posted_at         timestamptz,                    -- when the creator posted it
  first_seen_at     timestamptz not null default now(),
  last_polled_at    timestamptz,
  next_poll_at      timestamptz not null default now(),
  poll_status       text not null default 'active', -- 'active' | 'paused' | 'failed'
  consecutive_errors int not null default 0,
  unique (platform, external_id)
);

create index videos_next_poll_idx on videos (next_poll_at) where poll_status = 'active';
create index videos_platform_idx on videos (platform);

create table snapshots (
  id           bigserial primary key,
  video_id     uuid not null references videos(id) on delete cascade,
  scraped_at   timestamptz not null default now(),
  views        bigint,
  likes        bigint,
  comments     bigint,
  shares       bigint,
  saves        bigint,
  plays        bigint,         -- IG-specific (play_count); often equals views on TT
  raw          jsonb,          -- keep the parsed payload for debugging / future fields
  unique (video_id, scraped_at)
);

create index snapshots_video_time_idx on snapshots (video_id, scraped_at desc);
-- Monotonic id index lets PostHog's Postgres source do efficient incremental sync.
create index snapshots_id_idx on snapshots (id);

-- Per-video polling-error log for debugging (optional but cheap).
create table poll_errors (
  id         bigserial primary key,
  video_id   uuid references videos(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  message    text not null,
  payload    jsonb
);
create index poll_errors_video_time_idx on poll_errors (video_id, occurred_at desc);
