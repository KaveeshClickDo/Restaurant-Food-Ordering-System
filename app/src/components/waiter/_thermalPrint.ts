/** Print a waiter's round-sent receipt to the active Kitchen printer, reusing
 *  buildDineInReceiptBytes rather than printDineInBill (hardcoded to "pos"). */

import type { AdminSettings } from "@/types";
import type { DineInOrder } from "@/components/pos/_receipts";
import { resolveActivePrinter, logoToRaster, paperDotWidth } from "@/lib/escpos";
import { buildDineInReceiptBytes, sendReceiptToPrinter, printDineInBill } from "@/lib/posPrint";
import type { WaiterReceipt } from "./_types";

function toDineInOrder(receipt: WaiterReceipt): DineInOrder {
  return {
    id: receipt.orderIds[0] ?? `waiter-${receipt.tableLabel}`,
    tableLabel: receipt.tableLabel,
    staffName: receipt.waiterName,
    covers: receipt.covers ?? 0,
    items: receipt.items,
    subtotal: receipt.subtotal,
    discountAmount: receipt.discountAmount,
    discountNote: receipt.discountNote,
    vatAmount: receipt.vatAmount,
    vatInclusive: receipt.vatInclusive,
    vatRate: receipt.vatRate,
    tipAmount: receipt.tipAmount,
    serviceFeeAmount: receipt.serviceFeeAmount,
    total: receipt.total,
    status: "pending",
    paymentMethod: receipt.paymentMethod ?? "pending",
    giftCardUsed: receipt.giftCardUsed,
    date: receipt.date,
  };
}

export async function printWaiterReceiptToKitchen(
  receipt: WaiterReceipt,
  appSettings: AdminSettings,
): Promise<{ ok: boolean; error?: string; browser?: boolean; noPrinter?: boolean }> {
  const printer = resolveActivePrinter(appSettings, "kitchen");
  if (!printer) return { ok: false, noPrinter: true };
  if (printer.connection === "browser") return { ok: false, browser: true };

  const rs = appSettings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || appSettings.restaurant?.name || "Restaurant";
  const logoBytes = rs.showLogo && rs.logoUrl
    ? await logoToRaster(rs.logoUrl, paperDotWidth(printer.paperWidth), { dither: rs.logoDither })
    : null;
  const bytes = buildDineInReceiptBytes(
    toDineInOrder(receipt),
    { currencySymbol: appSettings.currency?.symbol ?? "£", taxRate: appSettings.taxSettings?.rate },
    { paperWidth: printer.paperWidth, restaurantName, receipt: rs, logoBytes },
  );
  return sendReceiptToPrinter(bytes, printer);
}

/** Print a settled bill to the active Receipt/POS printer (manual only — settling never auto-prints). */
export async function printWaiterReceiptToPos(
  receipt: WaiterReceipt,
  appSettings: AdminSettings,
): Promise<{ ok: boolean; error?: string; browser?: boolean; noPrinter?: boolean }> {
  const rs = appSettings.receiptSettings;
  const restaurantName = rs?.restaurantName?.trim() || appSettings.restaurant?.name || "Restaurant";
  return printDineInBill(
    toDineInOrder(receipt),
    { currencySymbol: appSettings.currency?.symbol ?? "£", taxRate: appSettings.taxSettings?.rate },
    appSettings,
    restaurantName,
    rs,
  );
}
