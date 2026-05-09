import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // DATABASE_URL only needed for db:migrate / db:push / db:studio.
  // db:generate works offline (diffs schema vs prior migrations).
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://placeholder" },
  // Supabase ships with extensions, auth schemas, etc — keep migrations
  // scoped to public so we don't try to drop their tables.
  schemaFilter: ["public"],
  tablesFilter: ["videos", "snapshots", "poll_errors"],
});
