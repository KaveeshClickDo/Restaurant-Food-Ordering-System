/**
 * POST /api/admin/customers/[id]/set-password — admin sets a customer password.
 *
 * Body: { password: string }
 * Requires admin authentication. Password is bcrypt-hashed before storage.
 */

import { NextRequest, NextResponse }                   from "next/server";
import bcrypt                                          from "bcryptjs";
import { z }                                           from "zod";
import { supabaseAdmin }                               from "@/lib/supabaseAdmin";
import { isAdminAuthenticated, unauthorizedResponse }  from "@/lib/adminAuth";
import { parseBody }                                   from "@/lib/apiValidation";

const HASH_ROUNDS = 10;

const SetPasswordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters."),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) return unauthorizedResponse();
  const { id } = await context.params;

  const parsed = await parseBody(req, SetPasswordSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });

  const passwordHash = await bcrypt.hash(parsed.data.password, HASH_ROUNDS);

  // Bump session_version so any device the customer is still signed in on is
  // logged out on its next request (verified in lib/auth.ts readCustomerSession).
  // Done defensively: if the column isn't present yet (not-quite-migrated DB),
  // the read errors and we simply skip the bump and still set the password.
  const update: Record<string, unknown> = { password_hash: passwordHash };
  const { data: current } = await supabaseAdmin
    .from("customers")
    .select("session_version")
    .eq("id", id)
    .maybeSingle();
  if (current && current.session_version !== undefined && current.session_version !== null) {
    update.session_version = Number(current.session_version) + 1;
  }

  const { error } = await supabaseAdmin
    .from("customers")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
