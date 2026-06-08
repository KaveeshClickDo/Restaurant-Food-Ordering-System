/**
 * Menu seed — populates a fresh DB with the Lion Restaurant menu only.
 *
 *   Run with:  npm run db:seed-menu
 *
 * Seeds categories, meal periods, and menu items (plus their meal-period
 * tags) from src/data/menu-lionrestaurant.ts. It deliberately does NOT seed
 * customers, orders, or any staff accounts — this is purely the menu.
 *
 * The script is idempotent: each table is checked for existing rows first and
 * skipped if already populated, so re-running is safe and won't duplicate.
 *
 * Everything runs inside async main() because tsx transpiles to CommonJS by
 * default, and CommonJS doesn't allow top-level `await`.
 */

import pg from "pg";
import {
  categories as menuCategories,
  menuItems,
  mealPeriods,
} from "./src/data/menu-lionrestaurant.js";

async function tableEmpty(client: pg.Client, table: string): Promise<boolean> {
  const r = await client.query<{ count: string }>(
    `select count(*)::text as count from ${table}`,
  );
  return Number(r.rows[0]?.count ?? "0") === 0;
}

async function main(): Promise<void> {
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
      const rows = menuCategories.map((c, i) => [c.id, c.name, c.emoji ?? "", i, c.parentId ?? null]);
      for (const [id, name, emoji, sort_order, parent_id] of rows) {
        await client.query(
          `insert into categories (id, name, emoji, sort_order, parent_id)
           values ($1, $2, $3, $4, $5)`,
          [id, name, emoji, sort_order, parent_id],
        );
      }
      summary.push(`categories: seeded ${rows.length}`);
    } else {
      summary.push("categories: already populated, skipped");
    }

    // ── Meal periods ───────────────────────────────────────────────────────
    if (await tableEmpty(client, "meal_periods")) {
      for (const p of mealPeriods) {
        await client.query(
          `insert into meal_periods
             (id, name, enabled, start_time, end_time, days_of_week, sort_order, theme_color)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [p.id, p.name, p.enabled, p.startTime, p.endTime, p.daysOfWeek, p.sortOrder, p.themeColor],
        );
      }
      summary.push(`meal_periods: seeded ${mealPeriods.length}`);
    } else {
      summary.push("meal_periods: already populated, skipped");
    }

    // ── Menu items ─────────────────────────────────────────────────────────
    // Writes the unified POS / admin field set:
    //   cost, sku, emoji, color, active, track_stock, offer
    // All are nullable / defaulted, so the seed still works against an older
    // schema if the new columns are absent.
    if (await tableEmpty(client, "menu_items")) {
      let mimpCount = 0;
      for (const m of menuItems) {
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
      summary.push(`menu_items: seeded ${menuItems.length} (${mimpCount} meal-period tags)`);
    } else {
      summary.push("menu_items: already populated, skipped");
    }

    console.log("\n──── Menu seed summary ────");
    for (const line of summary) console.log("  " + line);
    console.log("───────────────────────────\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("✗ menu seed failed:", message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("✗ unhandled error in seed-menu:", err);
  process.exit(1);
});
