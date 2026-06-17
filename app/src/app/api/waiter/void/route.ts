/**
 * POST /api/waiter/void
 * Cancels one or more active waiter orders (before payment).
 * Requires the orderId(s), a reason, and the staff member's name.
 * Uses the service-role key — anon role cannot UPDATE orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireWaiterAuth } from "@/lib/waiterAuth";
import { getWaiterSession } from "@/lib/auth";
import { parseBody } from "@/lib/apiValidation";
import { WaiterVoidSchema } from "@/lib/schemas/waiter";
import { restoreStock, type StockItem } from "@/lib/stockMutation";

export async function POST(req: NextRequest) {
  const unauth = await requireWaiterAuth();
  if (unauth) return unauth;
  const session = await getWaiterSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = await parseBody(req, WaiterVoidSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  // F-INS-5: voidedBy from body is ignored — stamped from session-bound waiter
  // row so the audit trail can't be forged.
  const { orderIds, reason } = parsed.data;

  // Voids are a senior / head-waiter privilege. The client hides the action
  // for regular waiters, but enforce it server-side too so a forged request
  // can't bypass the role gate (AUTH_AUDIT 06-F14 elevation).
  const { data: waiterRow } = await supabaseAdmin
    .from("waiters").select("name, role").eq("id", session.id).maybeSingle();
  if (waiterRow?.role !== "senior") {
    return NextResponse.json(
      { ok: false, error: "Only senior staff can void orders." },
      { status: 403 },
    );
  }
  const actorName = waiterRow?.name ?? "Staff";

  try {
    // The .not(status, in, ...) predicate gives us idempotency for free:
    // an already-cancelled order is not updated and so not returned, so we
    // won't double-restore its stock on a retry. .select("items, oversold")
    // returns the rows that did transition into cancelled, plus the flag so
    // we know whether the original sale actually decremented stock.
    let voidedRows: Array<{ id: string; items: unknown; oversold?: boolean | null }> = [];

    const { data: updatedRows, error } = await supabaseAdmin
      .from("orders")
      .update({
        status:      "cancelled",
        void_reason: reason.trim(),
        voided_by:   actorName,
        voided_at:   new Date().toISOString(),
      })
      .in("id", orderIds)
      .eq("fulfillment", "dine-in")
      .not("status", "in", '("delivered","cancelled")')
      .select("id, items, oversold");

    if (error) {
      // If the void audit columns don't exist yet, retry with just the status change.
      if (error.code === "PGRST204" || error.message?.includes("void_reason") || error.message?.includes("voided_by")) {
        const { data: fallbackRows, error: fallbackError } = await supabaseAdmin
          .from("orders")
          .update({ status: "cancelled" })
          .in("id", orderIds)
          .eq("fulfillment", "dine-in")
          .not("status", "in", '("delivered","cancelled")')
          .select("id, items, oversold");

        if (fallbackError) {
          console.error("waiter/void fallback:", fallbackError.message);
          return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
        }
        voidedRows = fallbackRows ?? [];
      } else {
        console.error("waiter/void:", error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    } else {
      voidedRows = updatedRows ?? [];
    }

    // Restore stock for every line across every freshly-cancelled order.
    // Items shape on dine-in orders: [{ menuItemId, name, qty, price }].
    // Oversold orders are skipped: their original sale never decremented the
    // counter (webhook accepted the paid order despite the stock check
    // failing), so restoring would add units that were never subtracted.
    const stockItems: StockItem[] = voidedRows
      .filter((r) => r.oversold !== true)
      .flatMap((r) => {
        const items = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : [];
        return items.map((i) => ({ id: String(i.menuItemId ?? ""), qty: Number(i.qty ?? 0) }));
      })
      .filter((i) => i.id);
    if (stockItems.length > 0) {
      restoreStock(stockItems).catch((err) =>
        console.error("[waiter/void] stock restore:", err instanceof Error ? err.message : err),
      );
    }

    // Cancel the bill's kitchen tickets too, so they leave the KDS + floor.
    // Best-effort — the bill rows are already cancelled above.
    const { error: ticketErr } = await supabaseAdmin
      .from("dine_in_tickets")
      .update({ status: "cancelled" })
      .in("order_id", orderIds)
      .not("status", "in", '("delivered","cancelled")');
    if (ticketErr) console.error("[waiter/void] ticket cancel:", ticketErr.message);

    return NextResponse.json({ ok: true, voided: voidedRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[waiter/void]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
