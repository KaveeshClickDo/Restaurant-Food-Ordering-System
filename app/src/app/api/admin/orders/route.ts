/**
 * GET /api/admin/orders — admin-gated orders list with optional date range.
 *
 * Replaces the direct `supabase.from("orders").select(...)` call that
 * OnlineReportsPanel used to make from the browser anon client.
 *
 * Query params:
 *   from/to    ISO-8601 date bounds (inclusive)
 *   limit      max rows (default 1000, capped 10000) — ignored when `page` is sent
 *   source     "dine-in" | "pos" (legacy) or "delivery" | "collection" | "walk-in",
 *              matching classify() in OrderHistoryPanel.tsx. Omitted → all orders.
 *   page/pageSize  paginates via `.range()`; also returns `totalCount`,
 *              `sourceCounts` (all 4 tabs) and `totalForFilter` (£ sum,
 *              excluding cancelled). Only OrderHistoryPanel sends this —
 *              other callers are unaffected.
 *   search     order id, note text (table label / receipt number), or
 *              customer name.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";

const POS_CUSTOMER_ID = "pos-walk-in";

type HistorySource = "delivery" | "collection" | "walk-in" | "dine-in";

// Mirrors classify() in OrderHistoryPanel.tsx exactly. Typed `any` — Supabase's
// filter-builder generics don't survive being threaded through a helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySource(q: any, source: HistorySource) {
  if (source === "dine-in") return q.eq("fulfillment", "dine-in");
  if (source === "walk-in")  return q.eq("customer_id", POS_CUSTOMER_ID);
  // delivery / collection both exclude the walk-in sentinel. A plain .neq()
  // would also drop orders whose customer_id is null (deleted-customer
  // orders, preserved for audit) — the .or() keeps those in.
  const withoutWalkIn = q.or(`customer_id.is.null,customer_id.neq.${POS_CUSTOMER_ID}`);
  return source === "delivery"
    ? withoutWalkIn.eq("fulfillment", "delivery")
    : withoutWalkIn.eq("fulfillment", "collection");
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const from     = searchParams.get("from");
  const to       = searchParams.get("to");
  const source   = searchParams.get("source");
  const limit    = Math.min(Number(searchParams.get("limit") ?? 1000), 10000);
  const pageRaw  = searchParams.get("page");
  const search   = searchParams.get("search")?.trim();

  // Resolve a name search into matching customer ids up front — doing it
  // this way (rather than filtering the embedded `customer` relation) keeps
  // every filter below a plain base-table condition, which PostgREST ORs
  // reliably.
  let matchingCustomerIds: string[] | null = null;
  if (search) {
    const esc = search.replace(/[%,]/g, "");
    const { data: matches } = await supabaseAdmin
      .from("customers")
      .select("id")
      .ilike("name", `%${esc}%`);
    matchingCustomerIds = (matches ?? []).map((c) => c.id as string);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applySearch(q: any) {
    if (!search) return q;
    const esc = search.replace(/[%,]/g, "");
    // note.ilike catches table labels ("Table T1") and receipt numbers
    // ("Receipt: R1002") — both are plain substrings of the note text, no
    // need to replicate the regex that parses them out for display.
    const clauses = [`id.ilike.%${esc}%`, `note.ilike.%${esc}%`];
    if (matchingCustomerIds && matchingCustomerIds.length > 0) {
      clauses.push(`customer_id.in.(${matchingCustomerIds.join(",")})`);
    }
    return q.or(clauses.join(","));
  }

  if (pageRaw) {
    // Paginated mode — only OrderHistoryPanel uses this.
    const page     = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 20));
    const rangeFrom = (page - 1) * pageSize;
    const rangeTo   = rangeFrom + pageSize - 1;

    if (!source || !["delivery", "collection", "walk-in", "dine-in"].includes(source)) {
      return NextResponse.json({ ok: false, error: "source is required when paginating." }, { status: 400 });
    }

    let q = supabaseAdmin
      .from("orders")
      .select("*, customer:customers(id, name, email, phone)", { count: "exact" })
      .order("date", { ascending: false })
      .range(rangeFrom, rangeTo);
    q = applySource(q, source as HistorySource);
    q = applySearch(q);
    if (from) q = q.gte("date", from);
    if (to)   q = q.lte("date", to);

    const { data, error, count } = await q;
    if (error) {
      console.error("admin/orders GET (paginated):", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // sourceCounts — all 4 tabs, same from/to + search, independent of which
    // one was requested (so every tab badge stays accurate while only one
    // tab's rows are actually loaded).
    const sources: HistorySource[] = ["delivery", "collection", "walk-in", "dine-in"];
    const sourceCounts = await Promise.all(sources.map(async (s) => {
      let cq = supabaseAdmin.from("orders").select("id", { count: "exact", head: true });
      cq = applySource(cq, s);
      cq = applySearch(cq);
      if (from) cq = cq.gte("date", from);
      if (to)   cq = cq.lte("date", to);
      const { count: c, error: cErr } = await cq;
      if (cErr) console.error(`admin/orders sourceCounts (${s}):`, cErr.message);
      return [s, c ?? 0] as const;
    }));

    // totalForFilter — £ sum for the requested tab, excluding cancelled,
    // same as OrderHistoryPanel's own tabTotal calc. Narrow projection (2
    // columns) so this stays cheap even over "All time".
    let sumQ = supabaseAdmin.from("orders").select("total, status");
    sumQ = applySource(sumQ, source as HistorySource);
    sumQ = applySearch(sumQ);
    if (from) sumQ = sumQ.gte("date", from);
    if (to)   sumQ = sumQ.lte("date", to);
    const { data: sumRows, error: sumErr } = await sumQ;
    if (sumErr) console.error("admin/orders totalForFilter:", sumErr.message);
    const totalForFilter = (sumRows ?? [])
      .filter((r) => r.status !== "cancelled")
      .reduce((s, r) => s + (Number(r.total) || 0), 0);

    return NextResponse.json({
      ok: true,
      orders: data ?? [],
      totalCount: count ?? 0,
      page,
      pageSize,
      sourceCounts: Object.fromEntries(sourceCounts),
      totalForFilter: parseFloat(totalForFilter.toFixed(2)),
    });
  }

  // Unpaginated (existing) behaviour — OnlineReportsPanel / OrderMonitorPanel.
  let q = supabaseAdmin
    .from("orders")
    .select("*, customer:customers(id, name, email, phone)")
    .order("date", { ascending: false })
    .limit(limit);

  if (source === "dine-in") {
    q = q.eq("fulfillment", "dine-in");
  } else if (source === "pos") {
    q = q.eq("customer_id", POS_CUSTOMER_ID).eq("fulfillment", "collection");
  }

  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

  const { data, error } = await q;
  if (error) {
    console.error("admin/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, orders: data ?? [] });
}
