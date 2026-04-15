"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { Category, MenuItem, Variation, AddOn } from "@/types";
import {
  ChefHat, Plus, Pencil, Trash2, Search,
  GripVertical, X, Check, AlertTriangle, Flame, Tag,
  ArrowUp, ArrowDown, ImagePlus, Link, Upload,
  Package, PackageX, PackageMinus, Minus,
} from "lucide-react";
import { resolveStock, stockLabel, LOW_STOCK_THRESHOLD } from "@/lib/stockUtils";
import type { StockStatus } from "@/types";

const DIETARY_OPTIONS = ["vegetarian", "vegan", "halal", "gluten-free"] as const;

const DIETARY_COLORS: Record<string, string> = {
  vegetarian: "bg-green-100 text-green-700 border-green-200",
  vegan: "bg-emerald-100 text-emerald-700 border-emerald-200",
  halal: "bg-purple-100 text-purple-700 border-purple-200",
  "gluten-free": "bg-amber-100 text-amber-700 border-amber-200",
};

// ─── Blank templates ─────────────────────────────────────────────────────────

function blankItem(categoryId: string): MenuItem {
  return {
    id: crypto.randomUUID(),
    categoryId,
    name: "",
    description: "",
    price: 0,
    dietary: [],
    popular: false,
    variations: [],
    addOns: [],
  };
}

function blankCategory(): Category {
  return { id: crypto.randomUUID(), name: "", emoji: "🍽️" };
}

function blankVariation(): Variation {
  return { id: crypto.randomUUID(), name: "", options: [{ id: crypto.randomUUID(), label: "", price: 0 }] };
}

function blankAddOn(): AddOn {
  return { id: crypto.randomUUID(), name: "", price: 0 };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function MenuManagementPanel() {
  const {
    categories, menuItems,
    addCategory, updateCategory, deleteCategory, reorderCategories,
    addMenuItem, updateMenuItem, deleteMenuItem,
  } = useApp();

  const [selectedCatId, setSelectedCatId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [deletingCat, setDeletingCat] = useState<Category | null>(null);
  const [deletingItem, setDeletingItem] = useState<MenuItem | null>(null);

  // Filtered items
  const displayedItems = menuItems.filter((item) => {
    const matchesCat = selectedCatId === "all" || item.categoryId === selectedCatId;
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const catItemCount = (catId: string) => menuItems.filter((i) => i.categoryId === catId).length;

  function moveCat(idx: number, dir: -1 | 1) {
    const next = [...categories];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    reorderCategories(next);
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center">
            <ChefHat size={18} className="text-orange-600" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900">Menu Management</h2>
            <p className="text-xs text-gray-400">
              {menuItems.length} items · {categories.length} categories
              {(() => {
                const oos = menuItems.filter((i) => resolveStock(i) === "out_of_stock").length;
                const low = menuItems.filter((i) => resolveStock(i) === "low_stock").length;
                if (!oos && !low) return null;
                return (
                  <span className="ml-2">
                    {oos > 0 && <span className="text-red-500 font-semibold">{oos} out of stock</span>}
                    {oos > 0 && low > 0 && <span className="mx-1">·</span>}
                    {low > 0 && <span className="text-amber-500 font-semibold">{low} low stock</span>}
                  </span>
                );
              })()}
            </p>
          </div>
        </div>
        <button
          onClick={() => setEditingItem(blankItem(selectedCatId === "all" ? (categories[0]?.id ?? "") : selectedCatId))}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
        >
          <Plus size={15} />
          Add item
        </button>
      </div>

      <div className="flex flex-col md:flex-row md:divide-x divide-gray-100 min-h-[500px]">
        {/* Mobile: horizontal category selector */}
        <div className="md:hidden overflow-x-auto scrollbar-hide border-b border-gray-100">
          <div className="flex gap-2 px-4 py-3 min-w-max">
            <button
              onClick={() => setSelectedCatId("all")}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition ${
                selectedCatId === "all" ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600"
              }`}
            >
              All <span className="opacity-70">({menuItems.length})</span>
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCatId(cat.id)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition ${
                  selectedCatId === cat.id ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600"
                }`}
              >
                {cat.emoji} {cat.name}
              </button>
            ))}
            <button
              onClick={() => setEditingCat(blankCategory())}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 border border-dashed border-gray-300 text-gray-500 transition hover:border-orange-300 hover:text-orange-500"
            >
              <Plus size={11} /> New
            </button>
          </div>
        </div>
        {/* ── Left: Category sidebar ── */}
        <div className="hidden md:block w-56 flex-shrink-0 p-3 space-y-0.5">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Categories</span>
            <button
              onClick={() => setEditingCat(blankCategory())}
              className="w-6 h-6 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-orange-100 hover:text-orange-600 transition text-gray-500"
              title="Add category"
            >
              <Plus size={13} />
            </button>
          </div>

          {/* All items */}
          <button
            onClick={() => setSelectedCatId("all")}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-between ${
              selectedCatId === "all"
                ? "bg-orange-50 text-orange-600"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <span>All items</span>
            <span className="text-xs text-gray-400">{menuItems.length}</span>
          </button>

          {/* Category list */}
          {categories.map((cat, idx) => (
            <div
              key={cat.id}
              className={`group flex items-center rounded-lg transition-all ${
                selectedCatId === cat.id ? "bg-orange-50" : "hover:bg-gray-50"
              }`}
            >
              {/* Reorder arrows */}
              <div className="flex flex-col pl-1 md:opacity-0 md:group-hover:opacity-100 transition">
                <button onClick={() => moveCat(idx, -1)} className="text-gray-300 hover:text-gray-500 leading-none">
                  <ArrowUp size={10} />
                </button>
                <button onClick={() => moveCat(idx, 1)} className="text-gray-300 hover:text-gray-500 leading-none">
                  <ArrowDown size={10} />
                </button>
              </div>

              <button
                onClick={() => setSelectedCatId(cat.id)}
                className="flex-1 text-left px-2 py-2 text-sm flex items-center gap-1.5"
              >
                <span>{cat.emoji}</span>
                <span className={`font-medium truncate ${selectedCatId === cat.id ? "text-orange-600" : "text-gray-700"}`}>
                  {cat.name}
                </span>
                <span className="ml-auto text-xs text-gray-400">{catItemCount(cat.id)}</span>
              </button>

              {/* Edit/delete */}
              <div className="flex md:opacity-0 md:group-hover:opacity-100 transition pr-1 gap-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingCat({ ...cat }); }}
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition"
                >
                  <Pencil size={10} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeletingCat(cat); }}
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ── Right: Item list ── */}
        <div className="flex-1 p-4">
          {/* Search within panel */}
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 transition"
            />
          </div>

          {/* Category header when filtered */}
          {selectedCatId !== "all" && (
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <span>{categories.find((c) => c.id === selectedCatId)?.emoji}</span>
                <span>{categories.find((c) => c.id === selectedCatId)?.name}</span>
              </h3>
              <button
                onClick={() => setEditingItem(blankItem(selectedCatId))}
                className="flex items-center gap-1.5 text-xs text-orange-500 hover:text-orange-700 font-medium transition"
              >
                <Plus size={13} />
                Add to category
              </button>
            </div>
          )}

          {/* Empty state */}
          {displayedItems.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <ChefHat size={36} className="mx-auto mb-3 text-gray-200" />
              <p className="font-medium">No items found</p>
              <button
                onClick={() => setEditingItem(blankItem(selectedCatId === "all" ? (categories[0]?.id ?? "") : selectedCatId))}
                className="mt-3 text-sm text-orange-500 hover:underline"
              >
                + Add your first item
              </button>
            </div>
          )}

          {/* Item grid */}
          <div className="space-y-2">
            {displayedItems.map((item) => {
              const catName = categories.find((c) => c.id === item.categoryId)?.name ?? "—";
              return (
                <div
                  key={item.id}
                  className="group flex items-center gap-4 px-4 py-3 rounded-xl border border-gray-100 hover:border-orange-200 hover:bg-orange-50/30 transition-all"
                >
                  <div className="w-14 h-14 rounded-xl overflow-hidden border border-gray-100 flex-shrink-0">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-50 flex items-center justify-center text-gray-300">
                        <ImagePlus size={18} />
                      </div>
                    )}
                  </div>
                  <GripVertical size={14} className="text-gray-300 flex-shrink-0" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{item.name}</span>
                      {item.popular && (
                        <span className="flex items-center gap-0.5 text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full border border-orange-200">
                          <Flame size={9} /> Popular
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedCatId === "all" && (
                        <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">
                          {catName}
                        </span>
                      )}
                      {item.dietary.map((d) => (
                        <span key={d} className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${DIETARY_COLORS[d] ?? "bg-gray-100 text-gray-500"}`}>
                          {d}
                        </span>
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

                  {/* Stock badge — click to cycle status quickly */}
                  {(() => {
                    const status = resolveStock(item);
                    const isTracked = typeof item.stockQty === "number";
                    const cycleStatus = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (isTracked) return; // tracked items: edit via modal
                      const next: StockStatus =
                        status === "in_stock"    ? "out_of_stock"
                        : status === "out_of_stock" ? "low_stock"
                        : "in_stock";
                      updateMenuItem({ ...item, stockStatus: next });
                    };
                    return (
                      <button
                        onClick={cycleStatus}
                        title={isTracked ? `${item.stockQty} units tracked` : "Click to cycle status"}
                        className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                          status === "out_of_stock"
                            ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                            : status === "low_stock"
                            ? "bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100"
                            : "bg-green-50 border-green-200 text-green-600 hover:bg-green-100"
                        } ${isTracked ? "cursor-default" : "cursor-pointer"}`}
                      >
                        {status === "out_of_stock" ? <PackageX size={9} /> : status === "low_stock" ? <PackageMinus size={9} /> : <Package size={9} />}
                        {isTracked ? `${item.stockQty} left` : stockLabel(status)}
                      </button>
                    );
                  })()}

                  <span className="font-bold text-gray-900 text-sm flex-shrink-0">
                    £{item.price.toFixed(2)}
                  </span>

                  <div className="flex items-center gap-1 flex-shrink-0 md:opacity-0 md:group-hover:opacity-100 transition">
                    <button
                      onClick={() => setEditingItem({ ...item, variations: item.variations ?? [], addOns: item.addOns ?? [] })}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                      title="Edit item"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setDeletingItem(item)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                      title="Delete item"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {editingCat && (
        <CategoryModal
          cat={editingCat}
          isNew={!categories.find((c) => c.id === editingCat.id)}
          onSave={(cat) => {
            if (categories.find((c) => c.id === cat.id)) {
              updateCategory(cat);
            } else {
              addCategory(cat);
            }
            setEditingCat(null);
          }}
          onClose={() => setEditingCat(null)}
        />
      )}

      {editingItem && (
        <ItemModal
          item={editingItem}
          categories={categories}
          isNew={!menuItems.find((i) => i.id === editingItem.id)}
          onSave={(item) => {
            if (menuItems.find((i) => i.id === item.id)) {
              updateMenuItem(item);
            } else {
              addMenuItem(item);
            }
            setEditingItem(null);
          }}
          onClose={() => setEditingItem(null)}
        />
      )}

      {deletingCat && (
        <ConfirmModal
          title="Delete category?"
          message={`"${deletingCat.name}" and all ${catItemCount(deletingCat.id)} items in it will be permanently deleted.`}
          onConfirm={() => { deleteCategory(deletingCat.id); setDeletingCat(null); if (selectedCatId === deletingCat.id) setSelectedCatId("all"); }}
          onClose={() => setDeletingCat(null)}
        />
      )}

      {deletingItem && (
        <ConfirmModal
          title="Delete item?"
          message={`"${deletingItem.name}" will be permanently removed from the menu.`}
          onConfirm={() => { deleteMenuItem(deletingItem.id); setDeletingItem(null); }}
          onClose={() => setDeletingItem(null)}
        />
      )}
    </div>
  );
}

// ─── Category Modal ──────────────────────────────────────────────────────────

function CategoryModal({
  cat, isNew, onSave, onClose,
}: {
  cat: Category; isNew: boolean; onSave: (c: Category) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<Category>({ ...cat });
  const EMOJIS = ["🍽️","🥗","🍗","🥩","🦐","🍜","🍛","🥦","🧆","🫓","🥤","🍮","🍰","🫙","🍲","🥘","🍱","🥪","🫔","🌮"];

  return (
    <ModalShell title={isNew ? "Add category" : "Edit category"} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category name</label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            placeholder="e.g. Desserts"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-2">Emoji</label>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                className={`w-9 h-9 rounded-xl text-lg flex items-center justify-center border-2 transition-all ${
                  form.emoji === e ? "border-orange-400 bg-orange-50" : "border-transparent hover:border-gray-200"
                }`}
              >
                {e}
              </button>
            ))}
            <input
              type="text"
              value={EMOJIS.includes(form.emoji) ? "" : form.emoji}
              onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
              className="w-20 border border-gray-200 rounded-xl px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Custom"
            />
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-2xl">{form.emoji}</span>
            <span className="text-sm font-medium text-gray-700">{form.name || "Preview"}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-3 mt-6">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
        <button
          onClick={() => form.name.trim() && onSave(form)}
          disabled={!form.name.trim()}
          className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold transition"
        >
          {isNew ? "Add category" : "Save changes"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Item Modal ──────────────────────────────────────────────────────────────

function ItemModal({
  item, categories, isNew, onSave, onClose,
}: {
  item: MenuItem; categories: Category[]; isNew: boolean;
  onSave: (i: MenuItem) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<MenuItem>({ ...item });
  const [tab, setTab] = useState<"basic" | "variations" | "addons" | "stock">("basic");

  function toggleDietary(d: string) {
    setForm((f) => ({
      ...f,
      dietary: f.dietary.includes(d) ? f.dietary.filter((x) => x !== d) : [...f.dietary, d],
    }));
  }

  // Variations
  function addVariation() {
    setForm((f) => ({ ...f, variations: [...(f.variations ?? []), blankVariation()] }));
  }
  function updateVariation(idx: number, patch: Partial<Variation>) {
    setForm((f) => {
      const v = [...(f.variations ?? [])];
      v[idx] = { ...v[idx], ...patch };
      return { ...f, variations: v };
    });
  }
  function removeVariation(idx: number) {
    setForm((f) => ({ ...f, variations: (f.variations ?? []).filter((_, i) => i !== idx) }));
  }
  function addVariationOption(varIdx: number) {
    setForm((f) => {
      const v = [...(f.variations ?? [])];
      v[varIdx] = { ...v[varIdx], options: [...v[varIdx].options, { id: crypto.randomUUID(), label: "", price: 0 }] };
      return { ...f, variations: v };
    });
  }
  function updateVariationOption(varIdx: number, optIdx: number, patch: { label?: string; price?: number }) {
    setForm((f) => {
      const v = [...(f.variations ?? [])];
      const opts = [...v[varIdx].options];
      opts[optIdx] = { ...opts[optIdx], ...patch };
      v[varIdx] = { ...v[varIdx], options: opts };
      return { ...f, variations: v };
    });
  }
  function removeVariationOption(varIdx: number, optIdx: number) {
    setForm((f) => {
      const v = [...(f.variations ?? [])];
      v[varIdx] = { ...v[varIdx], options: v[varIdx].options.filter((_, i) => i !== optIdx) };
      return { ...f, variations: v };
    });
  }

  // AddOns
  function addAddOn() {
    setForm((f) => ({ ...f, addOns: [...(f.addOns ?? []), blankAddOn()] }));
  }
  function updateAddOn(idx: number, patch: Partial<AddOn>) {
    setForm((f) => {
      const a = [...(f.addOns ?? [])];
      a[idx] = { ...a[idx], ...patch };
      return { ...f, addOns: a };
    });
  }
  function removeAddOn(idx: number) {
    setForm((f) => ({ ...f, addOns: (f.addOns ?? []).filter((_, i) => i !== idx) }));
  }

  const isValid = form.name.trim() && form.price >= 0 && form.categoryId;

  return (
    <ModalShell title={isNew ? "Add menu item" : "Edit menu item"} onClose={onClose} wide>
      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
        {(["basic", "variations", "addons", "stock"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
              tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "addons" ? "Add-ons" : t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "variations" && (form.variations?.length ?? 0) > 0 && (
              <span className="ml-1 bg-orange-100 text-orange-600 rounded-full px-1.5 text-[10px]">
                {form.variations!.length}
              </span>
            )}
            {t === "addons" && (form.addOns?.length ?? 0) > 0 && (
              <span className="ml-1 bg-violet-100 text-violet-600 rounded-full px-1.5 text-[10px]">
                {form.addOns!.length}
              </span>
            )}
            {t === "stock" && (() => {
              const s = resolveStock(form);
              if (s === "out_of_stock") return <span className="ml-1 bg-red-100 text-red-600 rounded-full px-1.5 text-[10px]">OOS</span>;
              if (s === "low_stock") return <span className="ml-1 bg-amber-100 text-amber-600 rounded-full px-1.5 text-[10px]">Low</span>;
              return null;
            })()}
          </button>
        ))}
      </div>

      {/* ── Basic tab ── */}
      {tab === "basic" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Item name *</label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="e.g. Chicken Tikka Masala"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Category *</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Base price (£) *</label>
              <input
                type="number"
                min="0"
                step="0.50"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                placeholder="Brief description of the dish…"
              />
            </div>
            {/* Image */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-2">Item image</label>
              <div className="flex gap-3 items-start">
                {/* Preview */}
                <div className="w-20 h-20 rounded-xl overflow-hidden border-2 border-dashed border-gray-200 flex items-center justify-center flex-shrink-0 bg-gray-50">
                  {form.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.image} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <ImagePlus size={22} className="text-gray-300" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  {/* URL input */}
                  <div className="relative">
                    <Link size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="url"
                      value={form.image?.startsWith("data:") ? "" : (form.image ?? "")}
                      onChange={(e) => setForm((f) => ({ ...f, image: e.target.value || undefined }))}
                      className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder="Paste image URL…"
                    />
                  </div>
                  {/* File upload */}
                  <label className="flex items-center gap-2 cursor-pointer w-full py-2 px-3 rounded-lg border border-gray-200 hover:border-orange-300 hover:text-orange-500 text-gray-500 text-xs font-medium transition">
                    <Upload size={13} />
                    Upload from device
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          setForm((f) => ({ ...f, image: ev.target?.result as string }));
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                  {form.image && (
                    <button
                      onClick={() => setForm((f) => ({ ...f, image: undefined }))}
                      className="text-xs text-red-400 hover:text-red-600 transition"
                    >
                      × Remove image
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Dietary */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">Dietary tags</label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => toggleDietary(d)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all capitalize ${
                    form.dietary.includes(d)
                      ? "border-orange-400 bg-orange-50 text-orange-700"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  {form.dietary.includes(d) && <Check size={10} className="inline mr-1" />}
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Popular toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setForm((f) => ({ ...f, popular: !f.popular }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${form.popular ? "bg-orange-500" : "bg-gray-200"}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.popular ? "translate-x-4" : ""}`} />
            </div>
            <div>
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Flame size={14} className="text-orange-500" /> Mark as popular
              </span>
              <span className="text-xs text-gray-400">Shows a &quot;Popular&quot; badge on the menu</span>
            </div>
          </label>
        </div>
      )}

      {/* ── Variations tab ── */}
      {tab === "variations" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Variations let customers choose between options (e.g. spice level, size). Each variation shows as a required radio group.
          </p>
          {(form.variations ?? []).map((v, vi) => (
            <div key={v.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  value={v.name}
                  onChange={(e) => updateVariation(vi, { name: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Variation name (e.g. Spice level)"
                />
                <button onClick={() => removeVariation(vi)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="space-y-2 pl-2">
                {v.options.map((opt, oi) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <span className="text-gray-300">›</span>
                    <input
                      value={opt.label}
                      onChange={(e) => updateVariationOption(vi, oi, { label: e.target.value })}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder="Option label"
                    />
                    <div className="relative w-24">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">+£</span>
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        value={opt.price}
                        onChange={(e) => updateVariationOption(vi, oi, { price: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-7 pr-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </div>
                    <button onClick={() => removeVariationOption(vi, oi)} className="text-gray-300 hover:text-red-400 transition">
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addVariationOption(vi)}
                  className="text-xs text-orange-500 hover:text-orange-700 font-medium flex items-center gap-1 ml-4 mt-1"
                >
                  <Plus size={11} /> Add option
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={addVariation}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-orange-300 hover:text-orange-500 transition flex items-center justify-center gap-2"
          >
            <Plus size={14} /> Add variation group
          </button>
        </div>
      )}

      {/* ── Add-ons tab ── */}
      {tab === "addons" && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Add-ons are optional extras customers can tick (e.g. extra toppings, dips).
          </p>
          {(form.addOns ?? []).map((ao, ai) => (
            <div key={ao.id} className="flex items-center gap-3">
              <Tag size={14} className="text-violet-400 flex-shrink-0" />
              <input
                value={ao.name}
                onChange={(e) => updateAddOn(ai, { name: e.target.value })}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Add-on name"
              />
              <div className="relative w-24">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">+£</span>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={ao.price}
                  onChange={(e) => updateAddOn(ai, { price: parseFloat(e.target.value) || 0 })}
                  className="w-full pl-7 pr-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <button onClick={() => removeAddOn(ai)} className="text-gray-300 hover:text-red-400 transition">
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={addAddOn}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-violet-300 hover:text-violet-500 transition flex items-center justify-center gap-2"
          >
            <Plus size={14} /> Add-on
          </button>
        </div>
      )}

      {/* ── Stock tab ── */}
      {tab === "stock" && (
        <div className="space-y-5">
          {/* Mode selector */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">Stock tracking mode</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setForm((f) => ({ ...f, stockQty: undefined }))}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all text-left ${
                  typeof form.stockQty !== "number"
                    ? "border-orange-400 bg-orange-50 text-orange-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                <Package size={15} className="flex-shrink-0" />
                <div>
                  <p className="font-semibold text-xs">Manual status</p>
                  <p className="text-[11px] opacity-70 leading-tight">Set availability manually</p>
                </div>
              </button>
              <button
                onClick={() => setForm((f) => ({ ...f, stockQty: typeof f.stockQty === "number" ? f.stockQty : 10 }))}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all text-left ${
                  typeof form.stockQty === "number"
                    ? "border-orange-400 bg-orange-50 text-orange-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                <PackageMinus size={15} className="flex-shrink-0" />
                <div>
                  <p className="font-semibold text-xs">Track quantity</p>
                  <p className="text-[11px] opacity-70 leading-tight">Auto-status from stock count</p>
                </div>
              </button>
            </div>
          </div>

          {/* Manual mode */}
          {typeof form.stockQty !== "number" && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Availability status</p>
              <div className="grid grid-cols-3 gap-2">
                {(["in_stock", "low_stock", "out_of_stock"] as StockStatus[]).map((s) => {
                  const active = (form.stockStatus ?? "in_stock") === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setForm((f) => ({ ...f, stockStatus: s }))}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all ${
                        active
                          ? s === "out_of_stock" ? "border-red-400 bg-red-50"
                          : s === "low_stock"    ? "border-amber-400 bg-amber-50"
                          :                        "border-green-400 bg-green-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {s === "out_of_stock"
                        ? <PackageX size={18} className={active ? "text-red-500" : "text-gray-400"} />
                        : s === "low_stock"
                        ? <PackageMinus size={18} className={active ? "text-amber-500" : "text-gray-400"} />
                        : <Package size={18} className={active ? "text-green-500" : "text-gray-400"} />}
                      <span className={`text-[11px] font-semibold leading-tight text-center ${
                        active
                          ? s === "out_of_stock" ? "text-red-600"
                          : s === "low_stock"    ? "text-amber-600"
                          :                        "text-green-600"
                          : "text-gray-500"
                      }`}>
                        {stockLabel(s)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity tracking mode */}
          {typeof form.stockQty === "number" && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">Current stock quantity</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setForm((f) => ({ ...f, stockQty: Math.max(0, (f.stockQty ?? 0) - 1) }))}
                    className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition active:scale-95"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    min="0"
                    value={form.stockQty}
                    onChange={(e) => setForm((f) => ({ ...f, stockQty: Math.max(0, parseInt(e.target.value) || 0) }))}
                    className="w-24 text-center border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <button
                    onClick={() => setForm((f) => ({ ...f, stockQty: (f.stockQty ?? 0) + 1 }))}
                    className="w-10 h-10 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition active:scale-95"
                  >
                    <Plus size={16} />
                  </button>
                  <span className="text-xs text-gray-400">units</span>
                </div>
              </div>

              {/* Live status preview */}
              {(() => {
                const s = resolveStock(form);
                return (
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                    s === "out_of_stock" ? "bg-red-50 border-red-100"
                    : s === "low_stock" ? "bg-amber-50 border-amber-100"
                    : "bg-green-50 border-green-100"
                  }`}>
                    {s === "out_of_stock"
                      ? <PackageX size={16} className="text-red-500 flex-shrink-0" />
                      : s === "low_stock"
                      ? <PackageMinus size={16} className="text-amber-500 flex-shrink-0" />
                      : <Package size={16} className="text-green-500 flex-shrink-0" />}
                    <div>
                      <p className={`text-sm font-semibold ${
                        s === "out_of_stock" ? "text-red-700"
                        : s === "low_stock" ? "text-amber-700"
                        : "text-green-700"
                      }`}>{stockLabel(s)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {s === "out_of_stock"
                          ? "Item will show as Unavailable and cannot be added to cart."
                          : s === "low_stock"
                          ? `Quantity is at or below the low-stock threshold (${LOW_STOCK_THRESHOLD} units). A "Low stock" badge will appear.`
                          : "Item is available for purchase on the menu."}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* Quick-set presets */}
              <div>
                <p className="text-xs text-gray-400 mb-2">Quick set</p>
                <div className="flex flex-wrap gap-2">
                  {[0, 1, 5, 10, 20, 50].map((n) => (
                    <button
                      key={n}
                      onClick={() => setForm((f) => ({ ...f, stockQty: n }))}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                        form.stockQty === n
                          ? "bg-orange-500 text-white border-orange-500"
                          : "border-gray-200 text-gray-500 hover:border-orange-300 hover:text-orange-600"
                      }`}
                    >
                      {n === 0 ? "0 (OOS)" : n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Info callout */}
          <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
            <AlertTriangle size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              Out-of-stock items display an <strong>Unavailable</strong> label on the menu and cannot be added to cart.
              Low-stock items show a <strong>Low stock</strong> badge.
              Changes apply instantly across all browser tabs.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
        <button
          onClick={() => isValid && onSave(form)}
          disabled={!isValid}
          className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold transition"
        >
          {isNew ? "Add item" : "Save changes"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Confirm Modal ───────────────────────────────────────────────────────────

function ConfirmModal({
  title, message, onConfirm, onClose,
}: {
  title: string; message: string;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="flex gap-3 p-4 bg-red-50 rounded-xl border border-red-100 mb-5">
        <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
        <button
          onClick={onConfirm}
          className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition"
        >
          Delete
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Modal Shell ─────────────────────────────────────────────────────────────

function ModalShell({
  title, onClose, children, wide = false,
}: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh] overflow-hidden ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition text-gray-500">
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}
