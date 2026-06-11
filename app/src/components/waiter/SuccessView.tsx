"use client";

/**
 * "Order Sent!" confirmation after a round goes to the kitchen. Offers
 * adding more items to the same table or starting a new one, plus receipt
 * view/print (the receipt itself is shared page state).
 */

import { CheckCircle2, Eye, Printer } from "lucide-react";
import type { WaiterReceipt } from "./_types";
import ReceiptModal from "./ReceiptModal";

export default function SuccessView({ tableLabel, receipt, setReceipt, onAddMore, onNewTable }: {
  tableLabel: string | undefined;
  receipt: WaiterReceipt | null;
  setReceipt: (r: WaiterReceipt | null) => void;
  onAddMore: () => void;
  onNewTable: () => void;
}) {
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

          {/* Receipt actions */}
          {receipt && (
            <div className="flex gap-3 justify-center flex-wrap pt-2">
              <button
                onClick={() => setReceipt({ ...receipt })}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                <Eye size={15} /> View Receipt
              </button>
              <button
                onClick={() => {
                  const win = window.open("", "_blank", "width=400,height=600");
                  if (!win) return;
                  win.document.write(`<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script>`);
                  win.document.close();
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                <Printer size={15} /> Print
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Receipt modal */}
      {receipt && (
        <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
      )}
    </>
  );
}
