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

  const { error } = await supabaseAdmin
    .from("customers")
    .update({ password_hash: passwordHash })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
