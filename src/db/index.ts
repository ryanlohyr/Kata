// Lazy Drizzle client. Server-only — never import from a client component.
//
// Uses postgres-js. For Supabase, point DATABASE_URL at the connection-pooled
// URL on port 6543 (Project Settings → Database → Connection string → Transaction
// pooler). The pooler doesn't allow prepared statements, so we disable them.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: PostgresJsDatabase<typeof schema> | null = null;

export function db(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL env var is required");
  const client = postgres(url, { prepare: false });
  _db = drizzle(client, { schema });
  return _db;
}

export { schema };
