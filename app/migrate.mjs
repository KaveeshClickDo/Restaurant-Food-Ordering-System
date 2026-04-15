import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString:
    "postgresql://postgres:JI9bz3tavD5zz8a4@db.auzsboqisdhbwemeembh.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false },
});

const schema = `
-- ─── App settings (single JSONB row for all restaurant config) ─────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data       JSONB   NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Categories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL DEFAULT '🍽️',
  sort_order INTEGER DEFAULT 0
);

-- ─── Menu items ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id           TEXT PRIMARY KEY,
  category_id  TEXT REFERENCES categories(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  description  TEXT        DEFAULT '',
  price        NUMERIC(10,2) NOT NULL,
  image        TEXT        DEFAULT '',
  dietary      TEXT[]      DEFAULT '{}',
  popular      BOOLEAN     DEFAULT false,
  variations   JSONB       DEFAULT '[]'::jsonb,
  add_ons      JSONB       DEFAULT '[]'::jsonb,
  stock_qty    INTEGER,
  stock_status TEXT        DEFAULT 'in_stock'
);

-- ─── Customers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  name            TEXT   NOT NULL,
  email           TEXT   UNIQUE NOT NULL,
  phone           TEXT   DEFAULT '',
  password        TEXT   DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  tags            TEXT[] DEFAULT '{}',
  favourites      TEXT[] DEFAULT '{}',
  saved_addresses JSONB  DEFAULT '[]'::jsonb
);

-- ─── Orders ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT REFERENCES customers(id) ON DELETE CASCADE,
  date             TIMESTAMPTZ   DEFAULT NOW(),
  status           TEXT          NOT NULL DEFAULT 'pending',
  fulfillment      TEXT          NOT NULL DEFAULT 'delivery',
  total            NUMERIC(10,2) NOT NULL DEFAULT 0,
  items            JSONB         NOT NULL DEFAULT '[]'::jsonb,
  address          TEXT          DEFAULT '',
  note             TEXT          DEFAULT '',
  payment_method   TEXT          DEFAULT '',
  delivery_fee     NUMERIC(10,2) DEFAULT 0,
  service_fee      NUMERIC(10,2) DEFAULT 0,
  scheduled_time   TEXT          DEFAULT '',
  coupon_code      TEXT          DEFAULT '',
  coupon_discount  NUMERIC(10,2) DEFAULT 0,
  vat_amount       NUMERIC(10,2) DEFAULT 0,
  vat_inclusive    BOOLEAN       DEFAULT true,
  driver_id        TEXT          DEFAULT '',
  driver_name      TEXT          DEFAULT '',
  delivery_status  TEXT          DEFAULT ''
);

-- ─── Enable Realtime ───────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE app_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- ─── Disable RLS (dev/demo — enable + add policies in production) ──────────────
ALTER TABLE app_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories    DISABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items    DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers     DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders        DISABLE ROW LEVEL SECURITY;

-- ─── Grant anon key full access ────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON app_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON categories    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON menu_items    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON customers     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders        TO anon;
`;

async function run() {
  await client.connect();
  console.log("Connected to Supabase PostgreSQL");

  // Run each statement separately to handle the "already exists" cases gracefully
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await client.query(stmt);
      const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
      console.log(`✓ ${preview}…`);
    } catch (err) {
      const msg = err.message;
      // Ignore "already in publication" errors
      if (msg.includes("already exists") || msg.includes("already member")) {
        console.log(`  (skip — already exists)`);
      } else {
        console.error(`✗ ${stmt.slice(0, 60)}…`);
        console.error(`  ${msg}`);
      }
    }
  }

  await client.end();
  console.log("\nMigration complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
