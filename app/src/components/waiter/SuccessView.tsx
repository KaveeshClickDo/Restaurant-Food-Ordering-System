"use client";

/**
 * "Order Sent!" confirmation after a round goes to the kitchen. Offers
 * adding more items to the same table or starting a new one, plus receipt
 * view/print (the receipt itself is shared page state).
 */

import { useState } from "react";
import { CheckCircle2, Eye } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { resolveActivePrinter } from "@/lib/escpos";
import type { WaiterReceipt } from "./_types";
import { printWaiterReceiptToKitchen } from "./_thermalPrint";
import ReceiptModal from "./ReceiptModal";

export default function SuccessView({ tableLabel, receipt, onAddMore, onNewTable }: {
  tableLabel: string | undefined;
  receipt: WaiterReceipt | null;
  onAddMore: () => void;
  onNewTable: () => void;
}) {
  const { settings: appSettings } = useApp();
  // Separate from the shared `receipt` state, so closing the modal doesn't also hide "View Receipt".
  const [showReceipt, setShowReceipt] = useState(true);
  const kitchenPrinter = resolveActivePrinter(appSettings, "kitchen");
  // Auto-print off: nothing was attempted, not a failure. No printer: modal shows this itself.
  const kitchenAutoPrintOff = !!kitchenPrinter && !kitchenPrinter.autoPrint;
  const noKitchenPrinter = !kitchenPrinter;

  return (
    <>
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={40} className="text-white" />
          </div>
          <div>
            <h2 className="text-white text-2xl font-black">Order Sent!</h2>
            <p className="text-slate-400 mt-1">Kitchen is preparing {tableLabel}</p>
          </div>
          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={onAddMore}
              className="px-6 py-3 bg-slate-700 text-white font-semibold rounded-2xl hover:bg-slate-600 transition"
            >
              Add more items
            </button>
            <button
              onClick={onNewTable}
              className="px-6 py-3 bg-orange-500 text-white font-bold rounded-2xl hover:bg-orange-400 transition"
            >
              New table
            </button>
          </div>

          {/* Receipt actions — Print and PDF live inside the modal itself. */}
          {receipt && (
            <div className="flex gap-3 justify-center flex-wrap pt-2">
              <button
                onClick={() => setShowReceipt(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                <Eye size={15} /> View Receipt
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Receipt modal */}
      {receipt && showReceipt && (
        <ReceiptModal
          receipt={receipt}
          onClose={() => setShowReceipt(false)}
          thermalPrint={() => printWaiterReceiptToKitchen(receipt, appSettings)}
          noPrinterHint="An admin can set one up in Admin → Integrations."
          printerLabel="Kitchen"
          autoPrintError={receipt.kitchenPrintError}
          autoPrintOff={kitchenAutoPrintOff}
          noPrinterConfigured={noKitchenPrinter}
          autoPrinting={receipt.kitchenPrintPending}
        />
      )}
    </>
  );
}
