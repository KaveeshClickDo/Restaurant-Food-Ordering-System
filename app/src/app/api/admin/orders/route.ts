/**
 * GET /api/admin/orders — admin-gated orders list with optional date range.
 *
 * Replaces the direct `supabase.from("orders").select(...)` call that
 * OnlineReportsPanel used to make from the browser anon client.
 *
 * Query params:
 *   from/to    ISO-8601 date bounds (inclusive)
 *   source     "dine-in" | "pos" (legacy) or "delivery" | "collection" | "walk-in",
 *              matching classify() in OrderHistoryPanel.tsx. Omitted → all orders.
 *   page/pageSize  paginates via `.range()`; also returns `totalCount`,
 *              `sourceCounts` (all 4 tabs) and `totalForFilter` (£ sum,
 *              excluding cancelled). Only OrderHistoryPanel sends this —
 *              other callers are unaffected.
 *   view       "active" | "completed-today" | "voided-today" — an extra
 *              status filter on top of source/from/to/search, for
 *              OrderMonitorPanel's three live sections. Works in both modes:
 *              "active" is sent unpaginated (deliberately — see below);
 *              "completed-today"/"voided-today" are sent paginated. Omitted →
 *              OrderHistoryPanel's existing all-statuses behavior. In
 *              paginated mode, sourceCounts (the 4 tab badges) is skipped
 *              when `view` is set, since OrderMonitorPanel doesn't use it and
 *              this route is polled every 8s.
 *   search     order id, note text (table label / receipt number), or
 *              customer name.
 *
 * The unpaginated mode (no `page` sent) has no row cap — returns every order
 * matching from/to/source/view, so a long/all-time report range (or a busy
 * "active orders" board) can't silently drop older orders.
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

  const view = searchParams.get("view") as "active" | "completed-today" | "voided-today" | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyView(q: any) {
    if (view === "active") return q.in("status", ["pending", "confirmed", "preparing", "ready"]);
    if (view === "completed-today") {
      // NULL-safe "not refunded": a plain .not("payment_status", "in", (...))
      // would evaluate to NULL (excluded by WHERE) for every row where
      // payment_status is null, wrongly dropping un-refunded orders.
      return q.eq("status", "delivered")
        .or("payment_status.is.null,payment_status.not.in.(refunded,partially_refunded)");
    }
    if (view === "voided-today") {
      return q.or("status.eq.cancelled,payment_status.in.(refunded,partially_refunded)");
    }
    return q;
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
    q = applyView(q);
    if (from) q = q.gte("date", from);
    if (to)   q = q.lte("date", to);

    // sourceCounts — all 4 tabs, same from/to + search, independent of which
    // one was requested (so every tab badge stays accurate while only one
    // tab's rows are actually loaded). Skipped when `view` is set — those tab
    // badges are OrderHistoryPanel-only UI; OrderMonitorPanel polls this route
    // every 8s and doesn't read sourceCounts, so running 4 extra count queries
    // on every poll would be pure waste.
    const sources: HistorySource[] = ["delivery", "collection", "walk-in", "dine-in"];
    const sourceCountQueries = view ? [] : sources.map((s) => {
      let cq = supabaseAdmin.from("orders").select("id", { count: "exact", head: true });
      cq = applySource(cq, s);
      cq = applySearch(cq);
      if (from) cq = cq.gte("date", from);
      if (to)   cq = cq.lte("date", to);
      return cq;
    });

    // totalForFilter — £ sum for the requested tab/view, excluding cancelled,
    // same as OrderHistoryPanel's own tabTotal calc. Narrow projection (2
    // columns) so this stays cheap even over "All time". OrderMonitorPanel
    // reads this for "Earned today" on the completed-today view.
    let sumQ = supabaseAdmin.from("orders").select("total, status");
    sumQ = applySource(sumQ, source as HistorySource);
    sumQ = applySearch(sumQ);
    sumQ = applyView(sumQ);
    if (from) sumQ = sumQ.gte("date", from);
    if (to)   sumQ = sumQ.lte("date", to);

    // None of these four queries depend on each other's results, so run them
    // all concurrently instead of one after another.
    const [mainResult, sourceCountResults, sumResult] = await Promise.all([
      q,
      Promise.all(sourceCountQueries),
      sumQ,
    ]);

    const { data, error, count } = mainResult;
    if (error) {
      console.error("admin/orders GET (paginated):", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const sourceCounts = sources.map((s, i) => {
      const result = sourceCountResults[i];
      if (!result) return [s, 0] as const;
      const { count: c, error: cErr } = result;
      if (cErr) console.error(`admin/orders sourceCounts (${s}):`, cErr.message);
      return [s, c ?? 0] as const;
    });

    const { data: sumRows, error: sumErr } = sumResult;
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

  // Unpaginated (existing) behaviour — OnlineReportsPanel, and
  // OrderMonitorPanel's "active" view (deliberately not paginated — it's a
  // live "what's in progress right now" board, not a browsable archive, so
  // there's no benefit to paging it and a real cost to doing so: an order
  // could sit just past the page boundary and never catch a cashier's eye).
  let q = supabaseAdmin
    .from("orders")
    .select("*, customer:customers(id, name, email, phone)", { count: "exact" })
    .order("date", { ascending: false });

  if (source === "dine-in") {
    q = q.eq("fulfillment", "dine-in");
  } else if (source === "pos") {
    q = q.eq("customer_id", POS_CUSTOMER_ID).eq("fulfillment", "collection");
  }
  q = applyView(q);

  if (from) q = q.gte("date", from);
  if (to)   q = q.lte("date", to);

  const { data, error, count } = await q;
  if (error) {
    console.error("admin/orders GET:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  // `count` is a DB-side exact count of the full matching set (same
  // mechanism the paginated mode uses) — not derived from data.length, which
  // would be redundant here anyway since this mode is already unpaginated,
  // but keeps the field consistent for callers (OrderMonitorPanel's "Active
  // now" stat) that want a count without re-deriving it from the array.
  return NextResponse.json({ ok: true, orders: data ?? [], totalCount: count ?? (data ?? []).length });
}
