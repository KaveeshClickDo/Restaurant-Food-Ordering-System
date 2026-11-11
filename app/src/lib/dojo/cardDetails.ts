/**
 * The card a record was paid with on the card machine, for receipts. Read from
 * dojo_payments, the one record of card machine payments, so the sale rows
 * themselves carry no card fields. SERVER-SIDE ONLY.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { DojoSource } from "./recordPayment";
import type { POSSale, POSCardPayment } from "@/types/pos";

/** Ids per query: a sales list can hold thousands, and the ids go in the URL. */
const CHUNK = 100;

/** The card machine payment for each of these records of one kind, by record id. */
export async function cardDetailsFor(sourceType: DojoSource, ids: string[]): Promise<Map<string, POSCardPayment>> {
  const found = new Map<string, POSCardPayment>();
  const unique = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));
  await Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await supabaseAdmin
      .from("dojo_payments")
      .select("source_id, card_scheme, card_last4, auth_code")
      .eq("source_type", sourceType)
      .in("source_id", chunk);
    if (error) { console.error("[dojo] cardDetailsFor:", error.message); return; }
    for (const r of data ?? []) {
      if (r.source_id) found.set(r.source_id, { scheme: r.card_scheme ?? null, last4: r.card_last4 ?? null, authCode: r.auth_code ?? null });
    }
  }));
  return found;
}

/** Adds the card machine card to each card or split sale that has one. */
export async function attachCardDetails(sales: POSSale[]): Promise<POSSale[]> {
  const paidByCard = sales.filter((s) => s.paymentMethod === "card" || s.paymentMethod === "split");
  if (paidByCard.length === 0) return sales;
  const cards = await cardDetailsFor("pos_sale", paidByCard.map((s) => String(s.id)));
  for (const s of paidByCard) {
    const card = cards.get(String(s.id));
    if (card) s.cardPayment = card;
  }
  return sales;
}
