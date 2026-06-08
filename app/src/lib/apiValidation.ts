import { z } from "zod";

export type ParseFailure = { ok: false; error: string; status: 400 };
export type ParseSuccess<T> = { ok: true; data: T };

/**
 * Parse + validate a JSON request body against a zod schema.
 * Returns the same { ok, error, status } shape used by orderValidation.ts so
 * route handlers can respond consistently.
 */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<ParseSuccess<T> | ParseFailure> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON.", status: 400 };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: firstZodMessage(result.error), status: 400 };
  }
  return { ok: true, data: result.data };
}

/** Validate an already-parsed value (e.g. a query object). */
export function parseValue<T>(
  value: unknown,
  schema: z.ZodType<T>,
): ParseSuccess<T> | ParseFailure {
  const result = schema.safeParse(value);
  if (!result.success) {
    return { ok: false, error: firstZodMessage(result.error), status: 400 };
  }
  return { ok: true, data: result.data };
}

/** Extract the first error message — flat list works for our form-error banner UX. */
export function firstZodMessage(err: z.ZodError): string {
  const first = err.issues[0];
  if (!first) return "Invalid request.";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}
