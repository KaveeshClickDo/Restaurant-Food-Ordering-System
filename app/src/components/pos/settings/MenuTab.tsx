"use client";

import { useState } from "react";
import { usePOS } from "@/context/POSContext";
import { POSProduct, POSCategory, POSOffer, getOfferPrice, isOfferActive } from "@/types/pos";
import type { Variation, AddOn } from "@/types";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronDown, X, Save, Tag, Package, Check } from "lucide-react";
import { fmt } from "../_utils";
import { PRESET_COLORS, buildOffer, handleImageFile } from "./_helpers";

// Dietary options — kept in sync with admin's MenuManagementPanel so both
// editors offer the same set of tags. Bug #2 (admin / POS field parity).
const DIETARY_OPTIONS = ["vegetarian", "vegan", "halal", "gluten-free"] as const;

function blankVariation(): Variation {
  return {
    id: crypto.randomUUID(), name: "", required: true,
    options: [{ id: crypto.randomUUID(), label: "", price: 0 }],
  };
}
function blankAddOn(): AddOn {
  return { id: crypto.randomUUID(), name: "", price: 0 };
}

export default function MenuTab() {
  const { products, setProducts, categories, setCategories, settings } = usePOS();

  // Item state
  const [editProduct, setEditProduct] = useState<POSProduct | null>(null);
  // Bug #2 — POS draft now also carries dietary[], variations[], addOns[],
  // sku, and a description so both editors can save the same item shape.
  const [editDraft, setEditDraft] = useState({
    name: "", categoryId: "", price: "", cost: "", emoji: "", imageUrl: "", popular: false,
    description: "", sku: "",
    dietary: [] as string[],
    variations: [] as Variation[],
    addOns: [] as AddOn[],
    offerActive: false, offerType: "percent" as POSOffer["type"],
    offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
    offerBuyQty: "", offerFreeQty: "", offerMinQty: "",
  });
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "", categoryId: "", price: "", cost: "", emoji: "🍽️", imageUrl: "",
    description: "", sku: "",
    dietary: [] as string[],
    variations: [] as Variation[],
    addOns: [] as AddOn[],
    offerActive: false, offerType: "percent" as POSOffer["type"],
    offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
    offerBuyQty: "", offerFreeQty: "", offerMinQty: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [menuTab, setMenuTab] = useState<"items"|"categories">("items");

  // Category state
  const [editCategory, setEditCategory] = useState<POSCategory | null>(null);
  const [catDraft, setCatDraft] = useState({ name: "", emoji: "", color: "#f97316" });
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: "", emoji: "🍽️", color: "#f97316" });
  const [deleteCatConfirm, setDeleteCatConfirm] = useState<string | null>(null);

  function openEditCategory(cat: POSCategory) {
    setEditCategory(cat);
    setCatDraft({ name: cat.name, emoji: cat.emoji, color: cat.color });
  }

  function saveCategory() {
    if (!editCategory || !catDraft.name.trim()) return;
    setCategories((prev) => prev.map((c) =>
      c.id === editCategory.id
        ? { ...c, name: catDraft.name.trim(), emoji: catDraft.emoji || "🍽️", color: catDraft.color }
        : c
    ));
    setEditCategory(null);
  }

  function deleteCategory(id: string) {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    const remaining = categories.filter((c) => c.id !== id);
    if (remaining.length > 0) {
      setProducts((prev) => prev.map((p) =>
        p.categoryId === id ? { ...p, categoryId: remaining[0].id } : p
      ));
    }
    setDeleteCatConfirm(null);
    setEditCategory(null);
  }

  function addCategory() {
    if (!newCategory.name.trim()) return;
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.order), -1);
    const cat: POSCategory = {
      id: `cat-${Date.now()}`,
      name: newCategory.name.trim(),
      emoji: newCategory.emoji || "🍽️",
      color: newCategory.color,
      order: maxOrder + 1,
    };
    setCategories((prev) => [...prev, cat]);
    setNewCategory({ name: "", emoji: "🍽️", color: "#f97316" });
    setShowAddCategory(false);
  }

  function moveCategoryUp(id: string) {
    const sorted = [...categories].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === id);
    if (idx <= 0) return;
    const updated = sorted.map((c, i) => {
      if (i === idx - 1) return { ...c, order: sorted[idx].order };
      if (i === idx)     return { ...c, order: sorted[idx - 1].order };
      return c;
    });
    setCategories(updated);
  }

  function moveCategoryDown(id: string) {
    const sorted = [...categories].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === id);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const updated = sorted.map((c, i) => {
      if (i === idx)     return { ...c, order: sorted[idx + 1].order };
      if (i === idx + 1) return { ...c, order: sorted[idx].order };
      return c;
    });
    setCategories(updated);
  }

  function toggleProduct(id: string) {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, active: !p.active } : p));
  }

  function openEdit(product: POSProduct) {
    setEditProduct(product);
    const o = product.offer;
    setEditDraft({
      name:         product.name,
      categoryId:   product.categoryId,
      price:        product.price.toString(),
      cost:         product.cost?.toString() ?? "",
      emoji:        product.emoji ?? "🍽️",
      imageUrl:     product.imageUrl ?? "",
      popular:      product.popular ?? false,
      description:  product.description ?? "",
      sku:          product.sku ?? "",
      dietary:      product.dietary ?? [],
      variations:   product.variations ?? [],
      addOns:       product.addOns ?? [],
      offerActive:  o?.active    ?? false,
      offerType:    o?.type      ?? "percent",
      offerValue:   o?.value?.toString()   ?? "",
      offerLabel:   o?.label    ?? "",
      offerStart:   o?.startDate ?? "",
      offerEnd:     o?.endDate   ?? "",
      offerBuyQty:  o?.buyQty?.toString()  ?? "",
      offerFreeQty: o?.freeQty?.toString() ?? "",
      offerMinQty:  o?.minQty?.toString()  ?? "",
    });
  }

  function saveEdit() {
    if (!editProduct || !editDraft.name.trim() || !editDraft.categoryId || !editDraft.price) return;
    setProducts((prev) => prev.map((p) =>
      p.id === editProduct.id
        ? {
            ...p,
            name:        editDraft.name.trim(),
            categoryId:  editDraft.categoryId,
            price:       parseFloat(editDraft.price),
            cost:        editDraft.cost ? parseFloat(editDraft.cost) : undefined,
            emoji:       editDraft.imageUrl ? undefined : (editDraft.emoji || "🍽️"),
            imageUrl:    editDraft.imageUrl || undefined,
            popular:     editDraft.popular,
            description: editDraft.description || undefined,
            sku:         editDraft.sku || undefined,
            dietary:     editDraft.dietary,
            // Strip empty/invalid rows before persisting so admin doesn't
            // render blank variation groups.
            variations:  editDraft.variations
                          .map((v) => ({ ...v, options: v.options.filter((o) => o.label.trim()) }))
                          .filter((v) => v.name.trim() && v.options.length > 0),
            addOns:      editDraft.addOns.filter((a) => a.name.trim()),
            // Pass the pre-edit offer so its channel scope is preserved; a
            // brand-new offer on this item defaults to in-store only.
            offer:       buildOffer(editDraft, editProduct.offer),
          }
        : p
    ));
    setEditProduct(null);
  }

  async function deleteProduct(id: string) {
    // Close the confirm dialog FIRST, in its own render commit. Tearing down
    // the modal and mutating the product grid in the same commit triggers a
    // React DOM reconciliation race ("removeChild of null") under React 19 /
    // Turbopack. Closing first, then awaiting, separates the two updates.
    setDeleteConfirm(null);
    setEditProduct(null);

    // Channel-aware: the server decides whether to fully delete the row (an
    // in-store-only item) or just drop it from the in_store channel (a both-
    // channel item stays on the online menu). Either way it leaves the till.
    try {
      const res = await fetch(`/api/pos/menu/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Couldn't remove the item. Please try again.");
        return;
      }
    } catch {
      alert("Network error — couldn't remove the item.");
      return;
    }
    // Remove from the local grid. The realtime subscription also reconciles
    // other terminals (DELETE event, or an UPDATE that flips the item to
    // online-only so it filters out of the in_store views).
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function addProduct() {
    if (!newProduct.name.trim() || !newProduct.categoryId || !newProduct.price) return;
    const p: POSProduct = {
      id: `p-${Date.now()}`, categoryId: newProduct.categoryId, name: newProduct.name.trim(),
      price: parseFloat(newProduct.price), cost: parseFloat(newProduct.cost) || undefined,
      emoji: newProduct.imageUrl ? undefined : (newProduct.emoji || "🍽️"),
      imageUrl: newProduct.imageUrl || undefined,
      // Pick a pleasant preset tile colour instead of the old flat slate so
      // new POS items aren't all the same grey. Admin can change it later.
      color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
      trackStock: false, active: true,
      // POS only ever creates in-store items; admin manages online exposure.
      channels: ["in_store"],
      description: newProduct.description || undefined,
      sku: newProduct.sku || undefined,
      dietary: newProduct.dietary,
      variations: newProduct.variations
        .map((v) => ({ ...v, options: v.options.filter((o) => o.label.trim()) }))
        .filter((v) => v.name.trim() && v.options.length > 0),
      addOns: newProduct.addOns.filter((a) => a.name.trim()),
      offer: buildOffer(newProduct),
    };
    setProducts((prev) => [...prev, p]);
    setNewProduct({
      name: "", categoryId: "", price: "", cost: "", emoji: "🍽️", imageUrl: "",
      description: "", sku: "",
      dietary: [], variations: [], addOns: [],
      offerActive: false, offerType: "percent", offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
      offerBuyQty: "", offerFreeQty: "", offerMinQty: "",
    });
    setShowAddProduct(false);
  }

  // POS manages the in_store channel only. Online-only items (admin-created
  // deals, or items a POS admin "deleted" which flipped to online-only) are
  // hidden from the POS editor — they're the admin panel's domain.
  const inStoreProducts = products.filter((p) => {
    const ch = p.channels;
    return !ch || ch.length === 0 || ch.includes("in_store");
  });

  return (
    <>
          <div className="space-y-4">
            {/* Items / Categories sub-tabs */}
            <div className="flex gap-2 bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
              {(["items","categories"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMenuTab(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${menuTab === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
                >
                  {t === "items" ? `Items (${inStoreProducts.length})` : `Categories (${categories.length})`}
                </button>
              ))}
            </div>

            {/* ── Items list ───────────────────────────────────────────── */}
            {menuTab === "items" && (
              <>
                <div className="flex justify-end">
                  <button onClick={() => setShowAddProduct(true)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
                    <Plus size={16} /> Add Item
                  </button>
                </div>
                {categories.sort((a,b)=>a.order-b.order).map((cat) => {
                  const catProducts = inStoreProducts.filter((p) => p.categoryId === cat.id);
                  if (catProducts.length === 0) return null;
                  return (
                    <div key={cat.id} className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-700 flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                        <p className="text-white font-semibold text-sm">{cat.emoji} {cat.name}</p>
                        <span className="text-slate-500 text-xs ml-auto">{catProducts.length} items</span>
                      </div>
                      <div className="divide-y divide-slate-700/50">
                        {catProducts.map((product) => (
                          <div key={product.id} className="px-5 py-3 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden" style={{ backgroundColor: product.imageUrl ? undefined : product.color }}>
                              {product.imageUrl
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                                : <span className="w-full h-full flex items-center justify-center text-base">{product.emoji ?? "🍽️"}</span>
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-sm font-semibold ${product.active ? "text-white" : "text-slate-500"}`}>{product.name}</p>
                                {product.popular && <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-medium">Popular</span>}
                                {isOfferActive(product) && product.offer && <span className="text-[10px] bg-amber-400/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">{product.offer.label?.trim() || (product.offer.type === "percent" ? `${product.offer.value}% OFF` : product.offer.type === "fixed" ? `${settings.currencySymbol}${product.offer.value} OFF` : "SPECIAL")}</span>}
                              </div>
                              <p className="text-slate-400 text-xs">
                                {(() => { const op = getOfferPrice(product); return op !== null ? <><span className="text-amber-400 font-semibold">{fmt(op, settings.currencySymbol)}</span> <span className="line-through">{fmt(product.price, settings.currencySymbol)}</span></> : fmt(product.price, settings.currencySymbol); })()}
                                {product.cost ? ` · Cost: ${fmt(product.cost, settings.currencySymbol)}` : ""}
                              </p>
                            </div>
                            <button onClick={() => openEdit(product)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-all">
                              <Pencil size={15} />
                            </button>
                            <button onClick={() => toggleProduct(product.id)} className="transition-colors">
                              {product.active ? <ToggleRight size={24} className="text-green-400" /> : <ToggleLeft size={24} className="text-slate-500" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* ── Categories list ──────────────────────────────────────── */}
            {menuTab === "categories" && (
              <>
                <div className="flex justify-end">
                  <button onClick={() => setShowAddCategory(true)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors">
                    <Plus size={16} /> Add Category
                  </button>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden">
                  {categories.length === 0 && (
                    <p className="text-slate-400 text-sm text-center py-8">No categories yet. Add one to get started.</p>
                  )}
                  <div className="divide-y divide-slate-700/50">
                    {[...categories].sort((a, b) => a.order - b.order).map((cat, idx, arr) => {
                      const itemCount = products.filter((p) => p.categoryId === cat.id).length;
                      return (
                        <div key={cat.id} className="px-4 py-3 flex items-center gap-3">
                          {/* Color swatch + emoji */}
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: cat.color + "33", border: `2px solid ${cat.color}55` }}
                          >
                            {cat.emoji}
                          </div>

                          {/* Name + count */}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-semibold text-sm">{cat.name}</p>
                            <p className="text-slate-400 text-xs">{itemCount} item{itemCount !== 1 ? "s" : ""}</p>
                          </div>

                          {/* Reorder arrows */}
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => moveCategoryUp(cat.id)}
                              disabled={idx === 0}
                              className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                            >
                              <ChevronDown size={14} className="rotate-180" />
                            </button>
                            <button
                              onClick={() => moveCategoryDown(cat.id)}
                              disabled={idx === arr.length - 1}
                              className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                            >
                              <ChevronDown size={14} />
                            </button>
                          </div>

                          {/* Edit */}
                          <button
                            onClick={() => openEditCategory(cat)}
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
                          >
                            <Pencil size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

      {editCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Edit Category</h3>
              <button onClick={() => setEditCategory(null)} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Emoji + Name */}
              <div className="flex gap-3">
                <div className="w-20 flex-shrink-0">
                  <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                  <input
                    value={catDraft.emoji}
                    onChange={(e) => setCatDraft((d) => ({ ...d, emoji: e.target.value }))}
                    placeholder="🍽️"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input
                    value={catDraft.name}
                    onChange={(e) => setCatDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Category name"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCatDraft((d) => ({ ...d, color: c }))}
                      className="w-8 h-8 rounded-lg transition-all"
                      style={{
                        backgroundColor: c,
                        outline: catDraft.color === c ? `3px solid white` : "none",
                        outlineOffset: "2px",
                        boxShadow: catDraft.color === c ? `0 0 0 1px ${c}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="flex items-center gap-3 bg-slate-900 rounded-xl px-4 py-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                  style={{ backgroundColor: catDraft.color + "33", border: `2px solid ${catDraft.color}88` }}
                >
                  {catDraft.emoji || "🍽️"}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{catDraft.name || "Category name"}</p>
                  <p className="text-slate-400 text-xs">Preview</p>
                </div>
                <div className="ml-auto">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: catDraft.color }} />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-700 grid grid-cols-2 gap-2">
              <button
                onClick={() => setDeleteCatConfirm(editCategory.id)}
                className="py-3 rounded-xl border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={14} /> Delete
              </button>
              <button
                onClick={saveCategory}
                disabled={!catDraft.name.trim()}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Save size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete category confirm ─────────────────────────────────────── */}
      {deleteCatConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete category?</h3>
            <p className="text-slate-400 text-sm mb-1">
              <span className="text-white font-semibold">{categories.find((c) => c.id === deleteCatConfirm)?.name}</span> will be removed.
            </p>
            {(() => {
              const count = products.filter((p) => p.categoryId === deleteCatConfirm).length;
              return count > 0 ? (
                <p className="text-amber-400 text-xs mb-5">
                  {count} item{count !== 1 ? "s" : ""} will be moved to the first remaining category.
                </p>
              ) : (
                <p className="text-slate-500 text-xs mb-5">This category has no items.</p>
              );
            })()}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteCatConfirm(null)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => deleteCategory(deleteCatConfirm)} className="py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add category modal ──────────────────────────────────────────── */}
      {showAddCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Add Category</h3>
              <button onClick={() => setShowAddCategory(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-3">
                <div className="w-20 flex-shrink-0">
                  <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                  <input
                    value={newCategory.emoji}
                    onChange={(e) => setNewCategory((d) => ({ ...d, emoji: e.target.value }))}
                    placeholder="🍽️"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input
                    value={newCategory.name}
                    onChange={(e) => setNewCategory((d) => ({ ...d, name: e.target.value }))}
                    placeholder="e.g. Starters"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewCategory((d) => ({ ...d, color: c }))}
                      className="w-8 h-8 rounded-lg transition-all"
                      style={{
                        backgroundColor: c,
                        outline: newCategory.color === c ? `3px solid white` : "none",
                        outlineOffset: "2px",
                        boxShadow: newCategory.color === c ? `0 0 0 1px ${c}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="px-5 pb-5 grid grid-cols-2 gap-2">
              <button onClick={() => setShowAddCategory(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button
                onClick={addCategory}
                disabled={!newCategory.name.trim()}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit product modal ─────────────────────────────────────────── */}
      {editProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Edit Item</h3>
              <button onClick={() => setEditProduct(null)} className="text-slate-400 hover:text-white transition-colors"><X size={18} /></button>
            </div>

            {/* Form */}
            <div className="p-5 space-y-3 max-h-[75vh] overflow-y-auto">

              {/* Image section */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Item Image</label>
                {editDraft.imageUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-600 mb-2" style={{ height: 140 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={editDraft.imageUrl} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
                    <button
                      onClick={() => setEditDraft((d) => ({ ...d, imageUrl: "" }))}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500/80 flex items-center justify-center text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed border-slate-600 hover:border-orange-500 bg-slate-900 cursor-pointer transition-colors mb-2" style={{ height: 100 }}>
                    <Package size={22} className="text-slate-500 mb-1" />
                    <span className="text-xs text-slate-400">Click to upload image</span>
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f, (url) => setEditDraft((d) => ({ ...d, imageUrl: url }))); }}
                    />
                  </label>
                )}
                <input
                  value={editDraft.imageUrl}
                  onChange={(e) => setEditDraft((d) => ({ ...d, imageUrl: e.target.value }))}
                  placeholder="Or paste image URL…"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-xs outline-none focus:border-orange-500 placeholder-slate-500"
                />
              </div>

              {/* Emoji + Name row — emoji only shown when no image */}
              <div className="flex gap-3">
                {!editDraft.imageUrl && (
                  <div className="w-20 flex-shrink-0">
                    <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                    <input
                      value={editDraft.emoji}
                      onChange={(e) => setEditDraft((d) => ({ ...d, emoji: e.target.value }))}
                      placeholder="🍽️"
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Item name"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Category *</label>
                <select
                  value={editDraft.categoryId}
                  onChange={(e) => setEditDraft((d) => ({ ...d, categoryId: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500"
                >
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              </div>

              {/* Price / Cost */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Price ({settings.currencySymbol}) *</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={editDraft.price}
                    onChange={(e) => setEditDraft((d) => ({ ...d, price: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Cost ({settings.currencySymbol})</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={editDraft.cost}
                    onChange={(e) => setEditDraft((d) => ({ ...d, cost: e.target.value }))}
                    placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                  />
                </div>
              </div>

              {/* Margin preview */}
              {editDraft.price && editDraft.cost && parseFloat(editDraft.price) > 0 && (
                <div className="bg-slate-900 rounded-xl px-4 py-2.5 flex items-center justify-between">
                  <span className="text-slate-400 text-xs">Margin</span>
                  <span className="text-green-400 text-sm font-bold">
                    {Math.round(((parseFloat(editDraft.price) - parseFloat(editDraft.cost)) / parseFloat(editDraft.price)) * 100)}%
                    <span className="text-slate-400 font-normal ml-1 text-xs">
                      ({settings.currencySymbol}{(parseFloat(editDraft.price) - parseFloat(editDraft.cost)).toFixed(2)})
                    </span>
                  </span>
                </div>
              )}

              {/* SKU + description (Bug #2 — POS / admin parity) */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">SKU</label>
                <input
                  value={editDraft.sku}
                  onChange={(e) => setEditDraft((d) => ({ ...d, sku: e.target.value }))}
                  placeholder="Optional"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Description</label>
                <textarea
                  value={editDraft.description}
                  rows={2}
                  onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Brief description"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500 resize-none"
                />
              </div>

              {/* Dietary tags — Bug #2 (admin / POS parity). */}
              <DietaryPicker
                value={editDraft.dietary}
                onChange={(next) => setEditDraft((d) => ({ ...d, dietary: next }))}
              />

              {/* Variations + add-ons (Bug #2). The canonical model lives on
                  MenuItem; POS reads/writes both lists directly so admin and
                  POS see the same data without any conversion step. */}
              <VariationsEditor
                value={editDraft.variations}
                currencySymbol={settings.currencySymbol}
                onChange={(next) => setEditDraft((d) => ({ ...d, variations: next }))}
              />
              <AddOnsEditor
                value={editDraft.addOns}
                currencySymbol={settings.currencySymbol}
                onChange={(next) => setEditDraft((d) => ({ ...d, addOns: next }))}
              />

              {/* Offer section */}
              <div className="border border-slate-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-900/60">
                  <div>
                    <p className="text-white text-sm font-medium">Product Offer</p>
                    <p className="text-slate-400 text-xs">Discount shown on the sale tile</p>
                  </div>
                  <button onClick={() => setEditDraft((d) => ({ ...d, offerActive: !d.offerActive }))} className="transition-colors">
                    {editDraft.offerActive ? <ToggleRight size={28} className="text-amber-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
                  </button>
                </div>
                {editDraft.offerActive && (
                  <div className="p-4 space-y-3 bg-slate-900/30">
                    {/* Type grid — 2 rows of 3 */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        ["percent",      "% Off"],
                        ["fixed",        `${settings.currencySymbol} Off`],
                        ["price",        "Set Price"],
                        ["bogo",         "BOGO"],
                        ["multibuy",     "Multi-Buy"],
                        ["qty_discount", "Qty Deal"],
                      ] as [POSOffer["type"], string][]).map(([t, label]) => (
                        <button key={t} onClick={() => setEditDraft((d) => ({ ...d, offerType: t }))}
                          className={`py-2 rounded-lg text-xs font-semibold transition-all ${editDraft.offerType === t ? "bg-amber-400 text-slate-900" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Type-specific inputs */}
                    {(editDraft.offerType === "percent" || editDraft.offerType === "fixed" || editDraft.offerType === "price") && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">
                            {editDraft.offerType === "percent" ? "Discount %" : editDraft.offerType === "fixed" ? `Amount Off (${settings.currencySymbol})` : `Special Price (${settings.currencySymbol})`}
                          </label>
                          <input type="number" min="0" step={editDraft.offerType === "percent" ? "1" : "0.01"}
                            value={editDraft.offerValue} onChange={(e) => setEditDraft((d) => ({ ...d, offerValue: e.target.value }))}
                            placeholder={editDraft.offerType === "percent" ? "e.g. 20" : "0.00"}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge label (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder="e.g. Happy Hour"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {editDraft.offerType === "bogo" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="1" step="1" value={editDraft.offerBuyQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerBuyQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Get free</label>
                          <input type="number" min="1" step="1" value={editDraft.offerFreeQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerFreeQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder="e.g. BOGOF"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {editDraft.offerType === "multibuy" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="2" step="1" value={editDraft.offerBuyQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerBuyQty: e.target.value }))} placeholder="3"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Bundle price ({settings.currencySymbol})</label>
                          <input type="number" min="0" step="0.01" value={editDraft.offerValue}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerValue: e.target.value }))} placeholder="10.00"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder={`${editDraft.offerBuyQty||"3"} for ${settings.currencySymbol}${editDraft.offerValue||"10"}`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {editDraft.offerType === "qty_discount" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Min qty</label>
                          <input type="number" min="2" step="1" value={editDraft.offerMinQty}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerMinQty: e.target.value }))} placeholder="2"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Discount %</label>
                          <input type="number" min="1" max="100" step="1" value={editDraft.offerValue}
                            onChange={(e) => setEditDraft((d) => ({ ...d, offerValue: e.target.value }))} placeholder="15"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={editDraft.offerLabel} onChange={(e) => setEditDraft((d) => ({ ...d, offerLabel: e.target.value }))}
                            placeholder={`${editDraft.offerMinQty||"2"}+ save ${editDraft.offerValue||"15"}%`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {/* Date range */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Start date (optional)</label>
                        <input type="date" value={editDraft.offerStart} onChange={(e) => setEditDraft((d) => ({ ...d, offerStart: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">End date (optional)</label>
                        <input type="date" value={editDraft.offerEnd} onChange={(e) => setEditDraft((d) => ({ ...d, offerEnd: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                    </div>

                    {/* Live preview */}
                    {editDraft.price && (() => {
                      const price = parseFloat(editDraft.price) || 0;
                      const sym = settings.currencySymbol;
                      let preview: string | null = null;
                      if ((editDraft.offerType === "percent" || editDraft.offerType === "fixed" || editDraft.offerType === "price") && editDraft.offerValue) {
                        const mock: POSProduct = { id:"", categoryId:"", name:"", price, color:"", trackStock:false, active:true,
                          offer: { type: editDraft.offerType, value: parseFloat(editDraft.offerValue)||0, active:true } };
                        const op = getOfferPrice(mock);
                        if (op !== null) preview = `${fmt(op,sym)} per item  (was ${fmt(price,sym)})`;
                      } else if (editDraft.offerType === "bogo" && editDraft.offerBuyQty && editDraft.offerFreeQty) {
                        const b = parseInt(editDraft.offerBuyQty), f = parseInt(editDraft.offerFreeQty);
                        preview = `Buy ${b} get ${f} free · pay for ${b} of every ${b+f}`;
                      } else if (editDraft.offerType === "multibuy" && editDraft.offerBuyQty && editDraft.offerValue) {
                        const qty = parseInt(editDraft.offerBuyQty), total = parseFloat(editDraft.offerValue);
                        const saving = price * qty - total;
                        preview = `${qty} for ${fmt(total,sym)} · save ${fmt(saving>0?saving:0,sym)}`;
                      } else if (editDraft.offerType === "qty_discount" && editDraft.offerMinQty && editDraft.offerValue) {
                        const discounted = price * (1 - parseFloat(editDraft.offerValue)/100);
                        preview = `Buy ${editDraft.offerMinQty}+ · ${fmt(discounted,sym)} each (was ${fmt(price,sym)})`;
                      }
                      return preview ? (
                        <div className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-2.5">
                          <Tag size={14} className="text-amber-400 flex-shrink-0" />
                          <span className="text-amber-400 text-xs font-semibold">{preview}</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>

              {/* Popular toggle */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-white text-sm font-medium">Mark as Popular</p>
                  <p className="text-slate-400 text-xs">Shows a &quot;Popular&quot; badge on the tile</p>
                </div>
                <button
                  onClick={() => setEditDraft((d) => ({ ...d, popular: !d.popular }))}
                  className="transition-colors"
                >
                  {editDraft.popular
                    ? <ToggleRight size={28} className="text-orange-400" />
                    : <ToggleLeft size={28} className="text-slate-500" />}
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-700 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDeleteConfirm(editProduct.id)}
                  className="py-3 rounded-xl border border-red-500/40 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={14} /> Delete
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!editDraft.name.trim() || !editDraft.categoryId || !editDraft.price}
                  className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save size={14} /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────── */}

      {deleteConfirm && (() => {
        const target = products.find((p) => p.id === deleteConfirm);
        const ch = target?.channels;
        const alsoOnline = !ch || ch.length === 0 || ch.includes("online");
        return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">
              {alsoOnline ? "Remove from till?" : "Delete item?"}
            </h3>
            <p className="text-slate-400 text-sm mb-6">
              {alsoOnline ? (
                <><span className="text-white font-medium">{target?.name}</span> will be removed from the POS till but stays on the online menu. Manage online from the admin panel.</>
              ) : (
                <><span className="text-white font-medium">{target?.name}</span> will be permanently deleted. This cannot be undone.</>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteProduct(deleteConfirm)}
                className="py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors"
              >
                {alsoOnline ? "Remove" : "Delete"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Add product modal ──────────────────────────────────────────── */}

      {showAddProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <h3 className="text-white font-bold">Add Menu Item</h3>
              <button onClick={() => setShowAddProduct(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 max-h-[75vh] overflow-y-auto">

              {/* Image section */}
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Item Image</label>
                {newProduct.imageUrl ? (
                  <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-600 mb-2" style={{ height: 140 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={newProduct.imageUrl} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
                    <button
                      onClick={() => setNewProduct((p) => ({ ...p, imageUrl: "" }))}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500/80 flex items-center justify-center text-white transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed border-slate-600 hover:border-orange-500 bg-slate-900 cursor-pointer transition-colors mb-2" style={{ height: 100 }}>
                    <Package size={22} className="text-slate-500 mb-1" />
                    <span className="text-xs text-slate-400">Click to upload image</span>
                    <input
                      type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f, (url) => setNewProduct((p) => ({ ...p, imageUrl: url }))); }}
                    />
                  </label>
                )}
                <input
                  value={newProduct.imageUrl}
                  onChange={(e) => setNewProduct((p) => ({ ...p, imageUrl: e.target.value }))}
                  placeholder="Or paste image URL…"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-xs outline-none focus:border-orange-500 placeholder-slate-500"
                />
              </div>

              <div className="flex gap-3">
                {!newProduct.imageUrl && (
                  <div className="w-20 flex-shrink-0">
                    <label className="text-xs text-slate-400 mb-1 block">Emoji</label>
                    <input value={newProduct.emoji} onChange={(e) => setNewProduct((p) => ({ ...p, emoji: e.target.value }))} placeholder="🍽️"
                      className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-center text-xl outline-none focus:border-orange-500" />
                  </div>
                )}
                <div className="flex-1">
                  <label className="text-xs text-slate-400 mb-1 block">Name *</label>
                  <input value={newProduct.name} onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))} placeholder="Item name"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Category *</label>
                <select value={newProduct.categoryId} onChange={(e) => setNewProduct((p) => ({ ...p, categoryId: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500">
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Price ({settings.currencySymbol}) *</label>
                  <input type="number" step="0.01" min="0" value={newProduct.price} onChange={(e) => setNewProduct((p) => ({ ...p, price: e.target.value }))} placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Cost ({settings.currencySymbol})</label>
                  <input type="number" step="0.01" min="0" value={newProduct.cost} onChange={(e) => setNewProduct((p) => ({ ...p, cost: e.target.value }))} placeholder="0.00"
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500" />
                </div>
              </div>

              {/* SKU + description (Bug #2 — POS / admin parity) */}
              <div>
                <label className="text-xs text-slate-400 mb-1 block">SKU</label>
                <input
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct((p) => ({ ...p, sku: e.target.value }))}
                  placeholder="Optional"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Description</label>
                <textarea
                  value={newProduct.description}
                  rows={2}
                  onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Brief description"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-2 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500 resize-none"
                />
              </div>

              {/* Dietary tags — Bug #2 (admin / POS parity). */}
              <DietaryPicker
                value={newProduct.dietary}
                onChange={(next) => setNewProduct((p) => ({ ...p, dietary: next }))}
              />

              {/* Variations + add-ons (Bug #2). */}
              <VariationsEditor
                value={newProduct.variations}
                currencySymbol={settings.currencySymbol}
                onChange={(next) => setNewProduct((p) => ({ ...p, variations: next }))}
              />
              <AddOnsEditor
                value={newProduct.addOns}
                currencySymbol={settings.currencySymbol}
                onChange={(next) => setNewProduct((p) => ({ ...p, addOns: next }))}
              />

              {/* Offer section */}
              <div className="border border-slate-700 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-900/60">
                  <div>
                    <p className="text-white text-sm font-medium">Product Offer</p>
                    <p className="text-slate-400 text-xs">Optional discount on this item</p>
                  </div>
                  <button onClick={() => setNewProduct((p) => ({ ...p, offerActive: !p.offerActive }))} className="transition-colors">
                    {newProduct.offerActive ? <ToggleRight size={28} className="text-amber-400" /> : <ToggleLeft size={28} className="text-slate-500" />}
                  </button>
                </div>
                {newProduct.offerActive && (
                  <div className="p-4 space-y-3 bg-slate-900/30">
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        ["percent",      "% Off"],
                        ["fixed",        `${settings.currencySymbol} Off`],
                        ["price",        "Set Price"],
                        ["bogo",         "BOGO"],
                        ["multibuy",     "Multi-Buy"],
                        ["qty_discount", "Qty Deal"],
                      ] as [POSOffer["type"], string][]).map(([t, label]) => (
                        <button key={t} onClick={() => setNewProduct((p) => ({ ...p, offerType: t }))}
                          className={`py-2 rounded-lg text-xs font-semibold transition-all ${newProduct.offerType === t ? "bg-amber-400 text-slate-900" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {(newProduct.offerType === "percent" || newProduct.offerType === "fixed" || newProduct.offerType === "price") && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">
                            {newProduct.offerType === "percent" ? "Discount %" : newProduct.offerType === "fixed" ? `Amount Off (${settings.currencySymbol})` : `Special Price (${settings.currencySymbol})`}
                          </label>
                          <input type="number" min="0" step={newProduct.offerType === "percent" ? "1" : "0.01"}
                            value={newProduct.offerValue} onChange={(e) => setNewProduct((p) => ({ ...p, offerValue: e.target.value }))}
                            placeholder={newProduct.offerType === "percent" ? "e.g. 20" : "0.00"}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge label (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder="e.g. Happy Hour"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {newProduct.offerType === "bogo" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="1" step="1" value={newProduct.offerBuyQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerBuyQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Get free</label>
                          <input type="number" min="1" step="1" value={newProduct.offerFreeQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerFreeQty: e.target.value }))} placeholder="1"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder="e.g. BOGOF"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {newProduct.offerType === "multibuy" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Buy qty</label>
                          <input type="number" min="2" step="1" value={newProduct.offerBuyQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerBuyQty: e.target.value }))} placeholder="3"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Bundle price ({settings.currencySymbol})</label>
                          <input type="number" min="0" step="0.01" value={newProduct.offerValue}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerValue: e.target.value }))} placeholder="10.00"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder={`${newProduct.offerBuyQty||"3"} for ${settings.currencySymbol}${newProduct.offerValue||"10"}`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    {newProduct.offerType === "qty_discount" && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Min qty</label>
                          <input type="number" min="2" step="1" value={newProduct.offerMinQty}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerMinQty: e.target.value }))} placeholder="2"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Discount %</label>
                          <input type="number" min="1" max="100" step="1" value={newProduct.offerValue}
                            onChange={(e) => setNewProduct((p) => ({ ...p, offerValue: e.target.value }))} placeholder="15"
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400 mb-1 block">Badge (optional)</label>
                          <input value={newProduct.offerLabel} onChange={(e) => setNewProduct((p) => ({ ...p, offerLabel: e.target.value }))}
                            placeholder={`${newProduct.offerMinQty||"2"}+ save ${newProduct.offerValue||"15"}%`}
                            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400 placeholder-slate-500" />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Start date (optional)</label>
                        <input type="date" value={newProduct.offerStart} onChange={(e) => setNewProduct((p) => ({ ...p, offerStart: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">End date (optional)</label>
                        <input type="date" value={newProduct.offerEnd} onChange={(e) => setNewProduct((p) => ({ ...p, offerEnd: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-amber-400" />
                      </div>
                    </div>

                    {newProduct.price && (() => {
                      const price = parseFloat(newProduct.price) || 0;
                      const sym = settings.currencySymbol;
                      let preview: string | null = null;
                      if ((newProduct.offerType === "percent" || newProduct.offerType === "fixed" || newProduct.offerType === "price") && newProduct.offerValue) {
                        const mock: POSProduct = { id:"", categoryId:"", name:"", price, color:"", trackStock:false, active:true,
                          offer: { type: newProduct.offerType, value: parseFloat(newProduct.offerValue)||0, active:true } };
                        const op = getOfferPrice(mock);
                        if (op !== null) preview = `${fmt(op,sym)} per item  (was ${fmt(price,sym)})`;
                      } else if (newProduct.offerType === "bogo" && newProduct.offerBuyQty && newProduct.offerFreeQty) {
                        const b = parseInt(newProduct.offerBuyQty), f = parseInt(newProduct.offerFreeQty);
                        preview = `Buy ${b} get ${f} free · pay for ${b} of every ${b+f}`;
                      } else if (newProduct.offerType === "multibuy" && newProduct.offerBuyQty && newProduct.offerValue) {
                        const qty = parseInt(newProduct.offerBuyQty), total = parseFloat(newProduct.offerValue);
                        const saving = price * qty - total;
                        preview = `${qty} for ${fmt(total,sym)} · save ${fmt(saving>0?saving:0,sym)}`;
                      } else if (newProduct.offerType === "qty_discount" && newProduct.offerMinQty && newProduct.offerValue) {
                        const discounted = price * (1 - parseFloat(newProduct.offerValue)/100);
                        preview = `Buy ${newProduct.offerMinQty}+ · ${fmt(discounted,sym)} each (was ${fmt(price,sym)})`;
                      }
                      return preview ? (
                        <div className="flex items-center gap-3 bg-amber-400/10 border border-amber-400/30 rounded-xl px-4 py-2.5">
                          <Tag size={14} className="text-amber-400 flex-shrink-0" />
                          <span className="text-amber-400 text-xs font-semibold">{preview}</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 pb-5 grid grid-cols-2 gap-2">
              <button onClick={() => setShowAddProduct(false)} className="py-3 rounded-xl border border-slate-600 text-slate-300 font-semibold text-sm hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={addProduct} disabled={!newProduct.name.trim() || !newProduct.categoryId || !newProduct.price}
                className="py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Add Item</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Shared sub-editors (Bug #2 — admin / POS field parity) ──────────────────
// These mirror the admin MenuManagementPanel UI for dietary tags, variations,
// and add-ons so an item edited in the POS produces the same data shape an
// admin edit would. The wording on labels and helper copy is intentionally
// kept identical so the operator gets a consistent experience.

function DietaryPicker({
  value, onChange,
}: { value: string[]; onChange: (next: string[]) => void }) {
  function toggle(tag: string) {
    onChange(value.includes(tag) ? value.filter((x) => x !== tag) : [...value, tag]);
  }
  return (
    <div>
      <label className="text-xs text-slate-400 mb-2 block">Dietary tags</label>
      <div className="flex flex-wrap gap-2">
        {DIETARY_OPTIONS.map((d) => {
          const active = value.includes(d);
          return (
            <button
              key={d}
              onClick={() => toggle(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-all capitalize ${
                active
                  ? "border-orange-400 bg-orange-500/10 text-orange-300"
                  : "border-slate-600 text-slate-400 hover:border-slate-500"
              }`}
            >
              {active && <Check size={10} className="inline mr-1" />}
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VariationsEditor({
  value, currencySymbol, onChange,
}: { value: Variation[]; currencySymbol: string; onChange: (next: Variation[]) => void }) {
  const sym = currencySymbol;

  function update(idx: number, patch: Partial<Variation>) {
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, blankVariation()]);
  }
  function addOption(idx: number) {
    const v = value[idx];
    update(idx, { options: [...v.options, { id: crypto.randomUUID(), label: "", price: 0 }] });
  }
  function updateOption(vIdx: number, oIdx: number, patch: { label?: string; price?: number }) {
    const v = value[vIdx];
    update(vIdx, { options: v.options.map((o, i) => (i === oIdx ? { ...o, ...patch } : o)) });
  }
  function removeOption(vIdx: number, oIdx: number) {
    const v = value[vIdx];
    update(vIdx, { options: v.options.filter((_, i) => i !== oIdx) });
  }

  return (
    <div>
      <label className="text-xs text-slate-400 mb-2 block">Variations</label>
      <p className="text-[11px] text-slate-500 mb-2">
        Required choice groups (e.g. spice level, size). Customer must pick one option.
      </p>
      <div className="space-y-3">
        {value.map((v, vi) => {
          const isRequired = v.required !== false;
          return (
            <div key={v.id} className="border border-slate-700 rounded-xl p-3 space-y-2 bg-slate-900/40">
              <div className="flex items-center gap-2">
                <input
                  value={v.name}
                  onChange={(e) => update(vi, { name: e.target.value })}
                  placeholder="Variation name (e.g. Size)"
                  className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                />
                <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={isRequired}
                    onChange={(e) => update(vi, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  onClick={() => remove(vi)}
                  className="text-slate-400 hover:text-red-400 transition-colors"
                  aria-label="Remove variation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="space-y-1.5 pl-2">
                {v.options.map((opt, oi) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <span className="text-slate-500">›</span>
                    <input
                      value={opt.label}
                      onChange={(e) => updateOption(vi, oi, { label: e.target.value })}
                      placeholder="Option label"
                      className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
                    />
                    <div className="relative w-24">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">+{sym}</span>
                      <input
                        type="number" min="0" step="0.25"
                        value={opt.price}
                        onChange={(e) => updateOption(vi, oi, { price: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-6 pr-2 py-1 text-white text-sm outline-none focus:border-orange-500"
                      />
                    </div>
                    <button onClick={() => removeOption(vi, oi)} className="text-slate-500 hover:text-red-400">
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addOption(vi)}
                  className="text-xs text-orange-400 hover:text-orange-300 font-medium flex items-center gap-1 ml-3 mt-1"
                >
                  <Plus size={11} /> Add option
                </button>
              </div>
            </div>
          );
        })}
        <button
          onClick={add}
          className="w-full py-2 rounded-xl border-2 border-dashed border-slate-600 text-sm text-slate-400 hover:border-orange-500 hover:text-orange-400 transition flex items-center justify-center gap-2"
        >
          <Plus size={14} /> Add variation group
        </button>
      </div>
    </div>
  );
}

function AddOnsEditor({
  value, currencySymbol, onChange,
}: { value: AddOn[]; currencySymbol: string; onChange: (next: AddOn[]) => void }) {
  const sym = currencySymbol;

  function update(idx: number, patch: Partial<AddOn>) {
    onChange(value.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...value, blankAddOn()]);
  }

  return (
    <div>
      <label className="text-xs text-slate-400 mb-2 block">Add-ons</label>
      <p className="text-[11px] text-slate-500 mb-2">
        Optional extras the customer can multi-select (e.g. extra toppings).
      </p>
      <div className="space-y-2">
        {value.map((a, ai) => (
          <div key={a.id} className="flex items-center gap-2">
            <Tag size={13} className="text-violet-400 flex-shrink-0" />
            <input
              value={a.name}
              onChange={(e) => update(ai, { name: e.target.value })}
              placeholder="Add-on name"
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-orange-500 placeholder-slate-500"
            />
            <div className="relative w-24">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">+{sym}</span>
              <input
                type="number" min="0" step="0.25"
                value={a.price}
                onChange={(e) => update(ai, { price: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-6 pr-2 py-1.5 text-white text-sm outline-none focus:border-orange-500"
              />
            </div>
            <button onClick={() => remove(ai)} className="text-slate-500 hover:text-red-400">
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={add}
          className="w-full py-2 rounded-xl border-2 border-dashed border-slate-600 text-sm text-slate-400 hover:border-violet-500 hover:text-violet-400 transition flex items-center justify-center gap-2"
        >
          <Plus size={14} /> Add-on
        </button>
      </div>
    </div>
  );
}
