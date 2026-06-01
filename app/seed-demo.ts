/**
 * Optional demo data seed — populates a fresh DB with content suitable for
 * presentations, screenshots, and local feature testing.
 *
 *   Run with:  npm run db:seed-demo
 *
 * DEMO ONLY. DO NOT RUN AGAINST A PRODUCTION DATABASE.
 *
 *   • Mock customers ship with the literal password "password" (bcrypt-hashed).
 *   • Demo staff PINs are 1234 / 5678 / 9012 — known credentials.
 *   • Refuses to run when NODE_ENV is "production" unless ALLOW_DEMO_SEED_IN_PROD is set.
 *
 * The script is idempotent: every table is checked for existing data first
 * and skipped if already populated. Re-running is safe; you won't get
 * duplicates.
 *
 * What gets seeded:
 *   • categories          (only if the table is empty)
 *   • menu_items          (only if the table is empty)
 *   • customers + orders  (only if no real customer rows exist yet)
 *   • pos_staff           (one "Demo Admin", PIN 1234)
 *   • waiters             (one "Demo Waiter", PIN 5678)
 *   • kitchen_staff       (one "Demo Chef", PIN 9012)
 *
 * Everything runs inside async main() because tsx transpiles to CommonJS by
 * default, and CommonJS doesn't allow top-level `await`.
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import { categories as demoCategories, menuItems as demoMenuItems, mealPeriods as demoMealPeriods } from "./src/data/menu-new.js";
import { mockCustomers } from "./src/data/customers.js";

const HASH_ROUNDS = 10;

async function tableEmpty(client: pg.Client, table: string): Promise<boolean> {
  const r = await client.query<{ count: string }>(
    `select count(*)::text as count from ${table}`,
  );
  return Number(r.rows[0]?.count ?? "0") === 0;
}

async function customersEmpty(client: pg.Client): Promise<boolean> {
  // The pos-walk-in sentinel always exists after migrate, so "empty for demo
  // purposes" means "no real customer rows".
  const r = await client.query<{ count: string }>(
    `select count(*)::text as count from customers where id <> 'pos-walk-in'`,
  );
  return Number(r.rows[0]?.count ?? "0") === 0;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DEMO_SEED_IN_PROD) {
    console.error("✗ Refusing to seed demo data in production. Set ALLOW_DEMO_SEED_IN_PROD=1 to override.");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("✗ DATABASE_URL is not set. Add it to app/.env.local.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log("✓ connected to Postgres");
    const summary: string[] = [];

    // ── Categories ─────────────────────────────────────────────────────────
    if (await tableEmpty(client, "categories")) {
      const rows = demoCategories.map((c, i) => [c.id, c.name, c.emoji ?? "", i]);
      for (const [id, name, emoji, sort_order] of rows) {
        await client.query(
          `insert into categories (id, name, emoji, sort_order)
           values ($1, $2, $3, $4)`,
          [id, name, emoji, sort_order],
        );
      }
      summary.push(`categories: seeded ${rows.length}`);
    } else {
      summary.push("categories: already populated, skipped");
    }

    // ── Meal periods ───────────────────────────────────────────────────────
    if (await tableEmpty(client, "meal_periods")) {
      for (const p of demoMealPeriods) {
        await client.query(
          `insert into meal_periods
             (id, name, enabled, start_time, end_time, days_of_week, sort_order)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [p.id, p.name, p.enabled, p.startTime, p.endTime, p.daysOfWeek, p.sortOrder],
        );
      }
      summary.push(`meal_periods: seeded ${demoMealPeriods.length}`);
    } else {
      summary.push("meal_periods: already populated, skipped");
    }

    // ── Menu items ─────────────────────────────────────────────────────────
    // Bug #2 — writes the unified POS / admin field set:
    //   cost, sku, emoji, color, active, track_stock, offer
    // All are nullable / defaulted, so the seed file still works against an
    // older schema if the new columns are absent.
    if (await tableEmpty(client, "menu_items")) {
      let mimpCount = 0;
      for (const m of demoMenuItems) {
        await client.query(
          `insert into menu_items
             (id, category_id, name, description, price, image, dietary, popular,
              variations, add_ons, stock_qty, stock_status, sort_order,
              cost, sku, emoji, color, active, track_stock, offer)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,
                   $14,$15,$16,$17,$18,$19,$20::jsonb)`,
          [
            m.id, m.categoryId, m.name, m.description ?? "",
            m.price, m.image ?? "",
            m.dietary ?? [], m.popular ?? false,
            JSON.stringify(m.variations ?? []),
            JSON.stringify(m.addOns ?? []),
            m.stockQty ?? null,
            // Tracked items leave stock_status NULL so a mode-switch later
            // doesn't inherit a stale status. Untracked items default to
            // "in_stock" unless the seed says otherwise.
            typeof m.stockQty === "number" ? null : (m.stockStatus ?? "in_stock"),
            0,
            m.cost ?? null, m.sku ?? null,
            m.emoji ?? null, m.color ?? null,
            m.active ?? true, typeof m.stockQty === "number",
            m.offer ? JSON.stringify(m.offer) : null,
          ],
        );
        for (const mpId of m.mealPeriodIds ?? []) {
          await client.query(
            `insert into menu_item_meal_periods (menu_item_id, meal_period_id)
             values ($1, $2)`,
            [m.id, mpId],
          );
          mimpCount++;
        }
      }
      summary.push(`menu_items: seeded ${demoMenuItems.length} (${mimpCount} meal-period tags)`);
    } else {
      summary.push("menu_items: already populated, skipped");
    }

    // ── Customers + their orders ───────────────────────────────────────────
    // Note: the legacy `password` column was dropped in schema.sql — only
    // password_hash exists now.
    if (await customersEmpty(client)) {
      let orderCount = 0;
      for (const c of mockCustomers) {
        const passwordHash = c.password ? await bcrypt.hash(c.password, HASH_ROUNDS) : "";
        await client.query(
          `insert into customers
             (id, name, email, phone, password_hash, created_at,
              tags, favourites, saved_addresses, store_credit, email_verified)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,true)`,
          [
            c.id, c.name, c.email, c.phone ?? "",
            passwordHash, c.createdAt,
            c.tags ?? [], c.favourites ?? [],
            JSON.stringify(c.savedAddresses ?? []),
            c.storeCredit ?? 0,
          ],
        );

        for (const o of c.orders ?? []) {
          await client.query(
            `insert into orders
               (id, customer_id, date, status, fulfillment, total, items,
                address, note, payment_method, delivery_fee, service_fee,
                scheduled_time, coupon_code, coupon_discount,
                vat_amount, vat_inclusive, driver_id, driver_name, delivery_status,
                refunds, refunded_amount, store_credit_used)
             values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23)`,
            [
              o.id, o.customerId, o.date, o.status, o.fulfillment, o.total,
              JSON.stringify(o.items ?? []),
              o.address ?? "", o.note ?? "", o.paymentMethod ?? "",
              o.deliveryFee ?? 0, o.serviceFee ?? 0,
              o.scheduledTime ?? "", o.couponCode ?? "", o.couponDiscount ?? 0,
              o.vatAmount ?? 0, o.vatInclusive ?? true,
              o.driverId ?? "", o.driverName ?? "", o.deliveryStatus ?? "",
              JSON.stringify(o.refunds ?? []),
              o.refundedAmount ?? 0, o.storeCreditUsed ?? 0,
            ],
          );
          orderCount++;
        }
      }
      summary.push(`customers: seeded ${mockCustomers.length} (+ ${orderCount} orders)`);
    } else {
      summary.push("customers: real rows present, skipped");
    }

    // ── Demo staff (PINs bcrypt-hashed) ────────────────────────────────────
    if (await tableEmpty(client, "pos_staff")) {
      const pinHash = await bcrypt.hash("1234", HASH_ROUNDS);
      await client.query(
        `insert into pos_staff
           (name, email, role, pin_hash, active, permissions, avatar_color)
         values
           ('Demo Admin', 'demo-admin@restaurant.local', 'admin', $1, true,
            $2::jsonb, '#7c3aed')`,
        [pinHash, JSON.stringify({
          canApplyDiscount: true,  canVoidSale: true,    canIssueRefund: true,
          canAccessDashboard: true, canManageStaff: true, canManageMenu: true,
          canManageCustomers: true, canAccessSettings: true,
        })],
      );
      summary.push("pos_staff: seeded Demo Admin (PIN 1234)");
    } else {
      summary.push("pos_staff: already populated, skipped");
    }

    if (await tableEmpty(client, "waiters")) {
      const pinHash = await bcrypt.hash("5678", HASH_ROUNDS);
      await client.query(
        `insert into waiters (name, email, pin_hash, active, avatar_color)
         values ('Demo Waiter', 'demo-waiter@restaurant.local', $1, true, '#0891b2')`,
        [pinHash],
      );
      summary.push("waiters: seeded Demo Waiter (PIN 5678)");
    } else {
      summary.push("waiters: already populated, skipped");
    }

    if (await tableEmpty(client, "kitchen_staff")) {
      const pinHash = await bcrypt.hash("9012", HASH_ROUNDS);
      await client.query(
        `insert into kitchen_staff (name, email, role, pin_hash, active, avatar_color)
         values ('Demo Chef', 'demo-kitchen@restaurant.local', 'head_chef', $1, true, '#dc2626')`,
        [pinHash],
      );
      summary.push("kitchen_staff: seeded Demo Chef (PIN 9012)");
    } else {
      summary.push("kitchen_staff: already populated, skipped");
    }

    console.log("\n──── Demo seed summary ────");
    for (const line of summary) console.log("  " + line);
    console.log("───────────────────────────\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("✗ demo seed failed:", message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("✗ unhandled error in seed-demo:", err);
  process.exit(1);
});
