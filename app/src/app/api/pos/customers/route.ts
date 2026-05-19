/**
 * GET  /api/pos/customers  — list customers for the POS UI.
 * POST /api/pos/customers  — create a new customer from the POS terminal.
 *
 * Bug #11 — POS customers now share the `customers` table with admin. This
 * endpoint mirrors the response shape of /api/admin/customers/list (minus
 * the `orders[]` field, which POS doesn't render) including the computed
 * totalSpend / visitCount / lastVisit aggregates so the POS UI can show
 * spend stats and last-visit timestamps without going to localStorage.
 *
 * Auth: requires a valid pos_staff_session cookie. Cashiers, managers, and
 * admins all hold `canManageCustomers` by default (see ROLE_PERMISSIONS in
 * src/types/pos.ts), so any logged-in POS user can use these endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosSession } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosCustomerCreateSchema } from "@/lib/schemas/customer";

const POS_WALK_IN_ID = "pos-walk-in";

interface AggregateBucket {
  spend: number;
  visits: number;
  lastVisit: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any, agg: AggregateBucket) {
  return {
    id:              row.id,
    name:            row.name,
    email:           row.email ?? "",
    phone:           row.phone ?? "",
    tags:            row.tags ?? [],
    favourites:     row.favourites ?? [],
    savedAddresses: row.saved_addresses ?? [],
    storeCredit:     row.store_credit != null ? Number(row.store_credit) : undefined,
    emailVerified:   row.email_verified ?? undefined,
    loyaltyPoints:   row.loyalty_points    != null ? Number(row.loyalty_points)    : 0,
    giftCardBalance: row.gift_card_balance != null ? Number(row.gift_card_balance) : 0,
    notes:           row.notes ?? "",
    totalSpend:      parseFloat(agg.spend.toFixed(2)),
    visitCount:      agg.visits,
    lastVisit:       agg.lastVisit ?? undefined,
    createdAt:       typeof row.created_at === "string"
                       ? row.created_at
                       : new Date(row.created_at).toISOString(),
    // POS doesn't render the full orders list — keep an empty array so the
    // shared Customer type's `orders` field is still well-defined.
    orders:          [] as unknown[],
  };
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET() {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;

  // Three queries in parallel — same approach as /api/admin/customers/list,
  // batched to avoid an N+1 against each customer.
  const [
    { data: customers, error: errC },
    { data: orders,    error: errO },
    { data: posSales,  error: errP },
  ] = await Promise.all([
    supabaseAdmin
      .from("customers")
      .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, email_verified, loyalty_points, gift_card_balance, notes")
      .neq("id", POS_WALK_IN_ID),
    supabaseAdmin
      .from("orders")
      .select("customer_id, total, status, date"),
    supabaseAdmin
      .from("pos_sales")
      .select("customer_id, total, voided, date")
      .eq("voided", false)
      .not("customer_id", "is", null),
  ]);

  if (errC) return NextResponse.json({ ok: false, error: errC.message }, { status: 500 });
  if (errO) return NextResponse.json({ ok: false, error: errO.message }, { status: 500 });
  if (errP) return NextResponse.json({ ok: false, error: errP.message }, { status: 500 });

  const agg = new Map<string, AggregateBucket>();
  const bump = (cid: string, amount: number, when: string) => {
    const b = agg.get(cid) ?? { spend: 0, visits: 0, lastVisit: null };
    b.spend  += amount;
    b.visits += 1;
    const iso = typeof when === "string" ? when : new Date(when).toISOString();
    if (!b.lastVisit || iso > b.lastVisit) b.lastVisit = iso;
    agg.set(cid, b);
  };

  for (const o of orders ?? []) {
    if (o.status === "cancelled") continue;
    if (!o.customer_id) continue;
    bump(o.customer_id, Number(o.total) || 0, o.date as string);
  }
  for (const s of posSales ?? []) {
    if (!s.customer_id) continue;
    bump(s.customer_id, Number(s.total) || 0, s.date as string);
  }

  const result = (customers ?? [])
    .filter((c) => c.id !== POS_WALK_IN_ID)
    .map((c) => mapRow(c, agg.get(c.id) ?? { spend: 0, visits: 0, lastVisit: null }));

  return NextResponse.json({ ok: true, customers: result });
}

// ── POST ────────────────────────────────────────────────────────────────────
// POS terminal creates a new customer. Required: name. Email/phone optional
// (walk-ins may give just a name + tag). Server generates the id so the
// client can't collide on existing rows.
export async function POST(req: NextRequest) {
  const gate = await requirePosSession();
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, PosCustomerCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const body = parsed.data;

  const id    = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = (body.email ?? "").trim().toLowerCase();
  // The customers table has a UNIQUE constraint on email so we must avoid
  // empty-string clashes between multiple no-email walk-ins. Generate a
  // synthetic per-row email when none was supplied; the POS UI hides it.
  const finalEmail = email || `pos-${id}@internal.local`;

  const row = {
    id,
    name:              body.name.trim(),
    email:             finalEmail,
    phone:             (body.phone ?? "").trim(),
    tags:              body.tags ?? [],
    favourites:        [] as string[],
    saved_addresses:   [],
    store_credit:      0,
    loyalty_points:    body.loyaltyPoints   ?? 0,
    gift_card_balance: body.giftCardBalance ?? 0,
    notes:             body.notes ?? "",
  };

  const { data, error } = await supabaseAdmin
    .from("customers")
    .insert(row)
    .select("id, name, email, phone, tags, favourites, saved_addresses, store_credit, created_at, email_verified, loyalty_points, gift_card_balance, notes")
    .single();

  if (error) {
    // 23505 = unique constraint violation (almost always email collision).
    if (error.code === "23505") {
      return NextResponse.json(
        { ok: false, error: "A customer with that email already exists." },
        { status: 409 },
      );
    }
    console.error("POST /api/pos/customers:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const customer = mapRow(data, { spend: 0, visits: 0, lastVisit: null });
  return NextResponse.json({ ok: true, customer });
}
