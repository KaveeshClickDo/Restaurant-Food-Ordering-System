/**
 * POST /api/pos/orders — bridge POS sales into the Supabase orders table
 * so they appear in the Kitchen Display System in real-time.
 *
 * Requires a valid `pos_staff_session` cookie issued by POST /api/pos/auth.
 * If POS staff have not yet been configured in Supabase the guard is relaxed
 * so that existing deployments continue to work during the migration period.
 * Uses the service role key to bypass RLS on INSERT.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { cartLineTotal }             from "@/types/pos";
import type { POSSale }              from "@/types/pos";
import { getPosSession }             from "@/lib/auth";

const POS_CUSTOMER_ID   = "pos-walk-in";
const POS_CUSTOMER_NAME = "POS Walk-in";

/**
 * Ensure the walk-in sentinel customer exists so POS orders have a valid
 * customer_id FK. ignoreDuplicates means subsequent calls are no-ops.
 */
async function ensureWalkInCustomer() {
  await supabaseAdmin.from("customers").upsert(
    {
      id:         POS_CUSTOMER_ID,
      name:       POS_CUSTOMER_NAME,
      email:      "pos-walkin@internal",
      phone:      "",
      tags:       [],
      favourites: [],
      store_credit: 0,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
}

export async function POST(req: NextRequest) {
  // Auth guard: require a valid POS session cookie once POS staff are configured.
  // We check the flag lazily (after parsing the body) so we can still return 400
  // on bad JSON before hitting Supabase for the auth check.
  const session = await getPosSession();
  if (!session) {
    // Check whether POS staff have been configured yet.
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings").select("data").eq("id", 1).single();
    const posStaffConfigured = (settingsRow?.data?.pos_staff ?? []).length > 0;
    if (posStaffConfigured) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    // POS staff not yet configured — allow through for backward compatibility.
  }

  let sale: POSSale;
  try { sale = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  if (!sale.id || !Array.isArray(sale.items) || sale.items.length === 0) {
    return NextResponse.json({ ok: false, error: "Invalid sale payload." }, { status: 400 });
  }

  try {
    await ensureWalkInCustomer();

    // Map POS cart items → OrderLine, appending modifier labels to the name
    const items = sale.items.map((item) => {
      const modLabel = item.modifiers?.length
        ? ` (${item.modifiers.map((m) => m.optionLabel).join(", ")})`
        : "";
      const lineTotal = cartLineTotal(item);
      return {
        name:  item.name + modLabel,
        qty:   item.quantity,
        price: parseFloat((lineTotal / item.quantity).toFixed(2)),
      };
    });

    // Build a note that gives kitchen staff all the context they need
    const noteParts: string[] = ["[POS]"];
    if (sale.customerName) noteParts.push(`Customer: ${sale.customerName}`);
    noteParts.push(`Staff: ${sale.staffName || "Unknown"}`);
    noteParts.push(`Receipt: ${sale.receiptNo}`);
    if (sale.discountNote) noteParts.push(`Discount: ${sale.discountNote}`);
    const note = noteParts.join(" | ");

    const row = {
      id:             sale.id,
      customer_id:    POS_CUSTOMER_ID,
      date:           sale.date,
      status:         "pending",
      fulfillment:    "collection",
      total:          sale.total,
      items,
      note,
      payment_method:  sale.paymentMethod,
      vat_amount:      sale.taxAmount,
      vat_inclusive:   sale.taxInclusive,
      tip_amount:      (sale.tipAmount ?? 0) > 0 ? sale.tipAmount   : null,
      change_given:    (sale.changeGiven ?? 0) > 0 ? sale.changeGiven : null,
    };

    const { error } = await supabaseAdmin.from("orders").insert(row);
    if (error) {
      console.error("pos/orders POST:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("POST /api/pos/orders:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
