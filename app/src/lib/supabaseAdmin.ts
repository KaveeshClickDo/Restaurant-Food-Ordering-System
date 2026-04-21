/**
 * Supabase admin client — uses the service role key.
 * This module MUST only be imported from server-side code (API routes).
 * Never import it from components, context, or any file that runs in the browser.
 *
 * If SUPABASE_SERVICE_ROLE_KEY is not set the exported client is a lazy proxy
 * that throws a descriptive error on first use, so the Next.js server still
 * starts and returns a 503 from any admin route rather than crashing.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function makeClient(): SupabaseClient {
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local — it must never be committed to source control.",
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Lazily initialised so the module can be imported without crashing when the
// env var is absent (useful during development before the key is configured).
let _client: SupabaseClient | null = null;

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_client) _client = makeClient();
    return (_client as unknown as Record<string | symbol, unknown>)[prop];
  },
});
