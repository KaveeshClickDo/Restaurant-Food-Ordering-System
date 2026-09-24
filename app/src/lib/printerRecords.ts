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

const DEFAULT_PRINTER_NAME: Record<PrinterCategory, string> = {
  kitchen: "Kitchen Printer",
  pos: "Receipt Printer",
  online: "Online Orders Printer",
};

/** A new, disabled printer with default settings. Shared by the admin add,
 *  the POS add, and the POS route, so their defaults can't drift. */
export function createDefaultPrinter(category: PrinterCategory, id: string): PrinterSettings {
  return {
    id,
    category,
    enabled: false,
    name: DEFAULT_PRINTER_NAME[category],
    connection: "network",
    ip: "", port: 9100,
    bluetoothAddress: "", bluetoothName: "",
    autoPrint: true, paperWidth: 48,
  };
}

/** Printers in the OTHER category on the same network IP + port — one physical
 *  printer that would print every POS sale twice. Only kitchen and pos matter:
 *  a POS sale prints to both, while online orders print only when an admin
 *  clicks Print, so an "online" printer never double-prints with either.
 *  Ignores `enabled` on purpose: new printers start disabled, and the warning
 *  matters while setting up. */
export function findOtherCategoryPrintersAtSameAddress(
  printers: PrinterSettings[],
  target: Pick<PrinterSettings, "id" | "category" | "connection" | "ip" | "port">,
): PrinterSettings[] {
  const ip = (target.ip ?? "").trim().toLowerCase();
  if (target.category === "online" || target.connection !== "network" || !ip) return [];
  return printers.filter((p) =>
    p.id !== target.id
    && p.category !== target.category
    && p.category !== "online"
    && p.connection === "network"
    && (p.ip ?? "").trim().toLowerCase() === ip
    && p.port === target.port,
  );
}

/** Matches resolvePrinters — seeds from the legacy printer's enabled flag
 *  when the row isn't migrated yet. */
export function resolveActivePrinterIdByCategory(
  data: Record<string, unknown> | null | undefined,
  printers: PrinterSettings[],
): Record<PrinterCategory, string | null> {
  const raw = data as { printers?: unknown; activePrinterIdByCategory?: Record<string, unknown> } | null | undefined;
  if (raw && Array.isArray(raw.printers)) {
    return { kitchen: null, pos: null, online: null, ...(raw.activePrinterIdByCategory ?? {}) } as Record<PrinterCategory, string | null>;
  }
  const legacy = printers.find((p) => p.id === LEGACY_PRINTER_ID);
  return { kitchen: null, pos: legacy?.enabled ? legacy.id : null, online: null };
}