"use client";

import { useState } from "react";
import { usePOS } from "@/context/POSContext";
import { POSProduct, POSCategory, POSOffer, getOfferPrice } from "@/types/pos";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronDown, X, Save, Tag, Package } from "lucide-react";
import { fmt } from "../_utils";
import { PRESET_COLORS, buildOffer, handleImageFile } from "./_helpers";

export default function MenuTab() {
  const { products, setProducts, categories, setCategories, settings } = usePOS();

  // Item state
  const [editProduct, setEditProduct] = useState<POSProduct | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "", categoryId: "", price: "", cost: "", emoji: "", imageUrl: "", popular: false,
    offerActive: false, offerType: "percent" as POSOffer["type"],
    offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
    offerBuyQty: "", offerFreeQty: "", offerMinQty: "",
  });
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "", categoryId: "", price: "", cost: "", emoji: "🍽️", imageUrl: "",
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
            name:       editDraft.name.trim(),
            categoryId: editDraft.categoryId,
            price:      parseFloat(editDraft.price),
            cost:       editDraft.cost ? parseFloat(editDraft.cost) : undefined,
            emoji:      editDraft.imageUrl ? undefined : (editDraft.emoji || "🍽️"),
            imageUrl:   editDraft.imageUrl || undefined,
            popular:    editDraft.popular,
            offer:      buildOffer(editDraft),
          }
        : p
    ));
    setEditProduct(null);
  }

  function deleteProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setDeleteConfirm(null);
    setEditProduct(null);
  }

  function addProduct() {
    if (!newProduct.name.trim() || !newProduct.categoryId || !newProduct.price) return;
    const p: POSProduct = {
      id: `p-${Date.now()}`, categoryId: newProduct.categoryId, name: newProduct.name.trim(),
      price: parseFloat(newProduct.price), cost: parseFloat(newProduct.cost) || undefined,
      emoji: newProduct.imageUrl ? undefined : (newProduct.emoji || "🍽️"),
      imageUrl: newProduct.imageUrl || undefined,
      color: "#e2e8f0", trackStock: false, active: true,
      offer: buildOffer(newProduct),
    };
    setProducts((prev) => [...prev, p]);
    setNewProduct({ name: "", categoryId: "", price: "", cost: "", emoji: "🍽️", imageUrl: "",
      offerActive: false, offerType: "percent", offerValue: "", offerLabel: "", offerStart: "", offerEnd: "",
      offerBuyQty: "", offerFreeQty: "", offerMinQty: "" });
    setShowAddProduct(false);
  }

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
                  {t === "items" ? `Items (${products.length})` : `Categories (${categories.length})`}
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
                  const catProducts = products.filter((p) => p.categoryId === cat.id);
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
                                {product.offer?.active && <span className="text-[10px] bg-amber-400/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">{product.offer.label?.trim() || (product.offer.type === "percent" ? `${product.offer.value}% OFF` : product.offer.type === "fixed" ? `${settings.currencySymbol}${product.offer.value} OFF` : "SPECIAL")}</span>}
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

      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-xs p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <h3 className="text-white font-bold mb-1">Delete item?</h3>
            <p className="text-slate-400 text-sm mb-6">
              {products.find((p) => p.id === deleteConfirm)?.name} will be removed from the POS menu. This cannot be undone.
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
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

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
