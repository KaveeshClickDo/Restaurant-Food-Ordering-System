/**
 * PATCH /api/pos/settings — scoped settings writer for the POS app.
 *
 * The POS Settings screen needs to persist a SMALL slice of the global
 * AdminSettings blob — tax (rate/inclusive) and the receipt-printer config —
 * from a POS-only device that has no admin session.
 *
 * The full writer (POST /api/admin/settings) replaces the entire settings
 * document and is admin-only: letting a POS session call it would mean a till
 * could overwrite payment keys, delivery zones, schedule, etc. So this route
 * accepts a POS session with `canAccessSettings` (admin override built in) and
 * merges ONLY the whitelisted `taxSettings` / `printer` keys into app_settings.
 *
 * Field-scoping mirrors /api/admin/menu/[id]/stock — the established pattern in
 * this codebase for "let POS write a narrow, well-defined slice that the broad
 * admin route is too powerful to share."
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requirePosPermission } from "@/lib/posPermissions";
import { parseBody } from "@/lib/apiValidation";
import { PosSettingsPatchSchema } from "@/lib/schemas/pos";
import { resolvePrinters, resolveActivePrinterIdByCategory, createDefaultPrinter } from "@/lib/printerRecords";

export async function PATCH(req: NextRequest) {
  // POS admin / manager (canAccessSettings) OR any admin session.
  const gate = await requirePosPermission("canAccessSettings");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(req, PosSettingsPatchSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const patch = parsed.data;

  // Read the current blob, then shallow-merge ONLY the whitelisted sub-objects
  // back in. Merging at the sub-object level preserves sibling fields the POS
  // client didn't send (e.g. taxSettings.showBreakdown when POS changes only
  // rate/inclusive), and guarantees no other settings key can be touched here.
  const { data: row, error: readErr } = await supabaseAdmin
    .from("app_settings")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  if (readErr) {
    console.error("pos/settings read:", readErr.message);
    return NextResponse.json({ ok: false, error: readErr.message }, { status: 500 });
  }

  const data = (row?.data ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...data };
  if (patch.taxSettings) {
    next.taxSettings = { ...((data.taxSettings as object) ?? {}), ...patch.taxSettings };
  }
  // POS may add, edit and remove "pos"-category printers, never "kitchen" —
  // checked here since only a DB read can confirm category membership.
  // resolvePrinters also covers an un-migrated row.
  if (patch.printer || patch.activePrinterId || patch.addPrinter || patch.removePrinterId) {
    let printers = [...resolvePrinters(data)];
    let activePrinterIdByCategory = resolveActivePrinterIdByCategory(data, printers);

    if (patch.addPrinter) {
      if (printers.some((p) => p.id === patch.addPrinter!.id)) {
        return NextResponse.json({ ok: false, error: "A printer with this id already exists." }, { status: 403 });
      }
      printers.push(createDefaultPrinter("pos", patch.addPrinter.id));
    }

    if (patch.printer) {
      const idx = printers.findIndex((p) => p.id === patch.printer!.id);
      if (idx === -1 || printers[idx].category !== "pos") {
        return NextResponse.json(
          { ok: false, error: "Printer not found or not in the pos category." },
          { status: 403 },
        );
      }
      printers[idx] = { ...printers[idx], ...patch.printer, category: "pos" };
      // Disabling the active printer clears the pointer, as the admin panel does —
      // otherwise it stays "Active" after the next sync and re-enabling it would
      // silently make it active again.
      if (patch.printer.enabled === false && activePrinterIdByCategory.pos === patch.printer.id) {
        activePrinterIdByCategory = { ...activePrinterIdByCategory, pos: null };
      }
    }

    if (patch.removePrinterId) {
      const removeId = patch.removePrinterId;
      const target = printers.find((p) => p.id === removeId);
      if (!target || target.category !== "pos") {
        return NextResponse.json(
          { ok: false, error: "Printer not found or not in the pos category." },
          { status: 403 },
        );
      }
      printers = printers.filter((p) => p.id !== removeId);
      if (activePrinterIdByCategory.pos === removeId) {
        activePrinterIdByCategory = { ...activePrinterIdByCategory, pos: null };
      }
    }

    if (patch.activePrinterId) {
      const { id } = patch.activePrinterId;
      if (id !== null) {
        const target = printers.find((p) => p.id === id);
        if (!target || target.category !== "pos" || !target.enabled) {
          return NextResponse.json(
            { ok: false, error: "Printer must exist, be enabled, and be in the pos category to be made active." },
            { status: 403 },
          );
        }
      }
      activePrinterIdByCategory = { ...activePrinterIdByCategory, pos: id };
    }

    next.printers = printers;
    next.activePrinterIdByCategory = activePrinterIdByCategory;
  }
  if (patch.receiptSettings) {
    // Shared with Admin → Receipt: sub-object merge preserves sibling fields the
    // POS client didn't send, so both surfaces edit the same record.
    next.receiptSettings = { ...((data.receiptSettings as object) ?? {}), ...patch.receiptSettings };
  }

  const { error: writeErr } = await supabaseAdmin
    .from("app_settings")
    .upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
  if (writeErr) {
    console.error("pos/settings write:", writeErr.message);
    return NextResponse.json({ ok: false, error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
