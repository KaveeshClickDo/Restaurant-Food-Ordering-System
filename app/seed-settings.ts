/**
 * Post-migrate settings seed.
 *
 *   Run with:  npx tsx --env-file=.env.local seed-settings.ts
 *   (chained automatically from `npm run db:migrate`)
 *
 * Imports DEFAULT_SETTINGS from src/data/defaultSettings.ts so the seeded JSON
 * is the same blob the runtime uses as its baseline. The update is gated on
 * `data = '{}'::jsonb` so it only fires on a fresh DB — re-running the script
 * never overwrites an admin's customisations.
 *
 * Why this exists: schema.sql is structural only (tables / RLS / grants).
 * Without this step, a fresh install would render with no theme, no
 * restaurant info, and no email templates until admin saved every panel
 * manually. With it, the site is usable immediately after migrate.
 */

import pg from "pg";
import { DEFAULT_SETTINGS } from "./src/data/defaultSettings.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ DATABASE_URL is not set. Add it to app/.env.local.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const res = await client.query<{ id: number }>(
    `update app_settings
        set data = $1::jsonb,
            updated_at = now()
      where id = 1
        and data = '{}'::jsonb
      returning id`,
    [JSON.stringify(DEFAULT_SETTINGS)],
  );

  if (res.rowCount === 0) {
    console.log("⏭  app_settings already populated — settings seed skipped");
  } else {
    console.log("✓ seeded app_settings.data with defaults");
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error("✗ settings seed failed:", message);
  process.exitCode = 1;
} finally {
  await client.end();
}
