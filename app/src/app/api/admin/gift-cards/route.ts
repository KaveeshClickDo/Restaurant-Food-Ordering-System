/**
 * GET  /api/admin/gift-cards  — list gift cards (filters: status, search, date).
 * POST /api/admin/gift-cards  — sell a card at the counter (cash/card). The sale
 *                               is booked as income on the Admin finance tab.
 *
 * Admin authentication required.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/adminAuth";
import { parseBody } from "@/lib/apiValidation";
import { AdminGiftCardCreateSchema } from "@/lib/schemas/giftCard";
import { generateGiftCardCode } from "@/lib/giftCardCode";
import { sendGiftCardDeliveredEmail } from "@/lib/emailServer";
import { upsertMarketingContact } from "@/lib/marketingContacts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToGiftCard(row: any) {
  return {
    id:                 row.id,
    code:               row.code,
    initialAmount:      Number(row.initial_amount),
    balance:            Number(row.balance),
    status:             row.status,
    issuedToEmail:      row.issued_to_email ?? undefined,
    issuedToName:       row.issued_to_name ?? undefined,
    issuedByCustomerId: row.issued_by_customer_id ?? undefined,
    personalMessage:    row.personal_message ?? undefined,
    expiresAt:          row.expires_at ?? undefined,
    deliveredAt:        row.delivered_at ?? undefined,
    activatedAt:        row.activated_at ?? undefined,
    createdAt:          row.created_at,
  };
}

const GIFT_CARD_EXPIRY_MONTHS = 12;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");   // active | redeemed | voided | expired
  const search = searchParams.get("search")?.trim().toLowerCase();

  let q = supabaseAdmin
    .from("gift_cards")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (status && ["inactive", "active", "redeemed", "voided", "expired"].includes(status)) {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  let rows = data ?? [];
  // Search is applied in TS (small dataset, ≤500 rows) so we can match across
  // code OR recipient email without a complex OR query.
  if (search) {
    rows = rows.filter((r) =>
      r.code?.toLowerCase().includes(search) ||
      r.issued_to_email?.toLowerCase().includes(search) ||
      r.issued_to_name?.toLowerCase().includes(search),
    );
  }

  // Aggregate stats for the panel header.
  const totalOutstanding = rows
    .filter((r) => r.status === "active")
    .reduce((s, r) => s + Number(r.balance), 0);

  return NextResponse.json({
    ok: true,
    giftCards: rows.map(rowToGiftCard),
    stats: {
      total:           rows.length,
      activeCount:     rows.filter((r) => r.status === "active").length,
      inactiveCount:   rows.filter((r) => r.status === "inactive").length,
      totalOutstanding: parseFloat(totalOutstanding.toFixed(2)),
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();

  const parsed = await parseBody(req, AdminGiftCardCreateSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { amount, paymentMethod, recipientEmail, recipientName, personalMessage, notes, sendEmail } = parsed.data;

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + GIFT_CARD_EXPIRY_MONTHS);

  const code = generateGiftCardCode();
  const id   = crypto.randomUUID();

  const { error: insertErr } = await supabaseAdmin
    .from("gift_cards")
    .insert({
      id,
      code,
      initial_amount:    amount,
      balance:           amount,
      status:            "active",
      issued_to_email:   recipientEmail ?? null,
      issued_to_name:    recipientName ?? null,
      personal_message:  personalMessage ?? null,
      expires_at:        expiresAt.toISOString(),
      // Sold by admin (cash/card) — booked as income on the Admin finance tab.
      // No stripe_payment_intent_id (that's only set for online gateway sales).
      payment_method:    paymentMethod,
      payment_ref:       `admin:${paymentMethod}`,
    });

  if (insertErr) {
    if (insertErr.code === "23505") {
      // Code collision (1-in-10^17). Caller can simply retry.
      return NextResponse.json({ ok: false, error: "Code collision — please retry." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  // Audit row.
  await supabaseAdmin.from("gift_card_transactions").insert({
    id:            crypto.randomUUID(),
    gift_card_id:  id,
    type:          "issue",
    amount:        amount,
    balance_after: amount,
    performed_by:  "admin",
    notes:         notes ?? "Manually issued by admin",
  });

  // Marketing contact — counter-sale recipient email enters the system here.
  if (recipientEmail) {
    await upsertMarketingContact({
      email:  recipientEmail,
      source: "gift_card",
      name:   recipientName,
    });
  }

  // Optional delivery email.
  if (sendEmail && recipientEmail) {
    sendGiftCardDeliveredEmail({
      code,
      amount,
      recipientEmail,
      recipientName:   recipientName ?? "there",
      senderName:      undefined,
      personalMessage: personalMessage ?? undefined,
      expiresAt:       expiresAt.toISOString(),
    }).then((result) => {
      if (result.ok) {
        supabaseAdmin.from("gift_cards").update({ delivered_at: new Date().toISOString() }).eq("id", id)
          .then(({ error }) => { if (error) console.error("[admin/gift-cards] delivered_at:", error.message); });
      }
    }).catch((err) => console.error("[admin/gift-cards] email:", err instanceof Error ? err.message : err));
  }

  return NextResponse.json({ ok: true, id, code }, { status: 201 });
}
