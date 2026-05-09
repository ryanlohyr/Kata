import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client uses the service-role key (bypasses RLS). NEVER ship this
// to the browser — only import this file from server functions / API routes.
let _server: SupabaseClient | null = null;
export function supabaseServer(): SupabaseClient {
  if (_server) return _server;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  _server = createClient(url, key, { auth: { persistSession: false } });
  return _server;
}
