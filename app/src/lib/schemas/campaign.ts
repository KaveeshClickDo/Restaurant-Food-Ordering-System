/**
 * Zod schemas for the marketing campaign routes. Mirrors the patterns in
 * lib/schemas/customer.ts / giftCard.ts.
 */

import { z } from "zod";
import { Email } from "./primitives";

/** POST /api/admin/campaigns — create a campaign + its recipient snapshot.
 *  contactIds come from the panel's current filter/selection; the server
 *  re-validates every contact (opt-in, not unsubscribed, real email) so a
 *  stale browser list can never email an opted-out person. */
export const CampaignCreateSchema = z.object({
  subject:    z.string().trim().min(1, "Subject is required.").max(200),
  bodyHtml:   z.string().trim().min(1, "Email body is required.").max(50_000),
  contactIds: z.array(z.string().min(1)).min(1, "Select at least one contact.").max(5_000),
  /** Echo of the filter that built the selection — stored for the history view. */
  audience:   z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/admin/campaigns/test — send a rendered preview to one address. */
export const CampaignTestSchema = z.object({
  subject:  z.string().trim().min(1).max(200),
  bodyHtml: z.string().trim().min(1).max(50_000),
  to:       Email,
});
