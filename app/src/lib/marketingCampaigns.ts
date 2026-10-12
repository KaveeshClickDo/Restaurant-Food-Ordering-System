/**
 * Marketing campaign email builder — shared by the batch sender
 * (/api/admin/campaigns/[id]/send) and the test-send route so a test email
 * is byte-identical to the real thing.
 *
 * Personalisation: {{name}} and {{email}} tokens in subject + body, resolved
 * per recipient via the same applyVars used by the transactional templates.
 *
 * Compliance is baked in, not optional:
 *   • an unsubscribe footer link (/unsubscribe?token=…) is ALWAYS appended
 *   • the RFC 8058 one-click pair (List-Unsubscribe + List-Unsubscribe-Post)
 *     is set on every campaign send — Gmail/Yahoo render their native
 *     "Unsubscribe" button from these and require them for bulk senders
 *
 * Server-only.
 */

import type { AdminSettings, ContactSource } from "@/types";
import { applyVars, buildEmailDocument } from "./emailTemplates";
import { supabaseAdmin } from "./supabaseAdmin";
import { isMarketableEmail } from "./marketingContacts";
import { sendEmail } from "./emailSender";

export interface CampaignEmail {
  subject: string;
  html: string;
  headers: Record<string, string>;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export async function fetchAdminSettings(): Promise<AdminSettings | undefined> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("data").eq("id", 1).maybeSingle();
  return data?.data as AdminSettings | undefined;
}

// ── Audience ────────────────────────────────────────────────────────────────
// A campaign stores an audience descriptor and resolves it to concrete
// contacts at SEND time, so a draft made days earlier picks up whoever matches
// then (and never anyone who has since unsubscribed).

export type Audience =
  | { mode: "all" }
  | { mode: "sources"; sources: ContactSource[] }
  | { mode: "tags"; tags: string[] }
  | { mode: "selection"; ids: string[] };

export interface AudienceContact { id: string; email: string; name: string }

/** Resolve an audience to mailable contacts: opted-in, not unsubscribed, real
 *  email. This is the authoritative suppression gate for every send path. */
export async function resolveAudience(audience: Audience): Promise<AudienceContact[]> {
  let query = supabaseAdmin
    .from("marketing_contacts")
    .select("id, email, name, tags, sources, marketing_opt_in, unsubscribed_at");

  // Push the cheap equality filters to the DB; array-overlap + email shape are
  // applied in TS below (small table, and keeps the query portable).
  query = query.eq("marketing_opt_in", true).is("unsubscribed_at", null);

  if (audience.mode === "selection") {
    if (audience.ids.length === 0) return [];
    query = query.in("id", audience.ids);
  }

  const { data, error } = await query;
  if (error) {
    console.error("resolveAudience:", error.message);
    return [];
  }

  const rows = (data ?? []).filter((c) => isMarketableEmail(c.email as string));

  const matched = rows.filter((c) => {
    if (audience.mode === "all" || audience.mode === "selection") return true;
    if (audience.mode === "sources") {
      const src = (c.sources as string[] | null) ?? [];
      return audience.sources.some((s) => src.includes(s));
    }
    if (audience.mode === "tags") {
      const tags = (c.tags as string[] | null) ?? [];
      return audience.tags.some((t) => tags.includes(t));
    }
    return false;
  });

  return matched.map((c) => ({ id: c.id as string, email: c.email as string, name: (c.name as string) ?? "" }));
}

/** Human-readable one-liner for a stored audience (history + confirmations). */
export function describeAudience(audience: Audience | Record<string, unknown> | null | undefined): string {
  const a = audience as Audience | undefined;
  if (!a || !a.mode) return "All opted-in contacts";
  switch (a.mode) {
    case "all":       return "All opted-in contacts";
    case "sources":   return `Sources: ${a.sources.join(", ")}`;
    case "tags":      return `Tags: ${a.tags.join(", ")}`;
    case "selection": return `${a.ids.length} hand-picked contact${a.ids.length === 1 ? "" : "s"}`;
    default:          return "All opted-in contacts";
  }
}

/**
 * Render one campaign email for one recipient.
 * `unsubscribeToken` is the contact's marketing_contacts.unsubscribe_token;
 * the test route passes the literal "preview" (the public page fails politely).
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildCampaignEmail(args: {
  subjectTemplate: string;
  bodyTemplate: string;
  previewText?: string;
  recipientName: string;
  recipientEmail: string;
  unsubscribeToken: string;
  settings: AdminSettings;
  /** Recipient row id — embeds an open-tracking pixel when provided. Omit for
   *  test sends so previews don't pollute open stats. */
  trackingRecipientId?: string;
}): CampaignEmail {
  const { settings } = args;
  const base = siteUrl();

  // Raw values in, fallback logic in applyVars: `{{name | "friend"}}` uses its
  // own fallback when the name is empty; plain `{{name}}` gets the "there"
  // default so a nameless contact never renders "Hi ,".
  const vars = {
    name:  args.recipientName.trim(),
    email: args.recipientEmail,
    restaurant_name: settings.restaurant?.name ?? "",
  };
  const varDefaults = { name: "there" };

  const subject = applyVars(args.subjectTemplate, vars, varDefaults);
  const body    = applyVars(args.bodyTemplate, vars, varDefaults);

  const unsubscribePage = `${base}/unsubscribe?token=${encodeURIComponent(args.unsubscribeToken)}`;
  const unsubscribeApi  = `${base}/api/unsubscribe?token=${encodeURIComponent(args.unsubscribeToken)}`;

  // Hidden preheader — controls the inbox preview snippet without showing in
  // the body. Padded so the client doesn't pull following body text into it.
  const preheader = args.previewText?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${escapeHtml(args.previewText.trim())}${"&#8199;&#65279;".repeat(40)}</div>`
    : "";

  const footer = `
    <p style="color:#9ca3af;font-size:12px;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px">
      You're receiving this because you've dined with us, ordered online, or
      bought a gift card. Don't want offers?
      <a href="${unsubscribePage}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>
    </p>`;

  // 1x1 open-tracking pixel (real sends only).
  const pixel = args.trackingRecipientId
    ? `<img src="${base}/api/track/open?r=${encodeURIComponent(args.trackingRecipientId)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`
    : "";

  const restAddr = [
    settings.restaurant?.addressLine1,
    settings.restaurant?.city,
    settings.restaurant?.postcode,
  ].filter(Boolean).join(", ");

  const html = buildEmailDocument(
    preheader + body + footer + pixel,
    settings.restaurant?.name ?? "",
    restAddr,
    settings.restaurant?.phone ?? "",
    settings.receiptSettings,
    settings.colors,
  );

  return {
    subject,
    html,
    headers: {
      "List-Unsubscribe":      `<${unsubscribeApi}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

// ── Freeze + batch send ───────────────────────────────────────────────────────
// Shared by the interactive send route and the scheduled-campaign cron so both
// behave identically. Sends are marked AFTER a successful send (at-least-once),
// so a crash mid-batch resumes without silently dropping a recipient.

const BATCH_SIZE = 12;
const SEND_INTERVAL_MS = 500; // ~2 sends/sec — Resend's account-wide cap.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Freeze the campaign's recipient snapshot from its audience descriptor, once.
 * Idempotent: if recipient rows already exist it's a no-op and returns the
 * existing count. Returns the frozen recipient count.
 */
export async function ensureRecipientsFrozen(campaignId: string, audience: Audience): Promise<number> {
  const { count } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  if ((count ?? 0) > 0) return count ?? 0;

  const contacts = await resolveAudience(audience);
  const rows = contacts.map((c) => ({
    id:          crypto.randomUUID(),
    campaign_id: campaignId,
    contact_id:  c.id,
    email:       c.email,
    name:        c.name,
    status:      "pending",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("email_campaign_recipients").insert(rows.slice(i, i + 500));
    if (error) { console.error("ensureRecipientsFrozen insert:", error.message); break; }
  }
  await supabaseAdmin
    .from("email_campaigns")
    .update({ total_recipients: rows.length, status: "sending" })
    .eq("id", campaignId);
  return rows.length;
}

export interface BatchOutcome {
  done: boolean;
  remaining: number;
  totals: { sent: number; failed: number; skipped: number };
}

/**
 * Send ONE batch of a campaign's pending recipients, then roll up counters.
 * Returns whether the queue is drained (done) and the live totals.
 */
export async function processCampaignBatch(
  campaign: { id: string; subject: string; body_html: string; preview_text?: string | null },
  settings: AdminSettings,
): Promise<BatchOutcome> {
  const { data: batch } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("id, contact_id, email, name")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  for (const r of batch ?? []) {
    const { data: contact } = await supabaseAdmin
      .from("marketing_contacts")
      .select("marketing_opt_in, unsubscribed_at, unsubscribe_token")
      .eq("id", r.contact_id ?? "")
      .maybeSingle();

    if (!contact || contact.marketing_opt_in !== true || contact.unsubscribed_at) {
      await supabaseAdmin.from("email_campaign_recipients")
        .update({ status: "skipped", error: "Not opted in at send time." })
        .eq("id", r.id);
      continue;
    }

    const email = buildCampaignEmail({
      subjectTemplate:     campaign.subject,
      bodyTemplate:        campaign.body_html,
      previewText:         campaign.preview_text ?? "",
      recipientName:       r.name ?? "",
      recipientEmail:      r.email,
      unsubscribeToken:    contact.unsubscribe_token as string,
      settings,
      trackingRecipientId: r.id,
    });

    const result = await sendEmail({
      to: r.email, subject: email.subject, html: email.html, headers: email.headers,
    });

    if (result.ok) {
      await supabaseAdmin.from("email_campaign_recipients")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("id", r.id);
    } else {
      await supabaseAdmin.from("email_campaign_recipients")
        .update({ status: "failed", error: result.error ?? "Send failed." })
        .eq("id", r.id);
    }
    await sleep(SEND_INTERVAL_MS);
  }

  const { count: remaining } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("status", "pending");

  // Authoritative counters from the recipient rows (survives overlapping calls).
  const { data: tallies } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("status")
    .eq("campaign_id", campaign.id);
  const totals = { sent: 0, failed: 0, skipped: 0 };
  for (const t of tallies ?? []) {
    if (t.status === "sent")         totals.sent++;
    else if (t.status === "failed")  totals.failed++;
    else if (t.status === "skipped") totals.skipped++;
  }

  const done = (remaining ?? 0) === 0;
  await supabaseAdmin.from("email_campaigns").update({
    sent_count:    totals.sent,
    failed_count:  totals.failed,
    skipped_count: totals.skipped,
    ...(done ? { status: "sent", completed_at: new Date().toISOString() } : {}),
  }).eq("id", campaign.id);

  return { done, remaining: remaining ?? 0, totals };
}
