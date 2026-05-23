/**
 * GET  /api/waiter/orders — list active dine-in orders (replaces direct supabase read).
 * POST /api/waiter/orders — place a new dine-in order.
 *
 * Both require a waiter session cookie. Uses the service role key — no admin
 * cookie needed (waiter PIN auth is client-side).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { requireWaiterAuth }         from "@/lib/waiterAuth";
import { parseBody }                 from "@/lib/apiValidation";
import { WaiterOrderCreateSchema }   from "@/lib/schemas/pos";
import { decrementStock, restoreStock, type StockItem } from "@/lib/stockMutation";

const POS_CUSTOMER_ID = "pos-walk-in";
const ACTIVE_DINE_IN_STATUSES = ["pending", "confirmed", "preparing", "ready", "delivered"];

export async function GET() {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("fulfillment", "dine-in")
    .in("status", ACTIVE_DINE_IN_STATUSES)
    .order("date", { ascending: false })
    .limit(500);

  if (error) {
    console.error("waiter/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, orders: data ?? [] });
}

async function ensureWalkInCustomer() {
  await supabaseAdmin.from("customers").upsert(
    { id: POS_CUSTOMER_ID, name: "POS Walk-in", email: "pos-walkin@internal",
      phone: "", tags: [], favourites: [], store_credit: 0 },
    { onConflict: "id", ignoreDuplicates: true },
  );
}

export async function POST(req: NextRequest) {
  const authError = await requireWaiterAuth();
  if (authError) return authError;

  const parsed = await parseBody(req, WaiterOrderCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { tableLabel, covers, staffName, items, total, kitchenNote } = parsed.data;

  try {
    await ensureWalkInCustomer();

    // ── Missing-row + active-flag + channel + manual-OOS check ──────────────
    // Reject lines for items admin has hidden from the menu (or moved to
    // online-only / out of stock) since the cart was built. Defence-in-depth;
    // the waiter UI already filters them out.
    //
    // The missing-row check is the asymmetry fix with the online path: when
    // admin hard-deletes a menu item, its row disappears from menu_items, the
    // active/channel/OOS .find() calls below all miss, AND decrement_stock_atomic
    // silently skips missing rows (schema.sql: "if not found then continue").
    // Without an explicit reject, a stale waiter tab could fire a kitchen
    // ticket for an item that no longer exists on the menu.
    const menuItemIds = items
      .map((i) => i.menuItemId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (menuItemIds.length > 0) {
      const { data: menuRows } = await supabaseAdmin
        .from("menu_items")
        .select("id, name, active, channels, stock_status, track_stock")
        .in("id", menuItemIds);
      const foundIds = new Set((menuRows ?? []).map((r) => r.id as string));
      const missing = items.find(
        (i) => typeof i.menuItemId === "string" && i.menuItemId.length > 0 && !foundIds.has(i.menuItemId),
      );
      if (missing) {
        return NextResponse.json(
          { ok: false, error: `'${missing.name || "An item"}' is no longer available on the menu.` },
          { status: 400 },
        );
      }
      const inactive = (menuRows ?? []).find((r) => r.active === false);
      if (inactive) {
        return NextResponse.json(
          { ok: false, error: `'${inactive.name}' is no longer available on the menu.` },
          { status: 400 },
        );
      }
      const onlineOnly = (menuRows ?? []).find((r) => {
        const ch = r.channels as string[] | null;
        return Array.isArray(ch) && ch.length > 0 && !ch.includes("in_store");
      });
      if (onlineOnly) {
        return NextResponse.json(
          { ok: false, error: `'${onlineOnly.name}' is online-only and cannot be sold for dine-in.` },
          { status: 400 },
        );
      }
      // Manual Status out_of_stock blocks dine-in too. Only applies to
      // non-tracked items; tracked items are governed by stock_qty alone.
      const manualOos = (menuRows ?? []).find(
        (r) => r.track_stock !== true && r.stock_status === "out_of_stock",
      );
      if (manualOos) {
        return NextResponse.json(
          { ok: false, error: `'${manualOos.name}' is out of stock.` },
          { status: 400 },
        );
      }
    }

    // ── Stock decrement (reject on insufficient) ────────────────────────────
    // Kitchen needs the ingredients to make the dish — unlike POS counter
    // sales we can't "warn but allow" because the food doesn't exist yet.
    const stockItems: StockItem[] = items
      .map((i) => ({ id: i.menuItemId ?? "", qty: i.qty }))
      .filter((i) => i.id);
    const stock = await decrementStock(stockItems);
    if (!stock.ok) {
      return NextResponse.json({ ok: false, error: stock.message }, { status: 409 });
    }

    // Build kitchen note — visible in the KDS "Special Note" amber box
    const noteParts = [`[WAITER] Table ${tableLabel}`];
    if (covers) noteParts.push(`${covers} cover${covers !== 1 ? "s" : ""}`);
    if (staffName) noteParts.push(`Staff: ${staffName}`);
    if (kitchenNote) noteParts.push(kitchenNote);
    const note = noteParts.join(" · ");

    const row = {
      id:             crypto.randomUUID(),
      customer_id:    POS_CUSTOMER_ID,
      date:           new Date().toISOString(),
      status:         "pending",
      fulfillment:    "dine-in",
      total:          total ?? items.reduce((s, i) => s + i.price * i.qty, 0),
      items,
      note,
      payment_method: "table-service",
    };

    const { error } = await supabaseAdmin.from("orders").insert(row);
    if (error) {
      // Insert failed after successful decrement — give the units back.
      restoreStock(stockItems).catch((err) =>
        console.error("[waiter/orders] restore after insert error:", err instanceof Error ? err.message : err),
      );
      console.error("waiter/orders POST:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, orderId: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/orders]", message);
    return NextResponse.json({ ok: false, error: "Failed to place order. Please try again." }, { status: 500 });
  }
}
