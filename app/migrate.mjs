// One-shot database setup for the Single-Restaurant Food Ordering System.
//
// Run with:  npm run db:migrate
// (loads DATABASE_URL from .env.local via Node's --env-file flag)
//
// Applies the canonical schema in supabase/schema.sql. That file is the single
// source of truth — every table, column, RLS policy, and Realtime publication
// is in there. Safe to re-run any number of times (every statement is
// idempotent: IF NOT EXISTS / DROP IF EXISTS / DO $$).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, "..");
const schemaPath = resolve(repoRoot, "supabase/schema.sql");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to app/.env.local — see example.env.");
  process.exit(1);
}

const sql = readFileSync(schemaPath, "utf8");

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const t0 = Date.now();
await client.connect();
console.log("✓ connected to Postgres");

console.log("\n▶ applying supabase/schema.sql");
try {
  await client.query(sql);
  console.log("✓ schema applied");
} catch (err) {
  console.error(`✗ schema FAILED — ${err.message}`);
  if (err.position) {
    const pos   = parseInt(err.position, 10);
    const start = Math.max(0, pos - 80);
    const end   = Math.min(sql.length, pos + 80);
    console.error(`Context near pos ${pos}:\n${sql.slice(start, end)}`);
  }
  await client.end();
  process.exit(1);
}

await client.end();
console.log(`\n✅ Migration complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
