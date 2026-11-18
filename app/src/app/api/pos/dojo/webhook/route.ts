/**
 * POST /api/pos/dojo/webhook — receive Dojo webhook events.
 *
 * This is a SUPPLEMENTARY confirmation path — the POS already polls the terminal
 * session for the live result, so the webhook is used for audit + to reconcile a
 * sale's dojo_status out-of-band (e.g. a later Refunded/Reversed). It is NOT
 * behind a POS session — Dojo calls it — so it is authenticated by the
 * HMAC-SHA256 `Dojo-Signature` header instead (see lib/dojo/webhook.ts).
 *
 * Events are deduplicated via the dojo_events table (at-least-once delivery), and
 * we always return 2xx quickly so Dojo doesn't retry a successfully-received one.
 * Configure the endpoint URL + secret in the Dojo Developer Portal.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyDojoSignature } from "@/lib/dojo/webhook";
import { dojoConfig } from "@/lib/dojo";
import type { DojoWebhookEvent } from "@/lib/dojo/types";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("dojo-signature");
  const cfg = dojoConfig();

  // In live mode a secret must be configured and the signature must match.
  // (Mock mode emits no webhooks, so this route is effectively live-only.)
  if (cfg.webhookSecret) {
    if (!verifyDojoSignature(raw, signature)) {
      return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 400 });
    }
  } else {
    // No secret configured — refuse rather than trust an unverified caller.
    return NextResponse.json({ ok: false, error: "Webhooks not configured." }, { status: 503 });
  }

  let event: DojoWebhookEvent;
  try {
    event = JSON.parse(raw) as DojoWebhookEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed JSON." }, { status: 400 });
  }

  // Dedup (at-least-once). A duplicate id is a no-op success.
  if (event.id) {
    const { error: insErr } = await supabaseAdmin
      .from("dojo_events")
      .insert({ id: event.id, event_type: event.event ?? null, payload: event });
    if (insErr && insErr.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  // Reconcile the central dojo_payments record by payment intent id (e.g. a
  // later Refunded/Reversed status arriving out of band).
  const piId = event.data?.paymentIntentId;
  const status = event.data?.paymentStatus;
  if (piId && status) {
    const { error: updErr } = await supabaseAdmin
      .from("dojo_payments")
      .update({ status })
      .eq("payment_intent_id", piId);
    if (updErr) {
      // Un-mark the event and fail, so Dojo's retry applies it instead of
      // being skipped as a duplicate.
      console.error("[dojo/webhook] dojo_payments reconcile:", updErr.message);
      if (event.id) await supabaseAdmin.from("dojo_events").delete().eq("id", event.id);
      return NextResponse.json({ ok: false, error: "Couldn't record the event." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
