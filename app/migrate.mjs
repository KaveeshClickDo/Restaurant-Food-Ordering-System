// One-shot database setup for the Single-Restaurant Food Ordering System.
//
// Run with:  npm run db:migrate
// (loads DATABASE_URL from .env.local via Node's --env-file flag)
//
// Steps performed (all idempotent — safe to re-run):
//   1. Create core tables (app_settings, categories, menu_items, customers, orders)
//   2. Run supabase/setup_all.sql        — reservation tables
//   3. Run supabase/rls_policies.sql     — drivers table + RLS policies
//   4. Run supabase/auth_migration.sql   — bcrypt + email-verification columns

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to app/.env.local — see example.env.");
  process.exit(1);
}

// Inline base schema — the core tables every other migration assumes exist.
// Kept here (rather than as a .sql file) so a single `npm run db:migrate`
// bootstraps an empty Supabase project.
const baseSchema = `
create table if not exists app_settings (
  id         integer primary key default 1,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);

create table if not exists categories (
  id         text primary key,
  name       text not null,
  emoji      text not null default '',
  sort_order integer not null default 0
);

create table if not exists menu_items (
  id           text primary key,
  category_id  text not null references categories(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  price        numeric not null,
  image        text,
  dietary      text[] not null default '{}',
  popular      boolean not null default false,
  variations   jsonb,
  add_ons      jsonb,
  stock_qty    integer,
  stock_status text,
  sort_order   integer not null default 0
);

create table if not exists customers (
  id              text primary key,
  name            text not null,
  email           text not null unique,
  phone           text not null default '',
  password        text,
  created_at      timestamptz not null default now(),
  tags            text[] not null default '{}',
  favourites      text[] not null default '{}',
  saved_addresses jsonb not null default '[]',
  store_credit    numeric not null default 0
);

create table if not exists orders (
  id                text primary key,
  customer_id       text not null references customers(id) on delete cascade,
  date              timestamptz not null default now(),
  status            text not null default 'pending',
  fulfillment       text not null default 'delivery',
  total             numeric not null,
  items             jsonb not null default '[]',
  address           text,
  note              text,
  payment_method    text,
  delivery_fee      numeric,
  service_fee       numeric,
  scheduled_time    text,
  coupon_code       text,
  coupon_discount   numeric,
  vat_amount        numeric,
  vat_inclusive     boolean,
  driver_id         text,
  driver_name       text,
  delivery_status   text,
  refunds           jsonb not null default '[]',
  refunded_amount   numeric not null default 0,
  store_credit_used numeric not null default 0
);

insert into customers (id, name, email, phone)
values ('pos-walk-in', 'POS Walk-In', 'pos-walk-in@local', '')
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table app_settings; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table categories;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table menu_items;   exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table customers;    exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table orders;       exception when duplicate_object then null; end;
  end if;
end $$;
`;

const sqlFiles = [
  "supabase/setup_all.sql",
  "supabase/rls_policies.sql",
  "supabase/auth_migration.sql",
];

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const t0 = Date.now();
await client.connect();
console.log("✓ connected to Postgres");

console.log("\n▶ Step 1/4: base schema (inline)");
await client.query(baseSchema);
console.log("✓ base schema OK");

for (let i = 0; i < sqlFiles.length; i++) {
  const rel = sqlFiles[i];
  const path = resolve(repoRoot, rel);
  const sql = readFileSync(path, "utf8");
  console.log(`\n▶ Step ${i + 2}/4: ${rel}`);
  try {
    await client.query(sql);
    console.log(`✓ ${rel} OK`);
  } catch (err) {
    console.error(`✗ ${rel} FAILED — ${err.message}`);
    if (err.position) {
      const pos = parseInt(err.position, 10);
      const start = Math.max(0, pos - 80);
      const end = Math.min(sql.length, pos + 80);
      console.error(`Context near pos ${pos}:\n${sql.slice(start, end)}`);
    }
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\n✅ Migration complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
