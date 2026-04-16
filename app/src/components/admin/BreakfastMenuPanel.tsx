"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { Category, MenuItem, Variation, AddOn } from "@/types";
import {
  Plus, Pencil, Trash2, Search, ArrowUp, ArrowDown,
  X, Check, AlertTriangle, Flame, ImagePlus, Link, Upload,
  Package, PackageX, PackageMinus, Clock, Sun, ToggleLeft, ToggleRight,
} from "lucide-react";
import { resolveStock, stockLabel } from "@/lib/stockUtils";
import type { StockStatus } from "@/types";

const DIETARY_OPTIONS = ["vegetarian", "vegan", "halal", "gluten-free"] as const;
const DIETARY_COLORS: Record<string, string> = {
  vegetarian: "bg-green-100 text-green-700 border-green-200",
  vegan: "bg-emerald-100 text-emerald-700 border-emerald-200",
  halal: "bg-purple-100 text-purple-700 border-purple-200",
  "gluten-free": "bg-amber-100 text-amber-700 border-amber-200",
};

const BREAKFAST_EMOJIS = ["🥞","🍳","🥓","🥚","🧇","🥐","🍞","🥖","🧀","🥣","🍌","🍓","☕","🥤","🍊","🫖","🧆","🥜","🍯","🫙"];

function blankItem(categoryId: string): MenuItem {
  return { id: crypto.randomUUID(), categoryId, name: "", description: "", price: 0, dietary: [], popular: false, variations: [], addOns: [] };
}
function blankCategory(): Category {
  return { id: crypto.randomUUID(), name: "", emoji: "🥞" };
}
function blankVariation(): Variation {
  return { id: crypto.randomUUID(), name: "", options: [{ id: crypto.randomUUID(), label: "", price: 0 }] };
}
function blankAddOn(): AddOn {
  return { id: crypto.randomUUID(), name: "", price: 0 };
}

export default function BreakfastMenuPanel() {
  const {
    settings,
    updateBreakfastSettings,
    addBreakfastCategory, updateBreakfastCategory, deleteBreakfastCategory, reorderBreakfastCategories,
    addBreakfastItem, updateBreakfastItem, deleteBreakfastItem,
  } = useApp();

  const bm = settings.breakfastMenu ?? { enabled: false, startTime: "07:00", endTime: "11:30", categories: [], items: [] };
  const { enabled, startTime, endTime, categories, items } = bm;

  const [selectedCatId, setSelectedCatId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [deletingCat, setDeletingCat] = useState<Category | null>(null);
  const [deletingItem, setDeletingItem] = useState<MenuItem | null>(null);

  const displayedItems = items.filter((item) => {
    const matchesCat = selectedCatId === "all" || item.categoryId === selectedCatId;
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.description.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const catItemCount = (catId: string) => items.filter((i) => i.categoryId === catId).length;

  function moveCat(idx: number, dir: -1 | 1) {
    const next = [...categories];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    reorderBreakfastCategories(next);
  }

  return (
    <div className="space-y-4">
      {/* ── Settings card ── */}
      <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center">
            <Sun size={18} className="text-amber-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Breakfast Menu Settings</h2>
            <p className="text-xs text-gray-400">Configure when the breakfast menu is shown to customers</p>
          </div>
        </div>
        <div className="p-6 flex flex-wrap gap-6 items-center">
          {/* Enable toggle */}
          <button
            onClick={() => updateBreakfastSettings({ enabled: !enabled })}
            className="flex items-center gap-3"
          >
            {enabled
              ? <ToggleRight size={32} className="text-amber-500" />
              : <ToggleLeft size={32} className="text-gray-300" />}
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-800">
                {enabled ? "Breakfast menu enabled" : "Breakfast menu disabled"}
              </p>
              <p className="text-xs text-gray-400">Customers see it only during the time window below</p>
            </div>
          </button>

          {/* Time window */}
          <div className="flex items-center gap-3 ml-auto">
            <Clock size={15} className="text-amber-500 flex-shrink-0" />
            <div className="flex items-center gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">From</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => updateBreakfastSettings({ startTime: e.target.value })}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <span className="text-gray-400 mt-4">–</span>
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">Until</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => updateBreakfastSettings({ endTime: e.target.value })}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>
            <div className={`ml-2 px-3 py-1.5 rounded-full text-xs font-semibold ${enabled ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
              {enabled ? `☀️ Live ${startTime}–${endTime}` : "Off"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Item management ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center">
              <span className="text-lg">🥞</span>
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Breakfast Items</h2>
              <p className="text-xs text-gray-400">{items.length} items · {categories.length} categories</p>
            </div>
          </div>
          <button
            onClick={() => setEditingItem(blankItem(selectedCatId === "all" ? (categories[0]?.id ?? "") : selectedCatId))}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
          >
            <Plus size={15} />
            Add item
          </button>
        </div>

        <div className="flex flex-col md:flex-row md:divide-x divide-gray-100 min-h-[400px]">
          {/* Mobile category strip */}
          <div className="md:hidden overflow-x-auto scrollbar-hide border-b border-gray-100">
            <div className="flex gap-2 px-4 py-3 min-w-max">
              <button
                onClick={() => setSelectedCatId("all")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition ${selectedCatId === "all" ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600"}`}
              >
                All <span className="opacity-70">({items.length})</span>
              </button>
              {categories.map((cat) => (
                <button key={cat.id} onClick={() => setSelectedCatId(cat.id)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition ${selectedCatId === cat.id ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600"}`}
                >
                  {cat.emoji} {cat.name}
                </button>
              ))}
              <button onClick={() => setEditingCat(blankCategory())}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 border border-dashed border-gray-300 text-gray-500 hover:border-amber-300 hover:text-amber-500 transition"
              >
                <Plus size={11} /> New
              </button>
            </div>
          </div>

          {/* Desktop category sidebar */}
          <div className="hidden md:block w-56 flex-shrink-0 p-3 space-y-0.5">
            <div className="flex items-center justify-between px-2 pb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Categories</span>
              <button onClick={() => setEditingCat(blankCategory())}
                className="w-6 h-6 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-amber-100 hover:text-amber-600 transition text-gray-500"
                title="Add category"
              >
                <Plus size={13} />
              </button>
            </div>
            <button
              onClick={() => setSelectedCatId("all")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-between ${selectedCatId === "all" ? "bg-amber-50 text-amber-600" : "text-gray-600 hover:bg-gray-50"}`}
            >
              <span>All items</span>
              <span className="text-xs text-gray-400">{items.length}</span>
            </button>
            {categories.map((cat, idx) => (
              <div key={cat.id} className={`group flex items-center rounded-lg transition-all ${selectedCatId === cat.id ? "bg-amber-50" : "hover:bg-gray-50"}`}>
                <div className="flex flex-col pl-1 md:opacity-0 md:group-hover:opacity-100 transition">
                  <button onClick={() => moveCat(idx, -1)} className="text-gray-300 hover:text-gray-500 leading-none"><ArrowUp size={10} /></button>
                  <button onClick={() => moveCat(idx, 1)} className="text-gray-300 hover:text-gray-500 leading-none"><ArrowDown size={10} /></button>
                </div>
                <button onClick={() => setSelectedCatId(cat.id)} className="flex-1 text-left px-2 py-2 text-sm flex items-center gap-1.5">
                  <span>{cat.emoji}</span>
                  <span className={`font-medium truncate ${selectedCatId === cat.id ? "text-amber-600" : "text-gray-700"}`}>{cat.name}</span>
                  <span className="ml-auto text-xs text-gray-400">{catItemCount(cat.id)}</span>
                </button>
                <div className="flex md:opacity-0 md:group-hover:opacity-100 transition pr-1 gap-0.5">
                  <button onClick={(e) => { e.stopPropagation(); setEditingCat({ ...cat }); }}
                    className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition">
                    <Pencil size={10} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeletingCat(cat); }}
                    className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Item list */}
          <div className="flex-1 p-4">
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search breakfast items…"
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 transition"
              />
            </div>

            {selectedCatId !== "all" && (
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <span>{categories.find((c) => c.id === selectedCatId)?.emoji}</span>
                  <span>{categories.find((c) => c.id === selectedCatId)?.name}</span>
                </h3>
                <button onClick={() => setEditingItem(blankItem(selectedCatId))}
                  className="flex items-center gap-1.5 text-xs text-amber-500 hover:text-amber-700 font-medium transition">
                  <Plus size={13} /> Add to category
                </button>
              </div>
            )}

            {displayedItems.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <span className="text-5xl block mb-3">🥞</span>
                <p className="font-medium">No breakfast items yet</p>
                {categories.length === 0 && (
                  <p className="text-xs mt-1 text-gray-400">Add a category first, then add items to it</p>
                )}
                <button
                  onClick={() => categories.length > 0 ? setEditingItem(blankItem(selectedCatId === "all" ? categories[0].id : selectedCatId)) : setEditingCat(blankCategory())}
                  className="mt-3 text-sm text-amber-500 hover:underline"
                >
                  + {categories.length === 0 ? "Add your first category" : "Add your first item"}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {displayedItems.map((item) => {
                const catName = categories.find((c) => c.id === item.categoryId)?.name ?? "—";
                const status = resolveStock(item);
                const isTracked = typeof item.stockQty === "number";
                return (
                  <div key={item.id}
                    className="group flex items-center gap-4 px-4 py-3 rounded-xl border border-gray-100 hover:border-amber-200 hover:bg-amber-50/30 transition-all"
                  >
                    <div className="w-14 h-14 rounded-xl overflow-hidden border border-gray-100 flex-shrink-0">
                      {item.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-amber-50 flex items-center justify-center text-amber-200">
                          <ImagePlus size={18} />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{item.name}</span>
                        {item.popular && (
                          <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                            <Flame size={9} /> Popular
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedCatId === "all" && (
                          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">{catName}</span>
                        )}
                        {item.dietary.map((d) => (
                          <span key={d} className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${DIETARY_COLORS[d] ?? "bg-gray-100 text-gray-500"}`}>{d}</span>
                        ))}
                        {(item.variations?.length ?? 0) > 0 && (
                          <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full border border-blue-200 font-medium">
                            {item.variations!.length} variation{item.variations!.length > 1 ? "s" : ""}
                          </span>
                        )}
                        {(item.addOns?.length ?? 0) > 0 && (
                          <span className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-600 rounded-full border border-violet-200 font-medium">
                            {item.addOns!.length} add-on{item.addOns!.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isTracked) return;
                        const next: StockStatus = status === "in_stock" ? "out_of_stock" : status === "out_of_stock" ? "low_stock" : "in_stock";
                        updateBreakfastItem({ ...item, stockStatus: next });
                      }}
                      title={isTracked ? `${item.stockQty} units tracked` : "Click to cycle status"}
                      className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                        status === "out_of_stock" ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                        : status === "low_stock" ? "bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100"
                        : "bg-green-50 border-green-200 text-green-600 hover:bg-green-100"
                      } ${isTracked ? "cursor-default" : "cursor-pointer"}`}
                    >
                      {status === "out_of_stock" ? <PackageX size={9} /> : status === "low_stock" ? <PackageMinus size={9} /> : <Package size={9} />}
                      {isTracked ? `${item.stockQty} left` : stockLabel(status)}
                    </button>

                    <span className="font-bold text-gray-900 text-sm flex-shrink-0">£{item.price.toFixed(2)}</span>

                    <div className="flex items-center gap-1 flex-shrink-0 md:opacity-0 md:group-hover:opacity-100 transition">
                      <button onClick={() => setEditingItem({ ...item, variations: item.variations ?? [], addOns: item.addOns ?? [] })}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setDeletingItem(item)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {editingCat && (
        <CategoryModal
          cat={editingCat}
          isNew={!categories.find((c) => c.id === editingCat.id)}
          onSave={(cat) => {
            if (categories.find((c) => c.id === cat.id)) updateBreakfastCategory(cat);
            else addBreakfastCategory(cat);
            setEditingCat(null);
          }}
          onClose={() => setEditingCat(null)}
        />
      )}

      {editingItem && (
        <ItemModal
          item={editingItem}
          categories={categories}
          isNew={!items.find((i) => i.id === editingItem.id)}
          onSave={(item) => {
            if (items.find((i) => i.id === item.id)) updateBreakfastItem(item);
            else addBreakfastItem(item);
            setEditingItem(null);
          }}
          onClose={() => setEditingItem(null)}
        />
      )}

      {deletingCat && (
        <ConfirmModal
          title="Delete category?"
          message={`"${deletingCat.name}" and all ${catItemCount(deletingCat.id)} items in it will be permanently deleted.`}
          onConfirm={() => { deleteBreakfastCategory(deletingCat.id); setDeletingCat(null); if (selectedCatId === deletingCat.id) setSelectedCatId("all"); }}
          onClose={() => setDeletingCat(null)}
        />
      )}

      {deletingItem && (
        <ConfirmModal
          title="Delete item?"
          message={`"${deletingItem.name}" will be permanently removed from the breakfast menu.`}
          onConfirm={() => { deleteBreakfastItem(deletingItem.id); setDeletingItem(null); }}
          onClose={() => setDeletingItem(null)}
        />
      )}
    </div>
  );
}

// ─── Category Modal ───────────────────────────────────────────────────────────

function CategoryModal({ cat, isNew, onSave, onClose }: { cat: Category; isNew: boolean; onSave: (c: Category) => void; onClose: () => void }) {
  const [form, setForm] = useState<Category>({ ...cat });
  return (
    <ModalShell title={isNew ? "Add category" : "Edit category"} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category name</label>
          <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            placeholder="e.g. Hot Drinks" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">Emoji</label>
          <div className="flex flex-wrap gap-2">
            {BREAKFAST_EMOJIS.map((e) => (
              <button key={e} onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center border-2 transition-all ${form.emoji === e ? "border-amber-400 bg-amber-50" : "border-transparent hover:border-gray-200"}`}>
                {e}
              </button>
            ))}
            <input type="text" value={BREAKFAST_EMOJIS.includes(form.emoji) ? "" : form.emoji}
              onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
              className="w-20 border border-gray-200 rounded-xl px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Custom" />
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-2xl">{form.emoji}</span>
            <span className="text-sm font-medium text-gray-700">{form.name || "Preview"}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-6">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
        <button onClick={() => form.name.trim() && onSave(form)} disabled={!form.name.trim()}
          className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold transition">
          {isNew ? "Add category" : "Save changes"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Item Modal ───────────────────────────────────────────────────────────────

function ItemModal({ item, categories, isNew, onSave, onClose }: { item: MenuItem; categories: Category[]; isNew: boolean; onSave: (i: MenuItem) => void; onClose: () => void }) {
  const [form, setForm] = useState<MenuItem>({ ...item });
  const [tab, setTab] = useState<"basic" | "variations" | "addons" | "stock">("basic");

  function toggleDietary(d: string) {
    setForm((f) => ({ ...f, dietary: f.dietary.includes(d) ? f.dietary.filter((x) => x !== d) : [...f.dietary, d] }));
  }
  function addVariation() { setForm((f) => ({ ...f, variations: [...(f.variations ?? []), blankVariation()] })); }
  function updateVariation(idx: number, patch: Partial<Variation>) {
    setForm((f) => { const v = [...(f.variations ?? [])]; v[idx] = { ...v[idx], ...patch }; return { ...f, variations: v }; });
  }
  function removeVariation(idx: number) { setForm((f) => ({ ...f, variations: (f.variations ?? []).filter((_, i) => i !== idx) })); }
  function addVariationOption(varIdx: number) {
    setForm((f) => { const v = [...(f.variations ?? [])]; v[varIdx] = { ...v[varIdx], options: [...v[varIdx].options, { id: crypto.randomUUID(), label: "", price: 0 }] }; return { ...f, variations: v }; });
  }
  function updateVariationOption(varIdx: number, optIdx: number, patch: { label?: string; price?: number }) {
    setForm((f) => { const v = [...(f.variations ?? [])]; const opts = [...v[varIdx].options]; opts[optIdx] = { ...opts[optIdx], ...patch }; v[varIdx] = { ...v[varIdx], options: opts }; return { ...f, variations: v }; });
  }
  function removeVariationOption(varIdx: number, optIdx: number) {
    setForm((f) => { const v = [...(f.variations ?? [])]; v[varIdx] = { ...v[varIdx], options: v[varIdx].options.filter((_, i) => i !== optIdx) }; return { ...f, variations: v }; });
  }
  function addAddOn() { setForm((f) => ({ ...f, addOns: [...(f.addOns ?? []), blankAddOn()] })); }
  function updateAddOn(idx: number, patch: Partial<AddOn>) {
    setForm((f) => { const a = [...(f.addOns ?? [])]; a[idx] = { ...a[idx], ...patch }; return { ...f, addOns: a }; });
  }
  function removeAddOn(idx: number) { setForm((f) => ({ ...f, addOns: (f.addOns ?? []).filter((_, i) => i !== idx) })); }

  const isValid = form.name.trim() && form.price >= 0 && form.categoryId;

  return (
    <ModalShell title={isNew ? "Add breakfast item" : "Edit breakfast item"} onClose={onClose} wide>
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
        {(["basic", "variations", "addons", "stock"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "addons" ? "Add-ons" : t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "variations" && (form.variations?.length ?? 0) > 0 && <span className="ml-1 bg-amber-100 text-amber-600 rounded-full px-1.5 text-[10px]">{form.variations!.length}</span>}
            {t === "addons" && (form.addOns?.length ?? 0) > 0 && <span className="ml-1 bg-violet-100 text-violet-600 rounded-full px-1.5 text-[10px]">{form.addOns!.length}</span>}
            {t === "stock" && (() => { const s = resolveStock(form); if (s === "out_of_stock") return <span className="ml-1 bg-red-100 text-red-600 rounded-full px-1.5 text-[10px]">OOS</span>; if (s === "low_stock") return <span className="ml-1 bg-amber-100 text-amber-600 rounded-full px-1.5 text-[10px]">Low</span>; return null; })()}
          </button>
        ))}
      </div>

      {/* Basic tab */}
      {tab === "basic" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Item name *</label>
              <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                placeholder="e.g. Full English Breakfast" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category *</label>
              <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Price (£) *</label>
              <input type="number" min="0" step="0.50" value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
              <textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                placeholder="Brief description…" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-2">Item image</label>
              <div className="flex gap-3 items-start">
                <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-dashed border-gray-200 flex items-center justify-center flex-shrink-0 bg-amber-50">
                  {form.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.image} alt="preview" className="w-full h-full object-cover" />
                  ) : <ImagePlus size={22} className="text-amber-200" />}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="relative">
                    <Link size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="url" value={form.image?.startsWith("data:") ? "" : (form.image ?? "")}
                      onChange={(e) => setForm((f) => ({ ...f, image: e.target.value || undefined }))}
                      className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      placeholder="Paste image URL…" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer w-full py-2 px-3 rounded-lg border border-gray-200 hover:border-amber-300 hover:text-amber-500 text-gray-500 text-xs font-medium transition">
                    <Upload size={13} /> Upload from device
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => setForm((f) => ({ ...f, image: ev.target?.result as string }));
                      reader.readAsDataURL(file);
                    }} />
                  </label>
                  {form.image && <button onClick={() => setForm((f) => ({ ...f, image: undefined }))} className="text-xs text-red-400 hover:text-red-600 transition">× Remove image</button>}
                </div>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Dietary tags</label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((d) => (
                <button key={d} onClick={() => toggleDietary(d)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all capitalize ${form.dietary.includes(d) ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                  {form.dietary.includes(d) && <Check size={10} className="inline mr-1" />}{d}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => setForm((f) => ({ ...f, popular: !f.popular }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${form.popular ? "bg-amber-500" : "bg-gray-200"}`}>
              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.popular ? "translate-x-4" : ""}`} />
            </div>
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><Flame size={14} className="text-amber-500" /> Mark as popular</span>
          </label>
        </div>
      )}

      {/* Variations tab */}
      {tab === "variations" && (
        <div className="space-y-4">
          {(form.variations ?? []).map((v, vi) => (
            <div key={v.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <input value={v.name} onChange={(e) => updateVariation(vi, { name: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="Variation name (e.g. Egg style)" />
                <button onClick={() => removeVariation(vi)} className="text-gray-400 hover:text-red-500 transition"><X size={16} /></button>
              </div>
              {v.options.map((opt, oi) => (
                <div key={opt.id} className="flex gap-2 items-center pl-4">
                  <input value={opt.label} onChange={(e) => updateVariationOption(vi, oi, { label: e.target.value })}
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Option label" />
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-sm">£</span>
                    <input type="number" min="0" step="0.50" value={opt.price} onChange={(e) => updateVariationOption(vi, oi, { price: parseFloat(e.target.value) || 0 })}
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                  {v.options.length > 1 && <button onClick={() => removeVariationOption(vi, oi)} className="text-gray-300 hover:text-red-400 transition"><X size={13} /></button>}
                </div>
              ))}
              <button onClick={() => addVariationOption(vi)} className="ml-4 text-xs text-amber-500 hover:text-amber-700 font-medium transition">+ Add option</button>
            </div>
          ))}
          <button onClick={addVariation}
            className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-amber-300 hover:text-amber-500 transition font-medium">
            + Add variation group
          </button>
        </div>
      )}

      {/* Add-ons tab */}
      {tab === "addons" && (
        <div className="space-y-3">
          {(form.addOns ?? []).map((a, ai) => (
            <div key={a.id} className="flex gap-2 items-center">
              <input value={a.name} onChange={(e) => updateAddOn(ai, { name: e.target.value })}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="Add-on name (e.g. Extra bacon)" />
              <div className="flex items-center gap-1">
                <span className="text-gray-400 text-sm">£</span>
                <input type="number" min="0" step="0.50" value={a.price} onChange={(e) => updateAddOn(ai, { price: parseFloat(e.target.value) || 0 })}
                  className="w-24 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <button onClick={() => removeAddOn(ai)} className="text-gray-400 hover:text-red-500 transition"><X size={16} /></button>
            </div>
          ))}
          <button onClick={addAddOn}
            className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-amber-300 hover:text-amber-500 transition font-medium">
            + Add add-on
          </button>
        </div>
      )}

      {/* Stock tab */}
      {tab === "stock" && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Stock tracking</label>
            <div className="flex gap-3">
              <button onClick={() => setForm((f) => ({ ...f, stockQty: undefined, stockStatus: "in_stock" }))}
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${typeof form.stockQty !== "number" ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-500"}`}>
                Manual status
              </button>
              <button onClick={() => setForm((f) => ({ ...f, stockQty: f.stockQty ?? 0, stockStatus: undefined }))}
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${typeof form.stockQty === "number" ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-500"}`}>
                Track quantity
              </button>
            </div>
          </div>
          {typeof form.stockQty === "number" ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Current stock quantity</label>
              <input type="number" min="0" value={form.stockQty} onChange={(e) => setForm((f) => ({ ...f, stockQty: parseInt(e.target.value) || 0 }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-xs text-gray-400 mt-1">Zero automatically marks this item as out of stock.</p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">Stock status</label>
              <div className="flex gap-2">
                {(["in_stock", "low_stock", "out_of_stock"] as StockStatus[]).map((s) => (
                  <button key={s} onClick={() => setForm((f) => ({ ...f, stockStatus: s }))}
                    className={`flex-1 py-2.5 rounded-xl border-2 text-xs font-semibold capitalize transition-all ${(form.stockStatus ?? "in_stock") === s
                      ? s === "out_of_stock" ? "border-red-400 bg-red-50 text-red-600"
                        : s === "low_stock" ? "border-amber-400 bg-amber-50 text-amber-600"
                        : "border-green-400 bg-green-50 text-green-600"
                      : "border-gray-200 text-gray-500"}`}>
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
        <button onClick={() => isValid && onSave(form)} disabled={!isValid}
          className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold transition">
          {isNew ? "Add item" : "Save changes"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, onConfirm, onClose }: { title: string; message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl mb-5">
        <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition">Delete</button>
      </div>
    </ModalShell>
  );
}

// ─── Modal Shell ──────────────────────────────────────────────────────────────

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto p-6`}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
