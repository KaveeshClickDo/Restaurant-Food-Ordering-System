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

import type { AdminSettings } from "@/types";
import { applyVars, buildEmailDocument } from "./emailTemplates";
import { supabaseAdmin } from "./supabaseAdmin";

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

/**
 * Render one campaign email for one recipient.
 * `unsubscribeToken` is the contact's reservation_customers.unsubscribe_token;
 * the test route passes the literal "preview" (the public page fails politely).
 */
export function buildCampaignEmail(args: {
  subjectTemplate: string;
  bodyTemplate: string;
  recipientName: string;
  recipientEmail: string;
  unsubscribeToken: string;
  settings: AdminSettings;
}): CampaignEmail {
  const { settings } = args;
  const base = siteUrl();

  const vars = {
    name:  args.recipientName.trim() || "there",
    email: args.recipientEmail,
    restaurant_name: settings.restaurant?.name ?? "",
  };

  const subject = applyVars(args.subjectTemplate, vars);
  const body    = applyVars(args.bodyTemplate, vars);

  const unsubscribePage = `${base}/unsubscribe?token=${encodeURIComponent(args.unsubscribeToken)}`;
  const unsubscribeApi  = `${base}/api/unsubscribe?token=${encodeURIComponent(args.unsubscribeToken)}`;

  const footer = `
    <p style="color:#9ca3af;font-size:12px;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px">
      You're receiving this because you've dined with us, ordered online, or
      bought a gift card. Don't want offers?
      <a href="${unsubscribePage}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>
    </p>`;

  const restAddr = [
    settings.restaurant?.addressLine1,
    settings.restaurant?.city,
    settings.restaurant?.postcode,
  ].filter(Boolean).join(", ");

  const html = buildEmailDocument(
    body + footer,
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
