"use client";

/**
 * Receipt for a walk-in, phone, or online booking — fixed confirmation
 * layout, not the sale receipt. Shared by POS (ReservationsView.tsx) and the
 * Admin Reservations panel — `surface` picks the printer category and
 * transport: POS's native-first "pos" printer (Settings → Hardware) or
 * Admin's browser-based "online" printer (Admin → Integrations). Auto-prints
 * once only right after creating a walk-in/phone booking (if that printer's
 * Auto-print is on); reopened from the list it's Print-button only. Email is
 * always manual, so it never duplicates the automatic "reservation_confirmation"
 * email.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { apiBase } from "@/lib/apiBase";
import { useApp } from "@/context/AppContext";
import { Mail, CheckCircle2, RefreshCw, Printer, AlertTriangle, Info, FileDown } from "lucide-react";
import { resolveActivePrinter } from "@/lib/escpos";
import { isCapacitorAndroid } from "@/lib/capacitorBridge";
import { printReservationReceipt, printAdminReservationReceipt } from "@/lib/posPrint";
import {
  buildReservationReceiptHtml, reservationReference, reservationSourceLabel, fmtResDate, fmtResTime,
  RESERVATION_THANK_YOU, type ReservationReceiptData,
} from "./_reservationReceipt";

export default function ReservationReceiptModal(
  { data, onClose, autoPrint = false, surface = "pos" }: {
    data: ReservationReceiptData;
    onClose: () => void;
    autoPrint?: boolean;
    surface?: "pos" | "admin";
  },
) {
  const { settings: appSettings } = useApp();
  const rs = appSettings.receiptSettings;
  const sym = appSettings.currency?.symbol ?? "£";
  const printerCategory = surface === "admin" ? "online" : "pos";
  const printerLabel = surface === "admin" ? "Online" : "Receipt";
  const doPrint = surface === "admin" ? printAdminReservationReceipt : printReservationReceipt;
  const settingsPath = surface === "admin" ? "Admin → Integrations" : "Settings → Hardware";

  const [emailTo, setEmailTo] = useState(data.customerEmail);
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState("");
  const [printStatus, setPrintStatus] = useState<"idle" | "printing" | "ok" | "error">("idle");
  const [printError, setPrintError] = useState("");
  const [printNoPrinter, setPrintNoPrinter] = useState(false);

  const activePrinter = resolveActivePrinter(appSettings, printerCategory);
  const noReceiptPrinter = autoPrint && !activePrinter;
  const receiptAutoPrintOff = autoPrint && !!activePrinter && !activePrinter.autoPrint;
  const onAndroid = isCapacitorAndroid();

  const effectiveName = appSettings.restaurant?.name || rs.restaurantName?.trim() || "Restaurant";
  const restaurantName = effectiveName.toUpperCase();

  async function sendEmail() {
    if (!emailTo.trim()) return;
    setEmailStatus("sending");
    setEmailError("");
    try {
      const html = buildReservationReceiptHtml(data, rs, effectiveName, sym);
      const subject = `Your booking confirmation from ${effectiveName} — ${reservationReference(data.id)}`;
      const res = await fetch(apiBase() + "/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailTo.trim(), subject, html, marketingOptIn }),
      });
      const resData = await res.json();
      if (resData.ok) {
        setEmailStatus("sent");
      } else {
        setEmailStatus("error");
        setEmailError(resData.error ?? "Failed to send email");
      }
    } catch (e) {
      setEmailStatus("error");
      setEmailError(e instanceof Error ? e.message : "Network error");
    }
  }

  // PDF / browser print: a small window with only the receipt, then the print dialog.
  const handlePdf = useCallback(() => {
    const script = "<script>window.onafterprint=function(){window.close();};window.onload=function(){window.focus();window.print();};</script>";
    const html = buildReservationReceiptHtml(data, rs, effectiveName, sym).replace("</body>", `${script}</body>`);
    const win = window.open("", "_blank", "width=420,height=720");
    if (!win) {
      alert("Pop-up was blocked. Allow pop-ups for this site and try again.");
      return;
    }
    win.document.write(html);
    win.document.close();
  }, [data, rs, effectiveName, sym]);

  // Print to the configured thermal printer — same transport/fallback rules as
  // the sale receipt (native Bluetooth/USB/TCP on Android, server proxy on web).
  const handlePrint = useCallback(async () => {
    setPrintStatus("printing");
    setPrintError("");
    setPrintNoPrinter(false);
    const r = await doPrint(data, sym, appSettings, effectiveName, rs);
    if (r.noPrinter) {
      setPrintStatus("error");
      setPrintNoPrinter(true);
      setPrintError(`No receipt printer is set up. Add one in ${settingsPath}.`);
      return;
    }
    if (r.browser) {
      if (onAndroid) {
        setPrintStatus("error");
        setPrintError(`Printer set to “browser” mode, which isn’t available on the tablet. Pick Bluetooth, USB, or Network in ${settingsPath}.`);
      } else {
        setPrintStatus("idle");
        handlePdf();
      }
      return;
    }
    if (r.ok) {
      setPrintStatus("ok");
      setTimeout(() => setPrintStatus("idle"), 4000);
    } else {
      setPrintStatus("error");
      setPrintError(r.error ?? "Printing failed.");
    }
  }, [data, sym, appSettings, effectiveName, onAndroid, rs, doPrint, settingsPath, handlePdf]);

  // Auto-print once, right after the booking is created (autoPrint prop) —
  // follows the active printer's own Auto-print setting, same rule as the
  // sale receipt. Never fires when reopened from the reservations list.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (autoPrinted.current || !autoPrint) return;
    if (!activePrinter?.autoPrint) return;
    autoPrinted.current = true;
    void handlePrint();
  }, [autoPrint, activePrinter, handlePrint]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm flex flex-col shadow-2xl overflow-hidden max-h-[95vh]">
        <div className="p-6 font-mono text-gray-900 text-xs overflow-y-auto flex-1">

          {/* ── Header ───────────────────────────────────────── */}
          <div className="text-center mb-4">
            {rs.showLogo && rs.logoUrl && (
              <div className="flex justify-center mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary URL or data: URI, needs onError fallback */}
                <img src={rs.logoUrl} alt="Logo" className="h-10 w-auto object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
            )}
            <p className="font-bold text-base">{restaurantName}</p>
            {rs.address?.trim() && <p className="text-gray-500 whitespace-pre-line">{rs.address.trim()}</p>}
            {rs.phone && <p className="text-gray-500">{rs.phone}</p>}
            {rs.website && <p className="text-gray-500">{rs.website}</p>}
            {rs.email && <p className="text-gray-500">{rs.email}</p>}
            {rs.companyNumber && <p className="text-gray-400 text-[10px]">Company No: {rs.companyNumber}</p>}
            {rs.vatNumber && <p className="text-gray-400 text-[10px]">VAT No: {rs.vatNumber}</p>}
          </div>

          <div className="border-t border-dashed border-gray-300 my-3" />

          {/* ── Booking details ─────────────────────────────────── */}
          <p className="text-center font-bold text-sm tracking-wide mb-3">RESERVATION CONFIRMATION</p>
          <div className="space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Reference</span><span className="font-bold">{reservationReference(data.id)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Guest</span><span>{data.customerName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Party size</span><span>{data.partySize}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Date</span><span>{fmtResDate(data.date)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Time</span><span>{fmtResTime(data.time)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Table</span><span>{data.tableLabel}{data.section ? ` (${data.section})` : ""}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Booking type</span><span>{reservationSourceLabel(data.source)}</span></div>
            {data.staffName && (
              <div className="flex justify-between"><span className="text-gray-500">Taken by</span><span>{data.staffName}</span></div>
            )}
          </div>

          {data.vipFee > 0 && (
            <>
              <div className="border-t border-dashed border-gray-300 my-3" />
              <div className="flex justify-between font-bold">
                <span>VIP booking fee</span><span>{sym}{data.vipFee.toFixed(2)}</span>
              </div>
              {data.paymentMethod && (
                <div className="flex justify-between text-gray-500 capitalize mt-1">
                  <span>Paid by</span><span>{data.paymentMethod}</span>
                </div>
              )}
            </>
          )}

          {data.note.trim() && (
            <>
              <div className="border-t border-dashed border-gray-300 my-3" />
              <p className="text-gray-500"><span className="font-semibold text-gray-700">Note:</span> {data.note.trim()}</p>
            </>
          )}

          <div className="border-t border-dashed border-gray-300 my-3" />
          <p className="text-center text-gray-700 font-semibold">{RESERVATION_THANK_YOU}</p>
        </div>

        {/* ── Email receipt section ─────────────────────────── */}
        <div className="px-4 pb-2">
          <div className="border border-gray-200 rounded-xl p-3 space-y-2">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <Mail size={11} /> Email Receipt
            </p>
            {emailStatus === "sent" ? (
              <div className="flex items-center gap-2 text-green-600 text-xs font-semibold">
                <CheckCircle2 size={14} /> Receipt sent to {emailTo}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={emailTo}
                    onChange={(e) => { setEmailTo(e.target.value); setEmailStatus("idle"); }}
                    placeholder="customer@email.com"
                    type="email"
                    className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-gray-900 text-xs outline-none focus:border-orange-400 placeholder-gray-400"
                  />
                  <button
                    onClick={sendEmail}
                    disabled={!emailTo.trim() || emailStatus === "sending"}
                    className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0"
                  >
                    {emailStatus === "sending" ? (
                      <RefreshCw size={11} className="animate-spin" />
                    ) : (
                      <Mail size={11} />
                    )}
                    {emailStatus === "sending" ? "Sending…" : "Send"}
                  </button>
                </div>
                {/* Marketing consent — PECR: opt-out offered when the email is collected */}
                <label className="flex items-start gap-1.5 cursor-pointer select-none pt-1">
                  <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)}
                    className="w-3.5 h-3.5 accent-orange-500 mt-px shrink-0" />
                  <span className="text-[10px] text-gray-500">Customer agrees to receive offers &amp; news by email</span>
                </label>
                {emailStatus === "error" && (
                  <p className="text-red-500 text-[10px]">{emailError}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Print status ─────────────────────────────────────── */}
        {printStatus === "ok" && (
          <div className="mx-4 mb-2 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <CheckCircle2 size={13} className="text-green-600 shrink-0" />
            <p className="text-green-700 text-xs font-semibold">Receipt sent to printer.</p>
          </div>
        )}
        {noReceiptPrinter && (
          <InfoNote>
            {onAndroid
              ? `No receipt printer is set up. Set one up in ${settingsPath} to print receipts.`
              : `No receipt printer is set up, so nothing printed automatically. Tap PDF to save or print it from the browser, or set one up in ${settingsPath}.`}
          </InfoNote>
        )}
        {receiptAutoPrintOff && (
          <InfoNote>
            The {printerLabel} printer&apos;s Auto-print is off, so the receipt was not printed. Tap Print, or turn Auto-print on in {settingsPath}.
          </InfoNote>
        )}
        {printStatus === "error" && (
          <div className="mx-4 mb-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-red-700 text-xs break-all">{printError}</p>
              {!onAndroid && (
                <button onClick={handlePdf} className="text-red-600 text-xs font-semibold underline mt-0.5">
                  {printNoPrinter ? "Save as PDF instead" : "Print via browser instead"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Buttons ──────────────────────────────────────────── */}
        <div className={`px-4 pb-4 grid gap-2 mt-2 ${onAndroid ? "grid-cols-2" : "grid-cols-3"}`}>
          <button
            onClick={onClose}
            className="py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
          {!onAndroid && (
            <button
              onClick={handlePdf}
              title="Open the print window, then choose Save as PDF"
              className="py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
            >
              <FileDown size={14} /> PDF
            </button>
          )}
          <button
            onClick={handlePrint}
            disabled={printStatus === "printing"}
            className="py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {printStatus === "printing"
              ? <><RefreshCw size={14} className="animate-spin" /> Printing…</>
              : <><Printer size={14} /> Print</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Amber note (not an error). */
function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="mx-4 mb-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <Info size={13} className="text-amber-600 shrink-0 mt-0.5" />
      <p className="text-amber-800 text-xs break-words min-w-0">{children}</p>
    </div>
  );
}
