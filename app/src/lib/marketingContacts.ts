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
  | "ebill";        // typed into the POS / waiter "email bill" box

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
