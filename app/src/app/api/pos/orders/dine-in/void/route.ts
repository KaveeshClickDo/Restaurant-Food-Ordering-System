/**
 * POST /api/pos/orders/dine-in/void — cancel active dine-in orders from the
 * POS dashboard's Dine-In tab.
 *
 * POS-native counterpart to /api/waiter/void. The POS dashboard runs on the
 * pos_staff_session cookie (NOT waiter_session), so it cannot use the waiter
 * endpoints — calling them returned 401 "Unauthorized". Gated by the POS
 * `canVoidSale` permission (admin session overrides), matching the gate the
 * dashboard already uses to show the button.
 *
 * Uses the service-role key — the anon role cannot UPDATE orders.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosDineInVoidSchema } from "@/lib/schemas/pos";
import { restoreStock, type StockItem } from "@/lib/stockMutation";

export async function POST(req: NextRequest) {
  const gate = await requirePosPermission("canVoidSale");
  if (!gate.ok) return gate.response;
  // Actor stamped from the session-bound POS staff row (admin → "POS Admin")
  // so the audit trail can't be forged from the request body.
  const actorName = gate.staff?.name ?? "POS Admin";

  const parsed = await parseBody(req, PosDineInVoidSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { orderIds, reason } = parsed.data;

  try {
    // The .not(status, in, ...) predicate gives idempotency for free: an
    // already-cancelled/settled order is not updated and so not returned, so a
    // retry won't double-restore its stock. Voids only apply to OPEN tables;
    // settled orders go through the refund path instead.
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
          console.error("pos/orders/dine-in/void fallback:", fallbackError.message);
          return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
        }
        voidedRows = fallbackRows ?? [];
      } else {
        console.error("pos/orders/dine-in/void:", error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
    } else {
      voidedRows = updatedRows ?? [];
    }

    // Restore stock for every line across every freshly-cancelled order.
    // Oversold orders are skipped: their original sale never decremented the
    // counter, so restoring would add units that were never subtracted.
    const stockItems: StockItem[] = voidedRows
      .filter((r) => r.oversold !== true)
      .flatMap((r) => {
        const items = Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : [];
        return items.map((i) => ({ id: String(i.menuItemId ?? ""), qty: Number(i.qty ?? 0) }));
      })
      .filter((i) => i.id);
    if (stockItems.length > 0) {
      restoreStock(stockItems).catch((err) =>
        console.error("[pos/orders/dine-in/void] stock restore:", err instanceof Error ? err.message : err),
      );
    }

    return NextResponse.json({ ok: true, voided: voidedRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[pos/orders/dine-in/void]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
