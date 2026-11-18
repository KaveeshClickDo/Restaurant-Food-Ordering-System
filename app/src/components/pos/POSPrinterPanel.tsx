"use client";

import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { buildTestReceipt, printReceiptBrowser } from "@/lib/escpos";
import { sendReceiptToPrinter } from "@/lib/posPrint";
import type { PrinterSettings } from "@/types";
import { findOtherCategoryPrintersAtSameAddress } from "@/lib/printerRecords";
import { Printer, Save, CheckCircle2, AlertTriangle, Loader2, Zap, CircleDot, Circle, Plus, Trash2 } from "lucide-react";

// Chars-per-line ↔ paper width. 48 = 80 mm (countertop), 32 = 58 mm (portable).
const PAPER_WIDTHS = [
  { value: 48, label: "80 mm", sub: "Countertop" },
  { value: 32, label: "58 mm", sub: "Portable" },
] as const;

const POS_CONNECTION_OPTIONS = [
  { value: "network"   as const, label: "Network / IP",  sub: "Printer on the same network" },
  { value: "bluetooth" as const, label: "Bluetooth",     sub: "Android app, works offline" },
  { value: "usb"       as const, label: "USB (direct)",  sub: "Printer plugged into this device" },
  { value: "browser"   as const, label: "Browser print", sub: "Any printer this device can see" },
] as const;

type POSConnectionMode = "network" | "bluetooth" | "usb" | "browser";

// One "pos"-category printer: edit, enable, select active, delete
function POSPrinterRow({ printer, isActive, onSetActive, onDelete }: {
  printer: PrinterSettings;
  isActive: boolean;
  onSetActive: () => void;
  onDelete: () => void;
}) {
  const { settings: appSettings, updatePrinterViaPos, togglePrinterEnabledViaPos } = useApp();

  const [draft, setDraft] = useState({
    name:             printer.name,
    autoPrint:        printer.autoPrint,
    connection:       (printer.connection ?? "network") as POSConnectionMode,
    ip:               printer.ip,
    port:             printer.port,
    bluetoothAddress: printer.bluetoothAddress ?? "",
    bluetoothName:    printer.bluetoothName    ?? "",
    paperWidth:       printer.paperWidth ?? 48,
  });
  const [testState,  setTestState]  = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [testError,  setTestError]  = useState("");
  const [saved,      setSaved]      = useState(false);
  const [btDevices,  setBtDevices]  = useState<import("@/lib/capacitorBridge").BluetoothDevice[]>([]);
  const [btScanning, setBtScanning] = useState(false);
  const [onAndroid,  setOnAndroid]  = useState(false);

  useEffect(() => {
    import("@/lib/capacitorBridge").then(({ isCapacitorAndroid }) => {
      const android = isCapacitorAndroid();
      setOnAndroid(android);
      // "Browser print" (window.print()) is a no-op in the Android WebView, so we
      // hide that option on the tablet. If a previous/default config selected it,
      // fall back to a real transport so the cashier isn't stuck on a dead mode.
      if (android) setDraft((d) => (d.connection === "browser" ? { ...d, connection: "network" } : d));
    });
  }, []);

  async function scanBluetooth() {
    setBtScanning(true);
    const { getBluetoothPairedDevices } = await import("@/lib/capacitorBridge");
    const devices = await getBluetoothPairedDevices();
    setBtDevices(devices);
    setBtScanning(false);
    if (devices.length === 0) setTestError("No paired devices found. Pair the printer in Android Settings first.");
  }

  function handleSave() {
    updatePrinterViaPos({ ...printer, ...draft });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function applyResult(result: { ok: boolean; error?: string }) {
    if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
    else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
  }

  async function handleTest() {
    setTestState("sending");
    setTestError("");

    const previewPrinter: PrinterSettings = { ...printer, ...draft };

    // Browser mode prints an HTML page, not a byte stream — separate path.
    if (draft.connection === "browser") {
      const dummyOrder = {
        id: "TEST-001", date: new Date().toISOString(),
        items: [{ name: "Test Item", qty: 1, price: 0 }],
        total: 0, fulfillment: "collection" as const,
        status: "pending" as const, customerId: "", paymentMethod: "Test",
      };
      applyResult(printReceiptBrowser(dummyOrder, appSettings, previewPrinter));
      return;
    }

    // Friendly pre-checks before we bother building the receipt.
    if (draft.connection === "network" && !draft.ip.trim()) {
      setTestState("error"); setTestError("Enter a printer IP address first."); return;
    }
    if (draft.connection === "bluetooth" && !draft.bluetoothAddress.trim()) {
      setTestState("error"); setTestError("Select a Bluetooth device first."); return;
    }

    // network / bluetooth / usb all go through the same native-first dispatcher,
    // so the test exercises the EXACT path a real receipt takes (incl. offline
    // direct-TCP / native USB on the Android app).
    const bytes = buildTestReceipt(appSettings, previewPrinter);
    applyResult(await sendReceiptToPrinter(bytes, previewPrinter));
  }

  const sharedWith = findOtherCategoryPrintersAtSameAddress(appSettings.printers, { ...printer, ...draft });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onSetActive}
            disabled={!printer.enabled}
            title={printer.enabled ? (isActive ? "Active — click to clear" : "Set as active") : "Enable this printer first"}
            className={`flex-shrink-0 transition ${printer.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-30"}`}
          >
            {isActive ? <CircleDot size={18} className="text-orange-400" /> : <Circle size={18} className="text-slate-500" />}
          </button>
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 truncate">
            <Printer size={16} className="text-slate-400 flex-shrink-0" /> {printer.name || "Receipt Printer"}
          </h3>
          {isActive && (
            <span className="text-[10px] bg-orange-500/20 text-orange-300 rounded-full px-2 py-0.5 font-semibold flex-shrink-0">Active</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => togglePrinterEnabledViaPos(printer.id, !printer.enabled)}
            className={`text-xs font-semibold px-2 py-0.5 rounded-full transition ${
              printer.enabled ? "bg-green-500/20 text-green-400" : "bg-slate-700 text-slate-400"
            }`}
          >{printer.enabled ? "Enabled" : "Disabled"}</button>
          <button
            onClick={() => { if (window.confirm(`Delete "${printer.name || "this printer"}"? This can't be undone.`)) onDelete(); }}
            title="Delete printer"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!printer.enabled && (
        <p className="text-slate-400 text-xs">Disabled — tap the badge above to enable it.</p>
      )}

      {/* Name */}
      <div>
        <label className="text-xs text-slate-400 mb-1 block">Printer name</label>
        <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Receipt Printer"
          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
      </div>

      {/* Connection type */}
      <div className="space-y-1.5">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Connection</p>
        {POS_CONNECTION_OPTIONS.filter((o) => !onAndroid || o.value !== "browser").map(({ value, label, sub }) => (
          <button key={value} onClick={() => setDraft((d) => ({ ...d, connection: value }))}
            className={`w-full text-left px-3 py-2.5 rounded-xl border transition text-sm ${
              draft.connection === value
                ? "border-orange-500 bg-orange-500/10 text-orange-300"
                : "border-slate-600 text-slate-300 hover:border-slate-500"
            }`}>
            <span className="font-semibold">{label}</span>
            <span className="text-xs text-slate-400 ml-2">{sub}</span>
          </button>
        ))}
      </div>

      {/* Paper width (applies to all thermal modes, not browser) */}
      {draft.connection !== "browser" && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Paper width</p>
          <div className="grid grid-cols-2 gap-2">
            {PAPER_WIDTHS.map(({ value, label, sub }) => (
              <button key={value} onClick={() => setDraft((d) => ({ ...d, paperWidth: value }))}
                className={`px-3 py-2.5 rounded-xl border transition text-sm text-left ${
                  draft.paperWidth === value
                    ? "border-orange-500 bg-orange-500/10 text-orange-300"
                    : "border-slate-600 text-slate-300 hover:border-slate-500"
                }`}>
                <span className="font-semibold">{label}</span>
                <span className="text-xs text-slate-400 ml-2">{sub}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Network IP fields */}
      {draft.connection === "network" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-slate-400 mb-1 block">Printer IP</label>
            <input value={draft.ip} onChange={(e) => setDraft((d) => ({ ...d, ip: e.target.value }))}
              placeholder="192.168.1.100"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm font-mono outline-none focus:border-orange-500 placeholder-slate-500" />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Port</label>
            <input type="number" value={draft.port} min={1} max={65535}
              onChange={(e) => setDraft((d) => ({ ...d, port: Number(e.target.value) }))}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-sm font-mono outline-none focus:border-orange-500" />
          </div>
        </div>
      )}

      {sharedWith.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-amber-300 text-xs">
            A Kitchen printer also uses this IP. If both are active, POS sales print twice.
            To print once, turn off Auto-print on this printer (it then stops printing automatically), or ask an admin to change the Kitchen printer.
          </p>
        </div>
      )}

      {/* Bluetooth device selector */}
      {draft.connection === "bluetooth" && (
        <div className="space-y-2">
          {draft.bluetoothAddress ? (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5">
              <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-green-300 text-xs font-semibold truncate">{draft.bluetoothName || "Unnamed device"}</p>
                <p className="text-green-500 text-[11px] font-mono">{draft.bluetoothAddress}</p>
              </div>
              <button onClick={() => setDraft((d) => ({ ...d, bluetoothAddress: "", bluetoothName: "" }))}
                className="text-slate-400 hover:text-red-400 text-xs transition">Clear</button>
            </div>
          ) : (
            <p className="text-slate-400 text-xs">No device selected.</p>
          )}

          {onAndroid ? (
            <>
              <button onClick={scanBluetooth} disabled={btScanning}
                className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                {btScanning ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : "Scan paired devices"}
              </button>
              {btDevices.length > 0 && (
                <div className="border border-slate-600 rounded-xl overflow-hidden divide-y divide-slate-700">
                  {btDevices.map((dev) => (
                    <button key={dev.address}
                      onClick={() => setDraft((d) => ({ ...d, bluetoothAddress: dev.address, bluetoothName: dev.name }))}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition ${
                        draft.bluetoothAddress === dev.address ? "bg-orange-500/10" : "hover:bg-slate-700"
                      }`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold truncate">{dev.name}</p>
                        <p className="text-slate-400 text-xs font-mono">{dev.address}</p>
                      </div>
                      {draft.bluetoothAddress === dev.address && <CheckCircle2 size={14} className="text-orange-400 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-slate-400 text-xs bg-slate-900 rounded-xl px-3 py-2.5">
              Bluetooth is only available in the <span className="text-orange-400 font-medium">Android app</span>. Use Network or Browser print on this device.
            </p>
          )}
        </div>
      )}

      {/* USB hint */}
      {draft.connection === "usb" && (
        <p className="text-xs text-slate-400">Chrome/Edge only. Click <span className="text-white font-medium">Test print</span> to select your USB printer. The browser will remember it.</p>
      )}

      {/* Browser hint */}
      {draft.connection === "browser" && (
        <p className="text-xs text-slate-400">Opens the browser print dialog. Allow pop-ups for this page. Set margins to None in the dialog.</p>
      )}

      {/* Auto-print */}
      <div className="flex items-center justify-between py-2 border-t border-slate-700">
        <div>
          <p className="text-sm font-semibold text-white">Auto-print</p>
          <p className="text-xs text-slate-400">Print automatically when a sale or order comes in</p>
        </div>
        <button
          onClick={() => setDraft((d) => ({ ...d, autoPrint: !d.autoPrint }))}
          className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${
            draft.autoPrint ? "bg-green-500" : "bg-slate-600"
          }`}
          aria-checked={draft.autoPrint}
          role="switch"
        >
          <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
            draft.autoPrint ? "translate-x-6" : "translate-x-1"
          }`} />
        </button>
      </div>

      {/* Test feedback */}
      {testState === "ok" && (
        <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2.5">
          <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
          <p className="text-green-400 text-xs font-semibold">Test page sent successfully!</p>
        </div>
      )}
      {testState === "error" && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400 text-xs break-all">{testError}</p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
            saved ? "bg-green-500/20 text-green-400" : "bg-orange-500 hover:bg-orange-400 text-white"
          }`}>
          {saved ? <><CheckCircle2 size={14} /> Saved</> : <><Save size={14} /> Save</>}
        </button>
        <button onClick={handleTest} disabled={testState === "sending"}
          className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
          {testState === "sending"
            ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
            : <><Zap size={14} /> Test print</>}
        </button>
      </div>
    </div>
  );
}

// Receipt / POS printers only — "kitchen" and "online" printers live in Admin → Integrations.
export default function POSPrinterPanel({ appSettings }: { appSettings: import("@/types").AdminSettings }) {
  const { addPrinterViaPos, removePrinterViaPos, setActivePrinterViaPos } = useApp();
  const posPrinters = appSettings.printers.filter((p) => p.category === "pos");
  const activeId = appSettings.activePrinterIdByCategory.pos;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <Printer size={16} className="text-slate-400" /> Receipt Printers
        </h3>
        <button onClick={addPrinterViaPos}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 text-xs font-bold transition">
          <Plus size={14} /> Add printer
        </button>
      </div>

      {posPrinters.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
          <p className="text-slate-400 text-xs">No receipt printer yet. Tap “Add printer” to set one up.</p>
        </div>
      ) : (
        posPrinters.map((printer) => (
          <POSPrinterRow
            key={printer.id}
            printer={printer}
            isActive={printer.id === activeId}
            onSetActive={() => setActivePrinterViaPos(printer.id === activeId ? null : printer.id)}
            onDelete={() => removePrinterViaPos(printer.id)}
          />
        ))
      )}
    </div>
  );
}
