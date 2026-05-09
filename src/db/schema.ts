// Drizzle schema — single source of truth for the database.
// Run `npm run db:generate` after editing to produce a migration in drizzle/.
// Run `npm run db:migrate` to apply pending migrations against $DATABASE_URL.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["tiktok", "instagram"]);

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    authorUsername: text("author_username"),
    authorId: text("author_id"),
    caption: text("caption"),
    durationSeconds: integer("duration_seconds"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull().defaultNow(),
    pollStatus: text("poll_status").notNull().default("active"),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
  },
  (t) => ({
    platformExternalUnique: uniqueIndex("videos_platform_external_id_key").on(
      t.platform,
      t.externalId,
    ),
    nextPollIdx: index("videos_next_poll_idx").on(t.nextPollAt),
    platformIdx: index("videos_platform_idx").on(t.platform),
  }),
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
    views: bigint("views", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    plays: bigint("plays", { mode: "number" }),
    raw: jsonb("raw"),
  },
  (t) => ({
    videoTimeIdx: index("snapshots_video_time_idx").on(t.videoId, t.scrapedAt),
    videoTimeUnique: uniqueIndex("snapshots_video_id_scraped_at_key").on(t.videoId, t.scrapedAt),
  }),
);

export const pollErrors = pgTable(
  "poll_errors",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    videoId: uuid("video_id").references(() => videos.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    message: text("message").notNull(),
    payload: jsonb("payload"),
  },
  (t) => ({
    videoTimeIdx: index("poll_errors_video_time_idx").on(t.videoId, t.occurredAt),
  }),
);

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
