"use client";

import { useState } from "react";
import { usePOS } from "@/context/POSContext";
import { POSCustomer } from "@/types/pos";
import {
  UserPlus, Search, Star, Users, Phone, Mail, Pencil, X, Trash2, Save,
} from "lucide-react";
import { fmt, fmtDate, fmtTime, getInitials } from "./_utils";

const PRESET_TAGS = ["VIP", "Regular", "Halal", "Vegan", "Vegetarian", "Gluten-Free", "Allergy", "Staff"];

export default function CustomersView() {
  const { customers, setCustomers, sales, settings } = usePOS();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<POSCustomer | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "", phone: "", notes: "" });

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editDraft, setEditDraft] = useState({
    name: "", email: "", phone: "", notes: "",
    loyaltyPoints: 0, giftCardBalance: 0, tags: [] as string[], customTag: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const filtered = customers.filter((c) =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) || c.email?.toLowerCase().includes(search.toLowerCase())
  );

  function openEdit(c: POSCustomer) {
    setEditDraft({
      name:           c.name,
      email:          c.email   ?? "",
      phone:          c.phone   ?? "",
      notes:          c.notes   ?? "",
      loyaltyPoints:  c.loyaltyPoints,
      giftCardBalance: c.giftCardBalance,
      tags:           [...c.tags],
      customTag:      "",
    });
    setShowEdit(true);
  }

  function saveEdit() {
    if (!selected || !editDraft.name.trim()) return;
    const updated: POSCustomer = {
      ...selected,
      name:            editDraft.name.trim(),
      email:           editDraft.email.trim()  || undefined,
      phone:           editDraft.phone.trim()  || undefined,
      notes:           editDraft.notes.trim()  || undefined,
      loyaltyPoints:   Math.max(0, editDraft.loyaltyPoints),
      giftCardBalance: Math.max(0, editDraft.giftCardBalance),
      tags:            editDraft.tags,
    };
    setCustomers((prev) => prev.map((c) => c.id === selected.id ? updated : c));
    setSelected(updated);
    setShowEdit(false);
  }

  function deleteCustomer() {
    if (!selected) return;
    setCustomers((prev) => prev.filter((c) => c.id !== selected.id));
    setSelected(null);
    setDeleteConfirm(false);
    setShowEdit(false);
  }

  function toggleTag(tag: string) {
    setEditDraft((d) => ({
      ...d,
      tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag],
    }));
  }

  function addCustomTag() {
    const tag = editDraft.customTag.trim();
    if (!tag || editDraft.tags.includes(tag)) return;
    setEditDraft((d) => ({ ...d, tags: [...d.tags, tag], customTag: "" }));
  }

  function addCustomer() {
    if (!newCustomer.name.trim()) return;
    const c: POSCustomer = {
      id: `pc-${Date.now()}`, name: newCustomer.name.trim(), email: newCustomer.email || undefined,
      phone: newCustomer.phone || undefined, loyaltyPoints: 0, giftCardBalance: 0, totalSpend: 0,
      visitCount: 0, tags: [], notes: newCustomer.notes || undefined, createdAt: new Date().toISOString(),
    };
    setCustomers((prev) => [...prev, c]);
    setNewCustomer({ name: "", email: "", phone: "", notes: "" });
    setShowAdd(false);
  }

  const customerSales = selected ? sales.filter((s) => !s.voided && s.customerId === selected.id) : [];

  return (
    <div className="flex-1 overflow-hidden flex">
      {/* List */}
      <div className="w-80 xl:w-96 flex-shrink-0 flex flex-col border-r border-slate-700/50">
        <div className="p-4 border-b border-slate-700/50 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold">Customers</h2>
            <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-400 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-colors">
              <UserPlus size={14} /> Add
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers…"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((c) => (
            <button key={c.id} onClick={() => setSelected(c)}
              className={`w-full px-4 py-4 flex items-center gap-3 text-left transition-colors border-b border-slate-800 ${selected?.id === c.id ? "bg-orange-500/10 border-l-2 border-l-orange-500" : "hover:bg-slate-800/50"}`}>
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm flex-shrink-0">
                {getInitials(c.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm font-semibold truncate">{c.name}</p>
                  {c.tags.includes("VIP") && <Star size={10} className="text-amber-400 flex-shrink-0" />}
                </div>
                <p className="text-slate-400 text-xs mt-0.5">{c.visitCount} visits · {fmt(c.totalSpend, settings.currencySymbol)} spent</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-amber-400 text-xs font-bold">{c.loyaltyPoints} pts</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600">
            <Users size={48} className="mb-3 text-slate-700" />
            <p className="text-sm">Select a customer to view details</p>
          </div>
        ) : (
          <div className="p-6 max-w-2xl">
            {/* Profile header */}
            <div className="flex items-start gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-2xl flex-shrink-0">
                {getInitials(selected.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-white font-bold text-xl">{selected.name}</h3>
                  {selected.tags.map((t) => (
                    <span key={t} className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full font-semibold">{t}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4 mt-2">
                  {selected.phone && <span className="flex items-center gap-1 text-slate-400 text-sm"><Phone size={13} />{selected.phone}</span>}
                  {selected.email && <span className="flex items-center gap-1 text-slate-400 text-sm"><Mail size={13} />{selected.email}</span>}
                </div>
                {selected.notes && <p className="text-slate-400 text-sm mt-2 italic">&quot;{selected.notes}&quot;</p>}
              </div>
              <button
                onClick={() => openEdit(selected)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-sm font-semibold transition-all flex-shrink-0"
              >
                <Pencil size={14} /> Edit
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Total Spend", value: fmt(selected.totalSpend, settings.currencySymbol), color: "text-green-400" },
                { label: "Visits", value: selected.visitCount.toString(), color: "text-blue-400" },
                { label: "Loyalty Points", value: `${selected.loyaltyPoints}`, color: "text-amber-400" },
                { label: "Gift Card", value: fmt(selected.giftCardBalance, settings.currencySymbol), color: "text-purple-400" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-slate-400 text-xs mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Purchase history */}
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <h4 className="text-white font-semibold text-sm mb-4">Purchase History</h4>
              {customerSales.length === 0 ? (
                <p className="text-slate-500 text-sm">No purchases recorded for this customer</p>
              ) : (
                <div className="space-y-2">
                  {customerSales.map((sale) => (
                    <div key={sale.id} className="flex items-center gap-3 py-3 border-b border-slate-700/50 last:border-0">
                      <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-xs flex-shrink-0">✓</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">#{sale.receiptNo} · {sale.items.length} item{sale.items.length !== 1?"s":""}</p>
                        <p className="text-slate-400 text-xs">{fmtDate(sale.date)} · {fmtTime(sale.date)} · {sale.paymentMethod}</p>
                      </div>
                      <p className="text-white font-bold text-sm flex-shrink-0">{fmt(sale.total, settings.currencySymbol)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Edit customer modal ─────────────────────────────────────────── */}
      {showEdit && selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-400 font-bold text-sm">
                  {getInitials(editDraft.name || selected.name)}
                </div>
                <h3 className="text-white font-bold">Edit Customer</h3>
              </div>
              <button onClick={() => setShowEdit(false)} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Contact fields */}
              <div className="space-y-3">
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Contact</h4>
                {[
                  { key: "name",  label: "Full Name *",  placeholder: "Enter name",              type: "text" },
                  { key: "phone", label: "Phone",         placeholder: "07700 000000",            type: "tel" },
                  { key: "email", label: "Email",         placeholder: "customer@example.com",   type: "email" },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                    <input
                      type={f.type}
                      value={editDraft[f.key as "name" | "phone" | "email"]}
                      onChange={(e) => setEditDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Notes</label>
                  <textarea
                    rows={2}
                    value={editDraft.notes}
                    onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="Dietary requirements, preferences…"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500 resize-none"
                  />
                </div>
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                        editDraft.tags.includes(tag)
                          ? "bg-orange-500 border-orange-500 text-white"
                          : "bg-slate-700 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-white"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                {/* Custom tag */}
                <div className="flex gap-2">
                  <input
                    value={editDraft.customTag}
                    onChange={(e) => setEditDraft((d) => ({ ...d, customTag: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomTag(); } }}
                    placeholder="Custom tag…"
                    className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                  <button
                    onClick={addCustomTag}
                    disabled={!editDraft.customTag.trim()}
                    className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-semibold transition-colors disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
                {/* Show active custom tags (non-preset) */}
                {editDraft.tags.filter((t) => !PRESET_TAGS.includes(t)).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {editDraft.tags.filter((t) => !PRESET_TAGS.includes(t)).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-slate-600 border border-slate-500 text-slate-300 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400 transition-all"
                      >
                        {tag} <X size={10} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Loyalty & Gift Card */}
              <div className="space-y-3">
                <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Loyalty & Gift Card</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Loyalty Points</label>
                    <input
                      type="number" min="0" step="1"
                      value={editDraft.loyaltyPoints}
                      onChange={(e) => setEditDraft((d) => ({ ...d, loyaltyPoints: parseInt(e.target.value) || 0 }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-amber-400 font-bold text-sm outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Gift Card ({settings.currencySymbol})</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={editDraft.giftCardBalance}
                      onChange={(e) => setEditDraft((d) => ({ ...d, giftCardBalance: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-purple-400 font-bold text-sm outline-none focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-700 space-y-2 flex-shrink-0">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="py-3 rounded-xl border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} /> Delete
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!editDraft.name.trim()}
                  className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save size={14} /> Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete customer confirm ──────────────────────────────────────── */}
      {deleteConfirm && selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete customer?</h3>
            <p className="text-slate-400 text-sm mb-1">
              <span className="text-white font-semibold">{selected.name}</span> will be permanently removed.
            </p>
            <p className="text-slate-500 text-xs mb-6">
              Their purchase history ({customerSales.length} sale{customerSales.length !== 1 ? "s" : ""}) will remain in the sales log.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteConfirm(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={deleteCustomer} className="py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add customer modal ───────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold">New Customer</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3 mb-5">
              {[
                { key: "name", label: "Full Name *", placeholder: "Enter name" },
                { key: "phone", label: "Phone", placeholder: "07700 000000" },
                { key: "email", label: "Email", placeholder: "customer@example.com" },
                { key: "notes", label: "Notes", placeholder: "Dietary requirements, preferences…" },
              ].map((field) => (
                <div key={field.key}>
                  <label className="text-xs text-slate-400 mb-1 block">{field.label}</label>
                  <input value={(newCustomer as Record<string,string>)[field.key]}
                    onChange={(e) => setNewCustomer((p) => ({ ...p, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowAdd(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={addCustomer} disabled={!newCustomer.name.trim()} className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
