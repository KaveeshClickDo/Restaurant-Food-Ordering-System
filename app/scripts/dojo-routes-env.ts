/**
 * Imported first by dojo-routes.ts. Points the app's database client at the
 * stand-in database that script starts, before any app code reads its
 * settings, so the route check never touches a real database.
 */

export const STAND_IN_DB_PORT = 54329;

process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${STAND_IN_DB_PORT}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "stand-in";
