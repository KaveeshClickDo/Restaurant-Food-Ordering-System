/**
 * Reads `printers[]` from a raw app_settings row, converting the legacy
 * single-`printer` shape if the row isn't migrated yet. Shared by the client
 * (AppContext) and server (printRelay, /api/pos/settings) so both treat an
 * un-migrated row the same way.
 */

import type { PrinterCategory, PrinterSettings } from "@/types";

/** Fixed, not random — so re-resolving an un-migrated row never changes it. */
export const LEGACY_PRINTER_ID = "legacy-printer";

export function resolvePrinters(data: Record<string, unknown> | null | undefined): PrinterSettings[] {
  if (!data) return [];
  const raw = data as { printers?: unknown; printer?: Record<string, unknown> };
  if (Array.isArray(raw.printers)) return raw.printers as PrinterSettings[];

  const legacy = raw.printer;
  if (!legacy || typeof legacy !== "object") return [];
  return [{
    id: LEGACY_PRINTER_ID,
    category: "pos",
    enabled: !!legacy.enabled,
    name: (legacy.name as string) || "Receipt Printer",
    connection: (legacy.connection as PrinterSettings["connection"]) ?? "network",
    ip: (legacy.ip as string) ?? "",
    port: (legacy.port as number) ?? 9100,
    bluetoothAddress: (legacy.bluetoothAddress as string) ?? "",
    bluetoothName: (legacy.bluetoothName as string) ?? "",
    autoPrint: legacy.autoPrint !== false,
    paperWidth: (legacy.paperWidth as number) ?? 48,
  }];
}

/** Matches resolvePrinters — seeds from the legacy printer's enabled flag
 *  when the row isn't migrated yet. */
export function resolveActivePrinterIdByCategory(
  data: Record<string, unknown> | null | undefined,
  printers: PrinterSettings[],
): Record<PrinterCategory, string | null> {
  const raw = data as { printers?: unknown; activePrinterIdByCategory?: Record<string, unknown> } | null | undefined;
  if (raw && Array.isArray(raw.printers)) {
    return { kitchen: null, pos: null, ...(raw.activePrinterIdByCategory ?? {}) } as Record<PrinterCategory, string | null>;
  }
  const legacy = printers.find((p) => p.id === LEGACY_PRINTER_ID);
  return { kitchen: null, pos: legacy?.enabled ? legacy.id : null };
}