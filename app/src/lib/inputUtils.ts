import type { ZodError } from "zod";

/** Strip non-digits, optional length cap. Use for PIN, raw-digit fields. */
export function cleanDigits(s: string, max?: number): string {
  const digits = s.replace(/\D/g, "");
  return max ? digits.slice(0, max) : digits;
}

/** Keep +, digits, spaces, parens, dashes. Use for phone inputs. */
export function cleanPhone(s: string): string {
  return s.replace(/[^\d+\s()-]/g, "").slice(0, 20);
}

/** Keep digits + a single decimal point. Use for price/money inputs. */
export function cleanDecimal(s: string, decimals = 2): string {
  let cleaned = s.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot !== -1) {
    cleaned =
      cleaned.slice(0, firstDot + 1) +
      cleaned.slice(firstDot + 1).replace(/\./g, "");
    const [whole, frac = ""] = cleaned.split(".");
    cleaned = `${whole}.${frac.slice(0, decimals)}`;
  }
  return cleaned;
}

/** Pull the first issue from a ZodError for inline banner UX. */
export function formErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? "Please check the form for errors.";
}
