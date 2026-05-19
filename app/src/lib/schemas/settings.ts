import { z } from "zod";

// The settings blob is a freeform JSONB document. Validate only the load-bearing
// constraint: it must be a non-null object. Field-level validation lives in
// the admin panels.
export const SettingsUpdateSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
