/**
 * Marketing contacts — the single write path into `marketing_contacts`.
 *
 * Every flow where a customer hands over an email address funnels through
 * {@link upsertMarketingContact}: reservation create/check-in/check-out,
 * online checkout (guest AND signed-in), account sign-up, gift cards, POS
 * customer creation, and e-bill receipt sends. One code path means one set of
 * merge rules, so the same email arriving from two different surfaces enriches
 * a single contact instead of duplicating it.
 *
 * Merge rules (email = unique key, lowercased):
 *   • sources        — appended, never removed ('gift_card' + 'online_order' both stick)
 *   • name / phone   — only overwritten by a NON-EMPTY value (a gift-card flow
 *                      with no phone never wipes the phone an order captured)
 *   • customer_id    — linked when the caller knows it (signed-in flows)
 *   • order          — increments order_count / total_spend / last_order_at
 *   • visit          — increments visit_count / last_visit_at (reservation check-out)
 *   • marketing_opt_in — NEVER touched here; the DB default (true) applies on
 *                      insert and only the admin toggle / unsubscribe page
 *                      changes it afterwards.
 *
 * Best-effort by contract: never throws, errors go to console only. CRM
 * bookkeeping must never fail an order, a booking, or a receipt send.
 * Server-only — imports supabaseAdmin.
 */

import { supabaseAdmin } from "./supabaseAdmin";

/** Where a contact's email entered the system. A contact accumulates several. */
export type ContactSource =
  | "reservation"   // table booking (online / phone / walk-in / POS / admin)
  | "online_order"  // online checkout — guest or signed-in
  | "account"       // registered account (password or Google)
  | "gift_card"     // gift card recipient or buyer
  | "pos"           // customer created at the POS till
  | "ebill"         // typed into the POS / waiter "email bill" box
  | "import";       // uploaded from a CSV (Admin → Marketing → Audience → Import)

export interface UpsertMarketingContactArgs {
  email: string;
  source: ContactSource;
  name?: string;
  phone?: string;
  /** customers.id when the flow knows the registered account. */
  customerId?: string;
  /** Record one online order: bumps order_count, adds total to total_spend. */
  order?: { total: number };
  /** Record one completed restaurant visit (reservation check-out). */
  visit?: boolean;
  /**
   * The capture form's marketing checkbox (PECR: opt-out offered at collection).
   *   • false     → new contact is created UNSUBSCRIBED; an existing contact is
   *                 unsubscribed immediately (an opt-out always wins).
   *   • true      → new contact opts in (the DB default anyway); an existing
   *                 contact is NOT changed — a pre-ticked box must never
   *                 silently re-subscribe someone who unsubscribed before.
   *                 Re-subscribing is explicit only (/account, POS, admin).
   *   • undefined → flow has no checkbox; never touches opt-in (old behaviour).
   */
  consent?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Synthetic addresses must never enter the marketing list: POS no-email
 *  walk-ins get `pos-<id>@internal.local`, and the walk-in sentinel account
 *  uses a non-routable internal address. */
export function isMarketableEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  return EMAIL_RE.test(e) && !e.endsWith("@internal.local");
}

export async function upsertMarketingContact(args: UpsertMarketingContactArgs): Promise<void> {
  try {
    const email = args.email?.trim().toLowerCase() ?? "";
    if (!isMarketableEmail(email)) return;

    const name  = args.name?.trim()  ?? "";
    const phone = args.phone?.trim() ?? "";
    const spend = args.order && args.order.total > 0 ? args.order.total : 0;
    const now   = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("marketing_contacts")
      .select("id, name, phone, sources, customer_id, order_count, total_spend, visit_count, first_visit_at")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const sources = (existing.sources as string[] | null) ?? [];
      const patch: Record<string, unknown> = { updated_at: now };

      if (!sources.includes(args.source))            patch.sources        = [...sources, args.source];
      if (name)                                      patch.name           = name;
      if (phone)                                     patch.phone          = phone;
      if (args.customerId && existing.customer_id !== args.customerId)
                                                     patch.customer_id    = args.customerId;
      if (!existing.first_visit_at)                  patch.first_visit_at = now;
      // Opt-out expressed on this form wins immediately. (consent=true is
      // deliberately ignored for existing contacts — see the field's JSDoc.)
      if (args.consent === false) {
        patch.marketing_opt_in = false;
        patch.unsubscribed_at  = now;
      }
      if (args.order) {
        patch.order_count   = ((existing.order_count as number) ?? 0) + 1;
        patch.total_spend   = parseFloat((((existing.total_spend as number) ?? 0) + spend).toFixed(2));
        patch.last_order_at = now;
      }
      if (args.visit) {
        patch.visit_count   = ((existing.visit_count as number) ?? 0) + 1;
        patch.last_visit_at = now;
      }

      const { error } = await supabaseAdmin
        .from("marketing_contacts")
        .update(patch)
        .eq("email", email);
      if (error) console.error("marketingContacts update:", error.message);
      return;
    }

    // marketing_opt_in / unsubscribe_token omitted → DB defaults (opted in) —
    // unless the capture form's checkbox was UNTICKED, in which case the
    // contact starts life unsubscribed.
    const { error } = await supabaseAdmin
      .from("marketing_contacts")
      .insert({
        email,
        name,
        phone,
        ...(args.consent === false
          ? { marketing_opt_in: false, unsubscribed_at: now }
          : {}),
        sources:        [args.source],
        customer_id:    args.customerId ?? null,
        visit_count:    args.visit ? 1 : 0,
        order_count:    args.order ? 1 : 0,
        total_spend:    spend,
        first_visit_at: now,
        last_order_at:  args.order ? now : null,
        last_visit_at:  args.visit ? now : null,
        tags:           [],
        notes:          "",
        created_at:     now,
        updated_at:     now,
      });
    // 23505 = another request inserted the same email between our read and
    // write. The contact exists either way — the lost enrichment is acceptable
    // for best-effort CRM bookkeeping.
    if (error && error.code !== "23505") {
      console.error("marketingContacts insert:", error.message);
    }
  } catch (err) {
    console.error("marketingContacts upsert:", err instanceof Error ? err.message : err);
  }
}

/** Read a contact's current opt-in state by email. null = no contact row yet. */
export async function getMarketingOptInByEmail(email: string): Promise<boolean | null> {
  const e = email.trim().toLowerCase();
  if (!isMarketableEmail(e)) return null;
  const { data } = await supabaseAdmin
    .from("marketing_contacts")
    .select("marketing_opt_in")
    .eq("email", e)
    .maybeSingle();
  if (!data) return null;
  return data.marketing_opt_in === true;
}

/**
 * EXPLICIT opt-in/opt-out by email — the re-subscribe toggles (/account, POS
 * customers tab). Unlike the capture-form `consent`, optIn=true here DOES
 * re-subscribe: the person (or staff on their behalf) deliberately flipped a
 * switch. Creates the contact row if missing. Returns false on failure.
 */
export async function setMarketingOptInByEmail(args: {
  email: string;
  optIn: boolean;
  source: ContactSource;
  name?: string;
  customerId?: string;
}): Promise<boolean> {
  try {
    const email = args.email.trim().toLowerCase();
    if (!isMarketableEmail(email)) return false;
    const now = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("marketing_contacts")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!existing) {
      await upsertMarketingContact({
        email,
        source:     args.source,
        name:       args.name,
        customerId: args.customerId,
        consent:    args.optIn,
      });
      return true;
    }

    const { error } = await supabaseAdmin
      .from("marketing_contacts")
      .update({
        marketing_opt_in: args.optIn,
        unsubscribed_at:  args.optIn ? null : now,
        updated_at:       now,
      })
      .eq("email", email);
    if (error) { console.error("setMarketingOptInByEmail:", error.message); return false; }
    return true;
  } catch (err) {
    console.error("setMarketingOptInByEmail:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ─── CSV import ───────────────────────────────────────────────────────────────

/** One already-parsed, already-column-mapped CSV row. The browser does the
 *  parsing and mapping (that's where the UI lives); the server only ever sees
 *  this normalised shape. */
export interface ImportContactRow {
  email: string;
  name?: string;
  phone?: string;
  /** Tags from a per-row Tags column, unioned with the import-wide tag(s). */
  tags?: string[];
  /**
   * From an "Opted in" column when the file has one (our own CSV export has
   * it, so an export → edit → re-import round-trip keeps opt-outs out).
   *   • false     → contact is created / marked UNSUBSCRIBED.
   *   • true      → new contact opts in; an existing opt-out is NOT revived.
   *   • undefined → no column; same as true for new rows, no-op for existing.
   */
  optIn?: boolean;
}

export interface ImportContactsResult {
  /** Emails that weren't in the list before. */
  created: number;
  /** Emails already on the list — tag added, blanks filled, history kept. */
  updated: number;
  /** Rows with a missing / malformed / @internal.local email. */
  invalid: number;
  /** Rows repeating an email that appeared earlier in the same upload. */
  duplicates: number;
  /** Rows the database refused — surfaced so no row fails silently. */
  failed: number;
  /** First few rejected values, for the "what we skipped" list in the UI. */
  invalidSamples: string[];
}

/** Rows per DB round-trip. Postgres `email IN (...)` and the upsert payload
 *  both stay comfortably small at this size. */
const IMPORT_CHUNK = 200;

/**
 * Bulk-add contacts from an uploaded CSV — the import counterpart to
 * {@link upsertMarketingContact}, kept in this module so the merge rules live
 * in one file. Same rules as the single-row path, applied set-at-a-time:
 *
 *   • sources        — 'import' appended, existing sources kept
 *   • tags           — unioned (the upload's tag never replaces existing tags)
 *   • name / phone   — only a NON-EMPTY value from the file overwrites
 *   • marketing_opt_in — an opt-out in the file wins immediately; an existing
 *                      opt-out is NEVER revived by an import
 *   • counters (visits / orders / spend) — untouched: an import is not a visit
 *
 * Unlike the single-row helper this one DOES throw (the admin is watching a
 * progress bar and needs to know it failed). Bad rows never throw — they come
 * back counted in the result.
 *
 * Read-then-upsert: a contact edited by another request in the millisecond
 * between the two loses that edit for the columns above — the same trade-off
 * upsertMarketingContact already documents.
 */
export async function importMarketingContacts(args: {
  rows: ImportContactRow[];
  /** Tag(s) applied to every contact in the upload (Kit-style import tag). */
  tags: string[];
}): Promise<ImportContactsResult> {
  const result: ImportContactsResult = {
    created: 0, updated: 0, invalid: 0, duplicates: 0, failed: 0, invalidSamples: [],
  };
  const importTags = [...new Set(args.tags.map((t) => t.trim()).filter(Boolean))];
  const now = new Date().toISOString();

  // ── 1. Normalise + collapse duplicates inside the upload itself ───────────
  const byEmail = new Map<string, Required<Pick<ImportContactRow, "email" | "name" | "phone" | "tags">> & { optIn?: boolean }>();
  for (const raw of args.rows) {
    const email = raw.email?.trim().toLowerCase() ?? "";
    if (!isMarketableEmail(email)) {
      result.invalid++;
      if (result.invalidSamples.length < 10) {
        result.invalidSamples.push(raw.email?.trim() || "(blank)");
      }
      continue;
    }
    const rowTags = (raw.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const seen = byEmail.get(email);
    if (!seen) {
      byEmail.set(email, {
        email,
        name:  raw.name?.trim()  ?? "",
        phone: raw.phone?.trim() ?? "",
        tags:  rowTags,
        optIn: raw.optIn,
      });
      continue;
    }
    // Same address twice in one file: keep the first row, let later rows fill
    // blanks and add tags, and let any opt-out in the file win.
    result.duplicates++;
    if (!seen.name  && raw.name?.trim())  seen.name  = raw.name.trim();
    if (!seen.phone && raw.phone?.trim()) seen.phone = raw.phone.trim();
    if (rowTags.length) seen.tags = [...new Set([...seen.tags, ...rowTags])];
    if (raw.optIn === false) seen.optIn = false;
  }
  if (byEmail.size === 0) return result;

  const emails = [...byEmail.keys()];

  // ── 2. Read the contacts that already exist, so the merge is additive ─────
  interface Existing { name: string; phone: string; sources: string[]; tags: string[]; optIn: boolean; unsubscribedAt: string | null }
  const existing = new Map<string, Existing>();
  for (let i = 0; i < emails.length; i += IMPORT_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from("marketing_contacts")
      .select("email, name, phone, sources, tags, marketing_opt_in, unsubscribed_at")
      .in("email", emails.slice(i, i + IMPORT_CHUNK));
    if (error) {
      console.error("importMarketingContacts read:", error.message);
      throw new Error(error.message);
    }
    for (const row of data ?? []) {
      existing.set(row.email as string, {
        name:           (row.name  as string) ?? "",
        phone:          (row.phone as string) ?? "",
        sources:        (row.sources as string[] | null) ?? [],
        tags:           (row.tags    as string[] | null) ?? [],
        optIn:          row.marketing_opt_in === true,
        unsubscribedAt: (row.unsubscribed_at as string | null) ?? null,
      });
    }
  }

  // ── 3. Build one uniform upsert payload (PostgREST needs matching keys) ───
  // Every row carries its FINAL merged values, so `on conflict do update`
  // writes exactly what we computed above and nothing else. Columns left out
  // (visit_count, order_count, total_spend, first/last_visit_at, created_at,
  // unsubscribe_token, id) keep their value on update and take DB defaults on
  // insert — which is why an import can never dent a contact's history.
  const planned = emails.map((email) => {
    const row = byEmail.get(email)!;
    const cur = existing.get(email);
    const tags = [...new Set([...(cur?.tags ?? []), ...row.tags, ...importTags])];
    const optOut = row.optIn === false;
    return {
      isNew: !cur,
      values: {
        email,
        name:    row.name  || cur?.name  || "",
        phone:   row.phone || cur?.phone || "",
        sources: cur
          ? (cur.sources.includes("import") ? cur.sources : [...cur.sources, "import"])
          : ["import"],
        tags,
        // New rows opt in (the admin confirmed the list has consent) unless the
        // file says otherwise. Existing rows keep their state — only an
        // opt-out in the file may change it.
        marketing_opt_in: optOut ? false : (cur ? cur.optIn : true),
        unsubscribed_at:  optOut ? now   : (cur ? cur.unsubscribedAt : null),
        updated_at:       now,
      },
    };
  });

  // ── 4. Write, chunk by chunk ─────────────────────────────────────────────
  for (let i = 0; i < planned.length; i += IMPORT_CHUNK) {
    const chunk = planned.slice(i, i + IMPORT_CHUNK);
    const { error } = await supabaseAdmin
      .from("marketing_contacts")
      .upsert(chunk.map((p) => p.values), { onConflict: "email" });
    if (error) {
      console.error("importMarketingContacts upsert:", error.message);
      result.failed += chunk.length;
      continue;
    }
    for (const p of chunk) {
      if (p.isNew) result.created++; else result.updated++;
    }
  }

  return result;
}

/**
 * Capture a SIGNED-IN customer's online order into the marketing contacts
 * list. Resolves email/name/phone from the customers table (the orders row
 * doesn't carry them). Guest orders are captured via /api/guest-profile
 * instead — their name/phone only exist in the checkout form — so calling
 * this for every order never double-counts. Best-effort: never throws.
 */
export async function captureCustomerOrderContact(
  customerId: string | null | undefined,
  orderTotal: number,
): Promise<void> {
  try {
    if (!customerId || customerId === "guest" || customerId === "pos-walk-in") return;
    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("id, name, email, phone")
      .eq("id", customerId)
      .maybeSingle();
    if (!cust?.email) return;
    await upsertMarketingContact({
      email:      cust.email as string,
      source:     "online_order",
      name:       (cust.name  as string) ?? "",
      phone:      (cust.phone as string) ?? "",
      customerId: cust.id as string,
      order:      { total: orderTotal > 0 ? orderTotal : 0 },
    });
  } catch (err) {
    console.error("marketingContacts order capture:", err instanceof Error ? err.message : err);
  }
}
