import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Emit a clear, actionable error in development and in server logs so the
// root cause is obvious instead of surfacing as a cryptic 500.
if (!supabaseUrl || !supabaseKey) {
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !supabaseKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean).join(", ");

  console.error(
    `[supabase] Missing environment variable(s): ${missing}.\n` +
    `Add them to .env.local (or your deployment secrets) and restart the server.\n` +
    `Without these, all Supabase calls will fail and the app will load with empty data.`
  );
}

// createClient is still called even when vars are missing so that the module
// exports a valid object — avoids a module-level throw that would 500 every page.
// All network requests will fail with an auth/URL error, which init() catches.
export const supabase = createClient(supabaseUrl, supabaseKey);
