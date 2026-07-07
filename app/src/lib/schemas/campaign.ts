/**
 * Zod schemas for the marketing campaign (broadcast) routes.
 */

import { z } from "zod";
import { Email } from "./primitives";

const ContactSourceEnum = z.enum([
  "reservation", "online_order", "account", "gift_card", "pos", "ebill",
]);

/** Audience descriptor stored on a campaign and resolved to contacts at send
 *  time (see lib/marketingCampaigns.ts resolveAudience). */
export const AudienceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("sources"), sources: z.array(ContactSourceEnum).min(1) }),
  z.object({ mode: z.literal("tags"), tags: z.array(z.string().min(1)).min(1) }),
  z.object({ mode: z.literal("selection"), ids: z.array(z.string().min(1)).min(1).max(20_000) }),
]);

/** POST /api/admin/campaigns — create a draft broadcast. */
export const CampaignCreateSchema = z.object({
  subject:     z.string().trim().max(200).default(""),
  bodyHtml:    z.string().trim().max(100_000).default(""),
  previewText: z.string().trim().max(200).default(""),
  audience:    AudienceSchema.default({ mode: "all" }),
});

/** PATCH /api/admin/campaigns/[id] — update draft fields and/or schedule it. */
export const CampaignUpdateSchema = z.object({
  subject:     z.string().trim().max(200).optional(),
  bodyHtml:    z.string().trim().max(100_000).optional(),
  previewText: z.string().trim().max(200).optional(),
  audience:    AudienceSchema.optional(),
  /** ISO timestamp to schedule (sets status 'scheduled'); null clears back to draft. */
  scheduledAt: z.string().datetime().nullable().optional(),
});

/** POST /api/admin/campaigns/test — send a rendered preview to one address. */
export const CampaignTestSchema = z.object({
  subject:     z.string().trim().min(1).max(200),
  bodyHtml:    z.string().trim().min(1).max(100_000),
  previewText: z.string().trim().max(200).optional(),
  to:          Email,
});
