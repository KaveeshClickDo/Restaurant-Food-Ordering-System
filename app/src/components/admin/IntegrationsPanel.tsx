"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { PaymentMethod } from "@/types";
import {
  Plug, Eye, EyeOff, CheckCircle, CreditCard, Wallet, Banknote,
  GripVertical, Pencil, X, Check, ChevronUp, ChevronDown,
  ToggleRight, ToggleLeft, Clock, ShieldAlert, History, Ruler,
  Printer, Wifi, WifiOff, AlertTriangle, Loader2,
} from "lucide-react";
import { buildTestReceipt, sendToPrinter } from "@/lib/escpos";

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
      <div className="flex items-center gap-3 px-4 py-3.5">
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
        <div className="flex-1 min-w-0">
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

        {/* Status badge */}
        <div className="flex-shrink-0 hidden sm:flex items-center gap-1.5">
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <Toggle enabled={method.enabled} onToggle={onToggle} />
          <button
            onClick={() => setEditing((v) => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-orange-100 hover:text-orange-600 text-gray-500 transition"
          >
            <Pencil size={13} />
          </button>
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
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Min km</span>
                  <input
                    type="number" min="0" step="0.5" max={draft.rangeMax}
                    value={draft.rangeMin}
                    onChange={(e) => setDraft((d) => ({ ...d, rangeMin: Number(e.target.value) }))}
                    className="w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
                  />
                </div>
                <span className="text-gray-300">—</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Max km</span>
                  <input
                    type="number" min={draft.rangeMin} step="0.5"
                    value={draft.rangeMax}
                    onChange={(e) => setDraft((d) => ({ ...d, rangeMax: Number(e.target.value) }))}
                    className="w-20 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white transition"
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

function ApiKeysTab() {
  const { settings, updateSettings } = useApp();
  const [saved, setSaved] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  function toggleSecret(key: string) {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-6 space-y-8">
        {/* Stripe */}
        <Section title="Stripe" badge="💳">
          <SecretField
            label="Stripe Public Key"
            value={settings.stripePublicKey}
            onChange={(v) => updateSettings({ stripePublicKey: v })}
            placeholder="pk_live_..."
            visible={showSecrets["stripe_pub"]}
            onToggle={() => toggleSecret("stripe_pub")}
          />
          <SecretField
            label="Stripe Secret Key"
            value={settings.stripeSecretKey}
            onChange={(v) => updateSettings({ stripeSecretKey: v })}
            placeholder="sk_live_..."
            visible={showSecrets["stripe_sec"]}
            onToggle={() => toggleSecret("stripe_sec")}
          />
        </Section>

        {/* PayPal */}
        <Section title="PayPal" badge="🅿️">
          <SecretField
            label="PayPal Client ID"
            value={settings.paypalClientId}
            onChange={(v) => updateSettings({ paypalClientId: v })}
            placeholder="AaBbCcDd..."
            visible={showSecrets["paypal"]}
            onToggle={() => toggleSecret("paypal")}
          />
        </Section>

        {/* SMTP */}
        <Section title="Email (SMTP)" badge="✉️">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PlainField label="SMTP Host"  value={settings.smtpHost}     onChange={(v) => updateSettings({ smtpHost: v })}     placeholder="smtp.example.com" />
            <PlainField label="Port"       value={settings.smtpPort}     onChange={(v) => updateSettings({ smtpPort: v })}     placeholder="587" type="number" />
            <PlainField label="Username"   value={settings.smtpUser}     onChange={(v) => updateSettings({ smtpUser: v })}     placeholder="noreply@restaurant.com" />
            <SecretField
              label="Password"
              value={settings.smtpPassword}
              onChange={(v) => updateSettings({ smtpPassword: v })}
              placeholder="••••••••"
              visible={showSecrets["smtp_pass"]}
              onToggle={() => toggleSecret("smtp_pass")}
            />
          </div>
        </Section>

        <button
          onClick={handleSave}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all ${
            saved ? "bg-green-100 text-green-700" : "bg-orange-500 hover:bg-orange-600 text-white"
          }`}
        >
          {saved ? <><CheckCircle size={16} /> Saved!</> : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function Section({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">{badge}</span>
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function PlainField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
      />
    </div>
  );
}

function SecretField({ label, value, onChange, placeholder, visible, onToggle }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; visible: boolean; onToggle: () => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

// ─── Thermal Printer Tab ──────────────────────────────────────────────────────

type TestState = "idle" | "connecting" | "success" | "error";

function PrinterTab() {
  const { settings, updateSettings } = useApp();
  const p = settings.printer;

  const [draft, setDraft] = useState({
    enabled:    p.enabled,
    name:       p.name,
    ip:         p.ip,
    port:       p.port,
    autoPrint:  p.autoPrint,
    paperWidth: p.paperWidth,
  });
  const [saved,     setSaved]     = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState("");

  function handleSave() {
    updateSettings({ printer: { ...draft } });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleTest() {
    if (!draft.ip.trim()) {
      setTestState("error");
      setTestError("Enter a printer IP address before testing.");
      return;
    }
    setTestState("connecting");
    setTestError("");

    // Build the test receipt using a preview of the current draft settings
    const previewSettings = { ...settings, printer: { ...draft } };
    const bytes = buildTestReceipt(previewSettings);

    const result = await sendToPrinter(bytes, draft.ip.trim(), draft.port);
    if (result.ok) {
      setTestState("success");
      setTimeout(() => setTestState("idle"), 5000);
    } else {
      setTestState("error");
      setTestError(result.error ?? "Unknown error");
    }
  }

  const isConfigured = Boolean(draft.ip.trim());

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
              ? `${draft.ip}:${draft.port} — auto-print ${draft.autoPrint ? "on" : "off"}`
              : !isConfigured
              ? "Not configured — enter IP address below"
              : "Printer disabled"}
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
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-50 rounded-xl flex items-center justify-center">
              <Printer size={15} className="text-orange-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Printer settings</h3>
              <p className="text-xs text-gray-400">Supports any ESC/POS-compatible IP thermal printer</p>
            </div>
          </div>
          {/* Master enable toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">{draft.enabled ? "Enabled" : "Disabled"}</span>
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
          {/* Network */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Network</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Printer IP address</label>
                <input
                  type="text"
                  value={draft.ip}
                  onChange={(e) => setDraft((d) => ({ ...d, ip: e.target.value }))}
                  placeholder="192.168.1.100"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                />
                <p className="text-[11px] text-gray-400 mt-1">Set a static IP on your printer to prevent address changes</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">TCP port</label>
                <input
                  type="number"
                  value={draft.port}
                  min={1}
                  max={65535}
                  onChange={(e) => setDraft((d) => ({ ...d, port: Number(e.target.value) }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-mono text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
                />
                <p className="text-[11px] text-gray-400 mt-1">Default: 9100</p>
              </div>
            </div>
          </div>

          {/* Identity */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Identity</p>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Printer name <span className="font-normal text-gray-400">(admin label)</span></label>
              <input
                type="text"
                value={draft.name}
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
                <button
                  key={value}
                  onClick={() => setDraft((d) => ({ ...d, paperWidth: value }))}
                  className={`flex-1 text-left px-4 py-3 rounded-xl border-2 transition ${
                    draft.paperWidth === value
                      ? "border-orange-500 bg-orange-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
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
            <button
              onClick={() => setDraft((d) => ({ ...d, autoPrint: !d.autoPrint }))}
              className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 ${
                draft.autoPrint ? "bg-green-500" : "bg-gray-300"
              }`}
              aria-checked={draft.autoPrint}
              role="switch"
            >
              <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                draft.autoPrint ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              saved
                ? "bg-green-100 text-green-700"
                : "bg-orange-500 hover:bg-orange-600 text-white"
            }`}
          >
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
          {/* Status feedback */}
          {testState === "success" && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-700">Test page printed successfully!</p>
                <p className="text-xs text-green-600 mt-0.5">Your printer is connected and working correctly.</p>
              </div>
            </div>
          )}
          {testState === "error" && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">Connection failed</p>
                <p className="text-xs text-red-500 mt-0.5 font-mono break-all">{testError}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testState === "connecting"}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm bg-gray-900 hover:bg-gray-800 text-white transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {testState === "connecting"
                ? <><Loader2 size={15} className="animate-spin" /> Connecting…</>
                : <><Printer size={15} /> Print test page</>
              }
            </button>
            {testState !== "idle" && testState !== "connecting" && (
              <button
                onClick={() => { setTestState("idle"); setTestError(""); }}
                className="text-xs text-gray-400 hover:text-gray-600 transition"
              >
                Dismiss
              </button>
            )}
          </div>

          {/* Help */}
          <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-gray-600">Troubleshooting tips</p>
            <ul className="text-xs text-gray-500 space-y-0.5 list-disc list-inside">
              <li>Ensure the printer and this server are on the same network</li>
              <li>Default port for most thermal printers is <span className="font-mono">9100</span></li>
              <li>Set a static IP on the printer via its web interface or DHCP reservation</li>
              <li>Check that the printer is powered on and not in error state</li>
              <li>Some printers require the ESC/POS mode to be enabled in their settings</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function IntegrationsPanel() {
  const [tab, setTab] = useState<"payments" | "api" | "printer">("payments");

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
            <p className="text-xs text-gray-400">Payment methods and API credentials</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-100 px-6 overflow-x-auto scrollbar-hide">
          {([
            { id: "payments", label: "Payment Methods", icon: <CreditCard size={14} /> },
            { id: "api",      label: "API Keys & Email", icon: <Plug size={14} /> },
            { id: "printer",  label: "Thermal Printer",  icon: <Printer size={14} /> },
          ] as const).map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-1 py-3.5 mr-6 text-sm font-medium border-b-2 transition-all ${
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

      {tab === "payments" && <PaymentMethodsTab />}
      {tab === "api"      && <ApiKeysTab />}
      {tab === "printer"  && <PrinterTab />}
    </div>
  );
}
