"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { PaymentMethod, type AdminNotificationEvent, type AdminNotificationSettings } from "@/types";
import {
  Plug, Eye, EyeOff, CheckCircle, CreditCard, Wallet, Banknote,
  GripVertical, Pencil, X, Check, ChevronUp, ChevronDown,
  ToggleRight, ToggleLeft, Clock, ShieldAlert, History, Ruler,
  Printer, Wifi, WifiOff, AlertTriangle, Loader2, Mail, Send, Trash2,
} from "lucide-react";
import { buildTestReceipt, sendToPrinter, sendToPrinterBluetooth, sendToPrinterUSB, printReceiptBrowser } from "@/lib/escpos";
import { getBluetoothPairedDevices, isCapacitorAndroid, type BluetoothDevice } from "@/lib/capacitorBridge";
import { sendEmailViaApi } from "@/lib/emailTemplates";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const METHOD_ICONS: Record<string, React.ReactNode> = {
  stripe: <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center"><CreditCard size={18} className="text-white" /></div>,
  paypal: <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center"><Wallet size={18} className="text-white" /></div>,
  cash:   <div className="w-9 h-9 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center"><Banknote size={18} className="text-white" /></div>,
};

function getIcon(id: string) {
  return METHOD_ICONS[id] ?? (
    <div className="w-9 h-9 bg-gradient-to-br from-gray-400 to-gray-500 rounded-xl flex items-center justify-center">
      <CreditCard size={18} className="text-white" />
    </div>
  );
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-1 ${
        enabled ? "bg-green-500" : "bg-gray-300"
      }`}
      aria-checked={enabled}
      role="switch"
    >
      <span
        className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// ─── Inline edit row ─────────────────────────────────────────────────────────

function MethodRow({
  method, onToggle, onUpdate, onMoveUp, onMoveDown, isFirst, isLast,
}: {
  method: PaymentMethod;
  onToggle: () => void;
  onUpdate: (m: PaymentMethod) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: method.name,
    description: method.description,
    adminNote: method.adminNote,
    rangeRestricted: method.deliveryRange.restricted,
    rangeMin: method.deliveryRange.minKm,
    rangeMax: method.deliveryRange.maxKm,
  });

  function save() {
    onUpdate({
      ...method, ...draft,
      deliveryRange: { restricted: draft.rangeRestricted, minKm: draft.rangeMin, maxKm: draft.rangeMax },
    });
    setEditing(false);
  }

  function cancel() {
    setDraft({
      name: method.name,
      description: method.description,
      adminNote: method.adminNote,
      rangeRestricted: method.deliveryRange.restricted,
      rangeMin: method.deliveryRange.minKm,
      rangeMax: method.deliveryRange.maxKm,
    });
    setEditing(false);
  }

  return (
    <div className={`rounded-2xl border-2 transition-colors ${method.enabled ? "border-gray-100 bg-white" : "border-dashed border-gray-200 bg-gray-50/60"}`}>
      {/* Main row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Drag handle + reorder */}
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <button onClick={onMoveUp} disabled={isFirst} className="text-gray-300 hover:text-gray-500 disabled:opacity-20 disabled:cursor-not-allowed transition">
              <ChevronUp size={13} />
            </button>
            <GripVertical size={14} className="text-gray-300 mx-auto" />
            <button onClick={onMoveDown} disabled={isLast} className="text-gray-300 hover:text-gray-500 disabled:opacity-20 disabled:cursor-not-allowed transition">
              <ChevronDown size={13} />
            </button>
          </div>

          {/* Icon */}
          <div className={`flex-shrink-0 transition-opacity ${method.enabled ? "opacity-100" : "opacity-40"}`}>
            {getIcon(method.id)}
          </div>

          {/* Name + description */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <span className={`font-semibold text-sm ${method.enabled ? "text-gray-900" : "text-gray-400"}`}>
                {method.name}
              </span>
              {method.builtIn && (
                <span className="text-[10px] bg-gray-100 text-gray-400 rounded-full px-2 py-0.5 font-medium">Built-in</span>
              )}
            </div>
            <p className="text-xs text-gray-400 truncate mt-0.5">{method.description}</p>
            {method.adminNote && (
              <p className="text-[11px] text-orange-500 mt-0.5">📋 {method.adminNote}</p>
            )}
            {method.deliveryRange.restricted && (
              <p className="text-[11px] text-blue-500 mt-0.5 flex items-center gap-1">
                <Ruler size={10} /> {method.deliveryRange.minKm}–{method.deliveryRange.maxKm} km only
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-gray-100">
          {/* Status badge */}
          <div className="flex items-center gap-1.5">
            {method.enabled ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300" /> Disconnected
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Toggle enabled={method.enabled} onToggle={onToggle} />
            <button
              onClick={() => setEditing((v) => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-500 transition"
            >
              <Pencil size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Inline editor */}
      {editing && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 bg-gray-50/50 rounded-b-2xl space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Display name</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Customer description</label>
              <input
                type="text"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
                placeholder="Shown to customers at checkout"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Admin note <span className="font-normal text-gray-400">(internal only)</span></label>
            <input
              type="text"
              value={draft.adminNote}
              onChange={(e) => setDraft((d) => ({ ...d, adminNote: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 transition bg-white"
              placeholder="e.g. Pay on delivery, Pay in store…"
            />
          </div>
          {/* Delivery distance restriction */}
          <div className="border-t border-gray-200 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                <Ruler size={12} /> Delivery distance restriction
              </label>
              <button
                onClick={() => setDraft((d) => ({ ...d, rangeRestricted: !d.rangeRestricted }))}
                className={`transition-colors ${draft.rangeRestricted ? "text-blue-500" : "text-gray-300 hover:text-gray-400"}`}
              >
                {draft.rangeRestricted ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
              </button>
            </div>
            {draft.rangeRestricted && (
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Min km</span>
                  <input
                    type="number" min="0" step="0.5" max={draft.rangeMax}
                    value={draft.rangeMin}
                    onChange={(e) => setDraft((d) => ({ ...d, rangeMin: Number(e.target.value) }))}
                    className="w-10 sm:w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
                  />
                </div>
                <span className="text-gray-300">—</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Max km</span>
                  <input
                    type="number" min={draft.rangeMin} step="0.5"
                    value={draft.rangeMax}
                    onChange={(e) => setDraft((d) => ({ ...d, rangeMax: Number(e.target.value) }))}
                    className="w-10 sm:w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
                  />
                </div>
                <span className="text-xs text-gray-400">km from restaurant</span>
              </div>
            )}
            {!draft.rangeRestricted && (
              <p className="text-xs text-gray-400">Available at all delivery distances.</p>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2 rounded-xl transition"
            >
              <Check size={13} /> Save
            </button>
            <button
              onClick={cancel}
              className="flex items-center gap-1.5 border border-gray-200 text-gray-500 hover:text-gray-700 text-xs font-semibold px-3 py-2 rounded-xl transition"
            >
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Payment Methods Tab ──────────────────────────────────────────────────────

function PaymentMethodsTab() {
  const { settings, togglePaymentMethod, updatePaymentMethod, reorderPaymentMethods } = useApp();
  const methods = [...settings.paymentMethods].sort((a, b) => a.order - b.order);
  const auditLog = settings.paymentAuditLog ?? [];
  const activeCount = methods.filter((m) => m.enabled).length;

  function move(index: number, dir: -1 | 1) {
    const next = [...methods];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    reorderPaymentMethods(next.map((m, i) => ({ ...m, order: i })));
  }

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px] bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <ToggleRight size={20} className="text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
            <p className="text-xs text-gray-400">of {methods.length} methods active</p>
          </div>
        </div>

        {activeCount === 0 && (
          <div className="flex-1 min-w-[240px] flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
            <ShieldAlert size={20} className="text-red-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-700">No active payment methods</p>
              <p className="text-xs text-red-500 mt-0.5">Customers cannot complete checkout. Enable at least one method.</p>
            </div>
          </div>
        )}
      </div>

      {/* Method list */}
      <div className="space-y-3">
        {methods.map((method, index) => (
          <MethodRow
            key={method.id}
            method={method}
            onToggle={() => togglePaymentMethod(method.id, !method.enabled)}
            onUpdate={updatePaymentMethod}
            onMoveUp={() => move(index, -1)}
            onMoveDown={() => move(index, 1)}
            isFirst={index === 0}
            isLast={index === methods.length - 1}
          />
        ))}
      </div>

      {/* Audit log */}
      {auditLog.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
            <History size={15} className="text-gray-400" />
            <h3 className="font-semibold text-gray-900 text-sm">Audit log</h3>
            <span className="ml-auto text-xs text-gray-400">Last {auditLog.length} change{auditLog.length !== 1 ? "s" : ""}</span>
          </div>
          <ul className="divide-y divide-gray-50">
            {auditLog.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                <Clock size={13} className="text-gray-300 flex-shrink-0" />
                <span className="text-sm text-gray-700 flex-1">{entry.action}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">{fmtTs(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── API Keys & Email Tab ─────────────────────────────────────────────────────

function EnvVarRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex flex-wrap items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <code className="text-xs font-mono font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-lg whitespace-nowrap flex-shrink-0 mt-0.5">
        {name}
      </code>
      <p className="text-sm text-gray-500">{description}</p>
    </div>
  );
}

function ApiKeysTab() {
  const { settings, updateSettings } = useApp();
  const [saved, setSaved] = useState(false);
  const [showPub, setShowPub] = useState(false);

  return (
    <div className="space-y-5">
      {/* Security notice */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
        <ShieldAlert size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-800 text-sm">Sensitive credentials use environment variables</p>
          <p className="text-amber-700 text-xs mt-1 leading-relaxed">
            SMTP passwords, Stripe secret keys, and PayPal credentials are configured as
            server-side environment variables — they are never stored in the database or sent to
            the browser. Set them in your <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code> file
            (or your deployment platform&apos;s environment variables panel) and restart the server.
          </p>
        </div>
      </div>

      {/* Env var reference */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Required environment variables</h3>
          <p className="text-xs text-gray-400 mt-0.5">Add these to <code className="font-mono">.env.local</code> — never commit them to source control.</p>
        </div>
        <div className="px-5 divide-y divide-gray-50">
          <EnvVarRow name="SMTP_HOST"            description="SMTP server hostname (e.g. smtp.gmail.com)" />
          <EnvVarRow name="SMTP_PORT"            description="SMTP port — 587 for STARTTLS (default), 465 for SSL" />
          <EnvVarRow name="SMTP_USER"            description="SMTP username / sender address" />
          <EnvVarRow name="SMTP_PASS"            description="SMTP password or app-specific password" />
          <EnvVarRow name="STRIPE_SECRET_KEY"             description="Stripe secret key (sk_live_… or sk_test_…)" />
          <EnvVarRow name="STRIPE_WEBHOOK_SECRET"         description="Webhook signing secret (whsec_…) from Stripe Dashboard → Webhooks" />
          <EnvVarRow name="NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" description="Stripe publishable key (pk_live_… or pk_test_…) — public, sent to the browser" />
          <EnvVarRow name="APPLE_PAY_DOMAIN_ASSOCIATION"      description="Apple Pay domain verification file contents (optional)" />
          <EnvVarRow name="NEXT_PUBLIC_PAYPAL_CLIENT_ID"      description="PayPal REST API client ID — public, sent to the browser" />
          <EnvVarRow name="PAYPAL_CLIENT_SECRET"              description="PayPal REST API secret — server-side only" />
          <EnvVarRow name="PAYPAL_WEBHOOK_ID"                 description="PayPal webhook ID from Developer Dashboard → Webhooks" />
          <EnvVarRow name="PAYPAL_ENV"                        description="PayPal environment — 'sandbox' for testing, 'live' for production" />
          <EnvVarRow name="SUPABASE_SERVICE_ROLE_KEY"         description="Supabase service-role key — used by server API routes only" />
        </div>
      </div>

      {/* Stripe public key — safe to store in DB */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">Stripe publishable key</h3>
          <p className="text-xs text-gray-400 mt-0.5">This key is public by design and safe to store in settings.</p>
        </div>
        <div className="p-5">
          <div className="relative">
            <input
              type={showPub ? "text" : "password"}
              value={settings.stripePublicKey}
              onChange={(e) => updateSettings({ stripePublicKey: e.target.value })}
              placeholder="pk_live_…"
              className="w-full px-4 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
            <button
              type="button"
              onClick={() => setShowPub((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
            >
              {showPub ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button
            onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2500); }}
            className={`mt-3 flex items-center gap-2 px-5 py-2 rounded-xl font-semibold text-sm transition-all ${
              saved ? "bg-green-100 text-green-700" : "bg-orange-500 hover:bg-orange-600 text-white"
            }`}
          >
            {saved ? <><CheckCircle size={15} /> Saved!</> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Thermal Printer Tab ──────────────────────────────────────────────────────

type TestState = "idle" | "connecting" | "success" | "error";

const CONNECTION_OPTIONS = [
  {
    value: "network" as const,
    label: "Network / IP",
    sub: "ESC/POS over TCP — Epson, Star, Citizen (same LAN as server)",
  },
  {
    value: "bluetooth" as const,
    label: "Bluetooth",
    sub: "Classic BT (SPP) — Android app only, works fully offline",
  },
  {
    value: "usb" as const,
    label: "USB (direct)",
    sub: "Web USB API — printer plugged into this device (Chrome/Edge only)",
  },
  {
    value: "browser" as const,
    label: "Browser print",
    sub: "window.print() — any printer the OS can see (USB, Bluetooth, network)",
  },
] as const;

type ConnectionMode = "network" | "bluetooth" | "usb" | "browser";

function PrinterTab() {
  const { settings, updateSettings } = useApp();
  const p = settings.printer;

  const [draft, setDraft] = useState({
    enabled:          p.enabled,
    name:             p.name,
    connection:       (p.connection ?? "network") as ConnectionMode,
    ip:               p.ip,
    port:             p.port,
    bluetoothAddress: p.bluetoothAddress ?? "",
    bluetoothName:    p.bluetoothName    ?? "",
    autoPrint:        p.autoPrint,
    paperWidth:       p.paperWidth,
  });
  const [saved,      setSaved]      = useState(false);
  const [testState,  setTestState]  = useState<TestState>("idle");
  const [testError,  setTestError]  = useState("");
  const [btDevices,  setBtDevices]  = useState<BluetoothDevice[]>([]);
  const [btScanning, setBtScanning] = useState(false);
  const onAndroid = isCapacitorAndroid();

  async function scanBluetooth() {
    setBtScanning(true);
    const devices = await getBluetoothPairedDevices();
    setBtDevices(devices);
    setBtScanning(false);
    if (devices.length === 0) setTestError("No paired Bluetooth devices found. Pair the printer in Android Settings first.");
  }

  function handleSave() {
    updateSettings({ printer: { ...p, ...draft } });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleTest() {
    setTestState("connecting");
    setTestError("");

    const previewSettings = { ...settings, printer: { ...p, ...draft } };

    if (draft.connection === "network") {
      if (!draft.ip.trim()) {
        setTestState("error");
        setTestError("Enter a printer IP address before testing.");
        return;
      }
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendToPrinter(bytes, draft.ip.trim(), draft.port, "/api/admin/print");
      if (result.ok) { setTestState("success"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    if (draft.connection === "bluetooth") {
      if (!draft.bluetoothAddress.trim()) {
        setTestState("error");
        setTestError("Select a paired Bluetooth device below before testing.");
        return;
      }
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendToPrinterBluetooth(bytes, draft.bluetoothAddress);
      if (result.ok) { setTestState("success"); setTimeout(() => setTestState("idle"), 5000); }
      else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
      return;
    }

    if (draft.connection === "usb") {
      const bytes  = buildTestReceipt(previewSettings);
      const result = await sendToPrinterUSB(bytes);
      if (result.ok) { setTestState("success"); setTimeout(() => setTestState("idle"), 5000); }
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
    if (result.ok) { setTestState("success"); setTimeout(() => setTestState("idle"), 5000); }
    else           { setTestState("error"); setTestError(result.error ?? "Unknown error"); }
  }

  const isConfigured =
    draft.connection === "network"    ? Boolean(draft.ip.trim()) :
    draft.connection === "bluetooth"  ? Boolean(draft.bluetoothAddress.trim()) : true;

  const statusLabel = !draft.enabled
    ? "Disabled"
    : draft.connection === "network"
    ? isConfigured ? `${draft.ip}:${draft.port}` : "No IP configured"
    : draft.connection === "bluetooth"
    ? isConfigured ? draft.bluetoothName || draft.bluetoothAddress : "No device selected"
    : draft.connection === "usb" ? "USB (Web USB)" : "Browser print";

  return (
    <div className="space-y-5">
      {/* Status card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
          draft.enabled && isConfigured ? "bg-green-50" : "bg-gray-100"
        }`}>
          <Printer size={22} className={draft.enabled && isConfigured ? "text-green-600" : "text-gray-400"} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm">{draft.name || "Thermal Printer"}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {draft.enabled && isConfigured
              ? `${statusLabel} — auto-print ${draft.autoPrint ? "on" : "off"}`
              : statusLabel}
          </p>
        </div>
        <div className="flex-shrink-0">
          {draft.enabled && isConfigured ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
              <Wifi size={11} /> Ready
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-1">
              <WifiOff size={11} /> Offline
            </span>
          )}
        </div>
      </div>

      {/* Configuration form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex gap-2 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-50 rounded-xl flex items-center justify-center">
              <Printer size={15} className="text-orange-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Printer settings</h3>
              <p className="text-xs text-gray-400">Network, Bluetooth, USB, or browser print</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:flex text-xs text-gray-500 font-medium">{draft.enabled ? "Enabled" : "Disabled"}</span>
            <button
              onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
              className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors focus:outline-none ${
                draft.enabled ? "bg-green-500" : "bg-gray-300"
              }`}
              aria-checked={draft.enabled}
              role="switch"
            >
              <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                draft.enabled ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Connection type */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Connection type</p>
            <div className="space-y-2">
              {CONNECTION_OPTIONS.map(({ value, label, sub }) => (
                <button
                  key={value}
                  onClick={() => setDraft((d) => ({ ...d, connection: value }))}
                  className={`w-full text-left px-4 py-3 rounded-xl border-2 transition ${
                    draft.connection === value
                      ? "border-orange-500 bg-orange-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className={`text-sm font-bold ${draft.connection === value ? "text-orange-600" : "text-gray-700"}`}>{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Network fields */}
          {draft.connection === "network" && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Network</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Printer IP address</label>
                  <input type="text" value={draft.ip}
                    onChange={(e) => setDraft((d) => ({ ...d, ip: e.target.value }))}
                    placeholder="192.168.1.100"
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Set a static IP on your printer to prevent address changes</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">TCP port</label>
                  <input type="number" value={draft.port} min={1} max={65535}
                    onChange={(e) => setDraft((d) => ({ ...d, port: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Default: 9100</p>
                </div>
              </div>
            </div>
          )}

          {/* Bluetooth device selector */}
          {draft.connection === "bluetooth" && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Bluetooth device</p>
              {draft.bluetoothAddress ? (
                <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl mb-3">
                  <CheckCircle size={15} className="text-green-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-700 truncate">{draft.bluetoothName || "Unnamed device"}</p>
                    <p className="text-xs text-green-600 font-mono">{draft.bluetoothAddress}</p>
                  </div>
                  <button onClick={() => setDraft((d) => ({ ...d, bluetoothAddress: "", bluetoothName: "" }))}
                    className="text-xs text-gray-400 hover:text-red-500 transition">Clear</button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 mb-3">No device selected. Scan for paired devices below.</p>
              )}

              {onAndroid ? (
                <>
                  <button onClick={scanBluetooth} disabled={btScanning}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 mb-3">
                    {btScanning ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : "Scan paired devices"}
                  </button>
                  {btDevices.length > 0 && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                      {btDevices.map((dev) => (
                        <button key={dev.address}
                          onClick={() => setDraft((d) => ({ ...d, bluetoothAddress: dev.address, bluetoothName: dev.name }))}
                          className={`w-full text-left px-4 py-3 flex items-center gap-3 transition hover:bg-gray-50 ${
                            draft.bluetoothAddress === dev.address ? "bg-orange-50" : ""
                          }`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">{dev.name}</p>
                            <p className="text-xs text-gray-400 font-mono">{dev.address}</p>
                          </div>
                          {draft.bluetoothAddress === dev.address && <CheckCircle size={14} className="text-orange-500 flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-amber-700">Android app required</p>
                  <p className="text-xs text-amber-600 mt-0.5">Bluetooth printing is only available in the Android Capacitor app. On this device, use Network or Browser print mode.</p>
                </div>
              )}
            </div>
          )}

          {/* USB info */}
          {draft.connection === "usb" && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-blue-700">Web USB requirements</p>
              <ul className="text-xs text-blue-600 space-y-0.5 list-disc list-inside">
                <li>Requires Google Chrome or Microsoft Edge (Firefox/Safari not supported)</li>
                <li>Printer must be connected via USB to this device</li>
                <li>Click &quot;Print test page&quot; below to select your USB printer for the first time</li>
                <li>The browser will remember the device for future prints</li>
              </ul>
            </div>
          )}

          {/* Browser print info */}
          {draft.connection === "browser" && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-blue-700">Browser print notes</p>
              <ul className="text-xs text-blue-600 space-y-0.5 list-disc list-inside">
                <li>Opens the browser&apos;s built-in print dialog</li>
                <li>Works with any printer the OS can see — USB, Bluetooth, or network</li>
                <li>Allow pop-ups for this site if the dialog does not appear</li>
                <li>Set &quot;Margins: None&quot; and disable headers/footers for clean receipts</li>
              </ul>
            </div>
          )}

          {/* Identity */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Identity</p>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Printer name <span className="font-normal text-gray-400">(admin label)</span></label>
              <input type="text" value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Kitchen Printer"
                className="w-full sm:max-w-xs px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
              />
            </div>
          </div>

          {/* Paper */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Paper size</p>
            <div className="flex gap-3">
              {([
                { value: 48, label: "80 mm", sub: "48 chars / line — most common" },
                { value: 32, label: "58 mm", sub: "32 chars / line — compact" },
              ] as const).map(({ value, label, sub }) => (
                <button key={value} onClick={() => setDraft((d) => ({ ...d, paperWidth: value }))}
                  className={`flex-1 text-left px-4 py-3 rounded-xl border-2 transition ${
                    draft.paperWidth === value ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:border-gray-300"
                  }`}>
                  <p className={`text-sm font-bold ${draft.paperWidth === value ? "text-orange-600" : "text-gray-700"}`}>{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Auto-print */}
          <div className="flex items-center justify-between py-3 border-t border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-800">Auto-print on new order</p>
              <p className="text-xs text-gray-400 mt-0.5">Automatically send a receipt when a customer places an order</p>
            </div>
            <button onClick={() => setDraft((d) => ({ ...d, autoPrint: !d.autoPrint }))}
              className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${
                draft.autoPrint ? "bg-green-500" : "bg-gray-300"
              }`} aria-checked={draft.autoPrint} role="switch">
              <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                draft.autoPrint ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </div>

          {/* Save */}
          <button onClick={handleSave}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              saved ? "bg-green-100 text-green-700" : "bg-orange-500 hover:bg-orange-600 text-white"
            }`}>
            {saved ? <><CheckCircle size={15} /> Saved!</> : "Save settings"}
          </button>
        </div>
      </div>

      {/* Test print */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
            <Printer size={15} className="text-blue-500" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-sm">Test connection</h3>
            <p className="text-xs text-gray-400">Send a test page to verify connectivity and receipt formatting</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {testState === "success" && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-700">Test page sent successfully!</p>
                <p className="text-xs text-green-600 mt-0.5">Your printer is connected and working correctly.</p>
              </div>
            </div>
          )}
          {testState === "error" && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">Print failed</p>
                <p className="text-xs text-red-500 mt-0.5 break-all">{testError}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={handleTest} disabled={testState === "connecting"}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-gray-900 hover:bg-gray-800 text-white transition disabled:opacity-60 disabled:cursor-not-allowed">
              {testState === "connecting"
                ? <><Loader2 size={15} className="animate-spin" /> Sending…</>
                : <><Printer size={15} /> Print test page</>}
            </button>
            {testState !== "idle" && testState !== "connecting" && (
              <button onClick={() => { setTestState("idle"); setTestError(""); }}
                className="text-xs text-gray-400 hover:text-gray-600 transition">Dismiss</button>
            )}
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-gray-600">Troubleshooting tips</p>
            {draft.connection === "network" && (
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
                <li>Printer and server must be on the same network/VLAN</li>
                <li>Default port for most thermal printers is <span className="font-mono">9100</span></li>
                <li>Set a static IP on the printer to prevent address changes</li>
                <li>Check the printer is powered on and not in error or sleep state</li>
              </ul>
            )}
            {draft.connection === "bluetooth" && (
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
                <li>Pair the printer first in Android Settings → Bluetooth</li>
                <li>Ensure the printer is in Bluetooth pairing/discoverable mode</li>
                <li>Classic Bluetooth (SPP) is required — BLE-only printers won&apos;t work</li>
                <li>Only available in the Android Capacitor app</li>
              </ul>
            )}
            {draft.connection === "usb" && (
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
                <li>Only works in Chrome or Edge — not Firefox or Safari</li>
                <li>Connect the printer via USB before clicking the test button</li>
                <li>If the interface claim fails, try unplugging and replugging the USB cable</li>
              </ul>
            )}
            {draft.connection === "browser" && (
              <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
                <li>Allow pop-ups for this site if the print dialog does not appear</li>
                <li>Set Margins to None and disable headers/footers in the print dialog</li>
                <li>Select your thermal printer from the destination list</li>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Admin Emails Tab ─────────────────────────────────────────────────────────
// Internal alerts sent TO the restaurant when something happens on the customer
// site. Unlike the customer emails in Admin → Email Templates these have no
// editable template — the body is a fixed summary built server-side in
// lib/adminNotifications.ts. Online activity only: POS and waiter orders never
// notify, since staff are already in the building.

const NOTIFICATION_EVENTS: Array<{
  id: AdminNotificationEvent;
  label: string;
  description: string;
}> = [
  {
    id: "new_online_order",
    label: "New online order",
    description: "A customer places an order on the website — card, PayPal or cash.",
  },
  {
    id: "new_online_reservation",
    label: "New online reservation",
    description: "A guest books a table through the website booking page.",
  },
  {
    id: "order_cancelled_refunded",
    label: "Order cancelled or refunded",
    description: "An online order is cancelled from admin or the kitchen screen, or a refund is issued.",
  },
  {
    id: "gift_card_purchased",
    label: "Gift card purchased online",
    description: "A customer buys a gift card on the website. Cards you issue from admin or POS never notify.",
  },
];

const EMPTY_NOTIFICATIONS: AdminNotificationSettings = {
  enabled: false,
  recipients: [],
  events: {
    new_online_order: false, new_online_reservation: false,
    order_cancelled_refunded: false, gift_card_purchased: false,
  },
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function AdminEmailsTab() {
  const { settings, updateSettings } = useApp();
  const stored = settings.adminNotifications ?? EMPTY_NOTIFICATIONS;

  const [draft, setDraft] = useState<AdminNotificationSettings>({
    enabled:    stored.enabled,
    recipients: [...stored.recipients],
    events:     { ...EMPTY_NOTIFICATIONS.events, ...stored.events },
  });
  const [entry,    setEntry]    = useState("");
  const [entryErr, setEntryErr] = useState("");
  const [saved,    setSaved]    = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testMsg,  setTestMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  const activeEvents = NOTIFICATION_EVENTS.filter((e) => draft.events[e.id]).length;
  // What the server actually requires before anything sends.
  const willSend = draft.enabled && draft.recipients.length > 0 && activeEvents > 0;

  function addRecipient() {
    const value = entry.trim().toLowerCase();
    if (!value) return;
    if (!isValidEmail(value)) { setEntryErr("That doesn't look like an email address."); return; }
    if (draft.recipients.includes(value)) { setEntryErr("Already on the list."); return; }
    if (draft.recipients.length >= 10) { setEntryErr("Maximum 10 recipients."); return; }
    setDraft((d) => ({ ...d, recipients: [...d.recipients, value] }));
    setEntry("");
    setEntryErr("");
  }

  function removeRecipient(email: string) {
    setDraft((d) => ({ ...d, recipients: d.recipients.filter((r) => r !== email) }));
  }

  function handleSave() {
    updateSettings({ adminNotifications: draft });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  // Reuses the admin-only /api/admin/email relay (same endpoint the Email
  // Templates panel uses for its test send). A 503 from there is also how we
  // surface "no RESEND_API_KEY / SMTP_HOST configured" without a new endpoint.
  async function handleTest() {
    const to = draft.recipients[0];
    if (!to) return;
    setTesting(true);
    setTestMsg(null);
    const result = await sendEmailViaApi({
      to,
      subject: `Test notification — ${settings.restaurant?.name ?? "Restaurant"}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
               <h2 style="margin:0 0 8px">Admin notifications are working</h2>
               <p style="color:#555;font-size:14px;margin:0">
                 If you can read this, alerts for the events you ticked will reach this inbox.
               </p>
             </div>`,
    });
    setTesting(false);
    setTestMsg(result.ok
      ? { ok: true,  text: `Test email sent to ${to}.` }
      : { ok: false, text: result.error ?? "Send failed." });
  }

  return (
    <div className="space-y-5">
      {/* Status card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${willSend ? "bg-green-50" : "bg-gray-100"}`}>
          <Mail size={22} className={willSend ? "text-green-600" : "text-gray-400"} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm">Staff notifications</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {willSend
              ? `${draft.recipients.length} recipient${draft.recipients.length === 1 ? "" : "s"} · ${activeEvents} event${activeEvents === 1 ? "" : "s"} enabled`
              : "Nothing is being sent"}
          </p>
        </div>
        <button
          onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
          className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors flex-shrink-0 ${draft.enabled ? "bg-green-500" : "bg-gray-300"}`}
          aria-checked={draft.enabled}
          role="switch"
        >
          <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${draft.enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      {/* Privacy notice — app_settings is readable by the anon key on every page */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
        <ShieldAlert size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-800 text-sm">Use a business address, not a personal one</p>
          <p className="text-amber-700 text-xs mt-1 leading-relaxed">
            These addresses are stored in the shared settings record, which the public site reads to
            render the storefront — so they can be seen by visitors. Prefer a role address like
            <code className="font-mono bg-amber-100 px-1 rounded mx-1">orders@yourdomain.com</code>
            over a personal inbox.
          </p>
        </div>
      </div>

      {/* Recipients */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-sm">Who gets notified</h3>
          <p className="text-xs text-gray-400 mt-0.5">Up to 10 addresses. Every enabled event goes to all of them.</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={entry}
              onChange={(e) => { setEntry(e.target.value); setEntryErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
              placeholder="orders@yourdomain.com"
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
            <button
              onClick={addRecipient}
              className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-gray-900 hover:bg-gray-800 text-white transition flex-shrink-0"
            >
              Add
            </button>
          </div>
          {entryErr && <p className="text-xs text-red-500">{entryErr}</p>}

          {draft.recipients.length === 0 ? (
            <p className="text-xs text-gray-400">No recipients yet — add at least one address for notifications to send.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {draft.recipients.map((email) => (
                <span key={email} className="inline-flex items-center gap-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-full pl-3 pr-1.5 py-1.5">
                  {email}
                  <button
                    onClick={() => removeRecipient(email)}
                    className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-red-100 hover:text-red-600 text-gray-400 transition"
                    aria-label={`Remove ${email}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Events */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900 text-sm">What to notify about</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Website activity only — orders rung up on the POS or by waiters never send an email.
          </p>
        </div>
        <div className="divide-y divide-gray-50">
          {NOTIFICATION_EVENTS.map(({ id, label, description }) => (
            <label key={id} className="flex items-start gap-3 px-6 py-4 cursor-pointer hover:bg-gray-50/60 transition">
              <input
                type="checkbox"
                checked={!!draft.events[id]}
                onChange={(e) => setDraft((d) => ({ ...d, events: { ...d.events, [id]: e.target.checked } }))}
                className="mt-0.5 w-4 h-4 accent-orange-500 flex-shrink-0"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-800">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Save + test */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        {draft.enabled && !willSend && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Notifications are on but nothing will send —
              {draft.recipients.length === 0 && " add a recipient."}
              {draft.recipients.length > 0 && activeEvents === 0 && " tick at least one event."}
            </p>
          </div>
        )}

        {testMsg && (
          <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${testMsg.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            {testMsg.ok
              ? <CheckCircle size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
              : <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />}
            <p className={`text-xs ${testMsg.ok ? "text-green-700" : "text-red-600"} break-all`}>{testMsg.text}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              saved ? "bg-green-100 text-green-700" : "bg-orange-500 hover:bg-orange-600 text-white"
            }`}
          >
            {saved ? <><CheckCircle size={15} /> Saved!</> : "Save settings"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || draft.recipients.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <><Send size={15} /> Send test email</>}
          </button>
          {draft.recipients.length > 0 && (
            <span className="text-xs text-gray-400">Test goes to {draft.recipients[0]}</span>
          )}
        </div>
        <p className="text-[11px] text-gray-400">
          Sending requires <code className="font-mono">RESEND_API_KEY</code> or <code className="font-mono">SMTP_HOST</code> to be
          configured — see the API Keys &amp; Email tab. The test button reports if they are missing.
        </p>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function IntegrationsPanel() {
  const [tab, setTab] = useState<"payments" | "api" | "printer" | "notifications">("payments");

  return (
    <div className="space-y-5">
      {/* Panel header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
            <Plug size={18} className="text-purple-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Integrations</h2>
            <p className="text-xs text-gray-400">Payment methods, API credentials, printer and staff alerts</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-100 px-6 overflow-x-auto scrollbar-hide">
          {([
            { id: "payments",      label: "Payment Methods", icon: <CreditCard size={14} /> },
            { id: "api",           label: "API Keys & Email", icon: <Plug size={14} /> },
            { id: "printer",       label: "Thermal Printer",  icon: <Printer size={14} /> },
            { id: "notifications", label: "Admin Emails",     icon: <Mail size={14} /> },
          ] as const).map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-1 py-3.5 mr-6 text-sm font-medium border-b-2 flex-shrink-0 transition-all ${
                tab === id
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-gray-400 hover:text-gray-700"
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "payments"      && <PaymentMethodsTab />}
      {tab === "api"           && <ApiKeysTab />}
      {tab === "printer"       && <PrinterTab />}
      {tab === "notifications" && <AdminEmailsTab />}
    </div>
  );
}
