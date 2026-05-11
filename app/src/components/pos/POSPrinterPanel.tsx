"use client";

import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { buildTestReceipt, sendToPrinter, sendToPrinterUSB, printReceiptBrowser } from "@/lib/escpos";
import { Printer, Save, CheckCircle2, AlertTriangle, Loader2, Zap } from "lucide-react";

const POS_CONNECTION_OPTIONS = [
  { value: "network"   as const, label: "Network / IP",  sub: "ESC/POS over TCP — same LAN as server" },
  { value: "bluetooth" as const, label: "Bluetooth",     sub: "Classic BT (SPP) — Android app, works offline" },
  { value: "usb"       as const, label: "USB (direct)",  sub: "Web USB — printer plugged into this device" },
  { value: "browser"   as const, label: "Browser print", sub: "window.print() — any OS-visible printer" },
] as const;

type POSConnectionMode = "network" | "bluetooth" | "usb" | "browser";

export default function POSPrinterPanel({ appSettings }: { appSettings: import("@/types").AdminSettings }) {
  const { updateSettings } = useApp();
  const p = appSettings.printer;

  const [draft, setDraft] = useState({
    connection:       (p.connection ?? "network") as POSConnectionMode,
    ip:               p.ip,
    port:             p.port,
    bluetoothAddress: p.bluetoothAddress ?? "",
    bluetoothName:    p.bluetoothName    ?? "",
  });
  const [testState,  setTestState]  = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [testError,  setTestError]  = useState("");
  const [saved,      setSaved]      = useState(false);
  const [btDevices,  setBtDevices]  = useState<import("@/lib/capacitorBridge").BluetoothDevice[]>([]);
  const [btScanning, setBtScanning] = useState(false);
  const [onAndroid,  setOnAndroid]  = useState(false);

  useEffect(() => {
    import("@/lib/capacitorBridge").then(({ isCapacitorAndroid }) => {
      setOnAndroid(isCapacitorAndroid());
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
    updateSettings({ printer: { ...p, ...draft } });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleTest() {
    setTestState("sending");
    setTestError("");

    const previewSettings = { ...appSettings, printer: { ...p, ...draft } };

    if (draft.connection === "network") {
      if (!draft.ip.trim()) { setTestState("error"); setTestError("Enter a printer IP address first."); return; }
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendToPrinter(bytes, draft.ip.trim(), draft.port);
      if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    if (draft.connection === "bluetooth") {
      if (!draft.bluetoothAddress.trim()) { setTestState("error"); setTestError("Select a Bluetooth device first."); return; }
      const { sendBluetooth } = await import("@/lib/capacitorBridge");
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendBluetooth(draft.bluetoothAddress, bytes);
      if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    if (draft.connection === "usb") {
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendToPrinterUSB(bytes);
      if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    // browser
    const dummyOrder = {
      id: "TEST-001", date: new Date().toISOString(),
      items: [{ name: "Test Item", qty: 1, price: 0 }],
      total: 0, fulfillment: "collection" as const,
      status: "pending" as const, customerId: "", paymentMethod: "Test",
    };
    const result = printReceiptBrowser(dummyOrder, previewSettings);
    if (result.ok) { setTestState("ok"); setTimeout(() => setTestState("idle"), 5000); }
    else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm flex items-center gap-2">
          <Printer size={16} className="text-slate-400" /> Receipt Printer
        </h3>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          p.enabled ? "bg-green-500/20 text-green-400" : "bg-slate-700 text-slate-400"
        }`}>{p.enabled ? "Enabled" : "Disabled"}</span>
      </div>

      {!p.enabled && (
        <p className="text-slate-400 text-xs">
          Printer is disabled. Enable it in{" "}
          <span className="text-orange-400 font-medium">Admin → Integrations → Thermal Printer</span>.
        </p>
      )}

      {/* Connection type */}
      <div className="space-y-1.5">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Connection</p>
        {POS_CONNECTION_OPTIONS.map(({ value, label, sub }) => (
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
