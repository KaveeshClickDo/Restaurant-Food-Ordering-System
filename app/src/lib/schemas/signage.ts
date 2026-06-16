import { z } from "zod";
import { NonEmptyString, Hex } from "./primitives";

// Digital signage / menu boards. A "display" is one public TV screen
// (/display/<slug>) carrying an ordered list of poster images. See
// supabase/schema.sql → signage_displays and api/admin/signage.

// URL slug: lowercase letters, digits and hyphens only. Derived from the name
// on the client but re-validated here because the slug becomes the public URL.
export const SignageSlug = z
  .string()
  .trim()
  .min(1, "URL slug is required.")
  .max(80, "URL slug is too long.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only.");

// One poster image in the slideshow. `imageUrl` is the public Storage URL
// returned by /api/uploads/signage-image. `order` drives playback sequence;
// `enabled` lets the admin hide a slide without deleting it.
export const SignageSlide = z.object({
  id:       NonEmptyString,
  imageUrl: z.string().trim().min(1, "Image URL is required."),
  order:    z.number().int().min(0),
  enabled:  z.boolean(),
});

const Transition = z.enum(["fade", "none"]);
const Fit        = z.enum(["contain", "cover"]);
// 3–60 s per slide, stored in ms. Guards against a 0 ms (CPU-spinning) loop.
const IntervalMs = z.number().int().min(3000, "Minimum 3 seconds.").max(60000, "Maximum 60 seconds.");

export const SignageCreateSchema = z.object({
  name: NonEmptyString.max(80, "Name is too long."),
});

// Every field optional — a PATCH can touch just one (rename, toggle active,
// reorder slides, change speed, …). `slides` replaces the whole array.
export const SignageUpdateSchema = z
  .object({
    name:       NonEmptyString.max(80, "Name is too long."),
    slug:       SignageSlug,
    active:     z.boolean(),
    slides:     z.array(SignageSlide).max(50, "A display can hold up to 50 images."),
    intervalMs: IntervalMs,
    transition: Transition,
    fit:        Fit,
    background: Hex,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "No fields to update.");

export type SignageSlideInput = z.infer<typeof SignageSlide>;
export type SignageUpdateInput = z.infer<typeof SignageUpdateSchema>;
