CREATE TYPE "public"."platform" AS ENUM('tiktok', 'instagram');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poll_errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"video_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"video_id" uuid NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" bigint,
	"likes" bigint,
	"comments" bigint,
	"shares" bigint,
	"saves" bigint,
	"plays" bigint,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author_username" text,
	"author_id" text,
	"caption" text,
	"duration_seconds" integer,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_polled_at" timestamp with time zone,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poll_status" text DEFAULT 'active' NOT NULL,
	"consecutive_errors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poll_errors" ADD CONSTRAINT "poll_errors_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poll_errors_video_time_idx" ON "poll_errors" USING btree ("video_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_video_time_idx" ON "snapshots" USING btree ("video_id","scraped_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snapshots_video_id_scraped_at_key" ON "snapshots" USING btree ("video_id","scraped_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "videos_platform_external_id_key" ON "videos" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_next_poll_idx" ON "videos" USING btree ("next_poll_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_platform_idx" ON "videos" USING btree ("platform");