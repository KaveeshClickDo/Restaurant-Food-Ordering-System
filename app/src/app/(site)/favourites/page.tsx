"use client";

import { useApp } from "@/context/AppContext";
import { resolveStock } from "@/lib/stockUtils";
import { Heart, UtensilsCrossed, Plus } from "lucide-react";
import AuthModal from "@/components/AuthModal";
import ItemCustomizationModal from "@/components/ItemCustomizationModal";
import Link from "next/link";
import { useState } from "react";
import type { MenuItem } from "@/types";

export default function FavouritesPage() {
  const { currentUser, menuItems, settings, isOpen, toggleFavourite } = useApp();
  const [authModal, setAuthModal] = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);

  const favIds = new Set(currentUser?.favourites ?? []);
  const favItems = menuItems.filter((m) => favIds.has(m.id));

  return (
    <>
      <div className="px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-[22px] text-zinc-900 tracking-tight">Favourites</h2>
          {favItems.length > 0 && (
            <span className="text-[12px] text-zinc-400 tabular-nums">{favItems.length} saved</span>
          )}
        </div>
        <p className="text-[13px] text-zinc-500 mb-5">Your saved dishes — quick to find, quick to order.</p>

        {!currentUser ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
              <Heart className="w-7 h-7 text-zinc-300" strokeWidth={1.4} />
            </div>
            <p className="text-[13.5px] text-zinc-500">Sign in to save your favourite dishes</p>
            <button onClick={() => setAuthModal({ open: true, tab: "login" })}
              className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[13.5px] font-semibold transition-colors">
              Sign in
            </button>
          </div>
        ) : favItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
              <Heart className="w-7 h-7 text-zinc-300" strokeWidth={1.4} />
            </div>
            <p className="text-[14px] font-medium text-zinc-600">No favourites yet</p>
            <p className="text-[13px] text-zinc-400 max-w-xs">
              Tap the ♡ on any dish to save it here for quick reordering.
            </p>
            <Link
              href="/"
              className="mt-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[13.5px] font-semibold transition-colors"
            >
              Browse menu
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {favItems.map((item) => {
              const stockStatus = resolveStock(item);
              const outOfStock = stockStatus === "out_of_stock";
              const canAdd = (isOpen || !!settings.restaurant) && !outOfStock;
              return (
                <div key={item.id} className="bg-white rounded-2xl border border-zinc-200/70 shadow-sm overflow-hidden group">
                  {/* Image */}
                  <div className="relative h-[160px] bg-orange-50 overflow-hidden">
                    {item.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.image} alt={item.name}
                        className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03] ${outOfStock ? "grayscale opacity-50" : ""}`}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <UtensilsCrossed className="w-8 h-8 text-zinc-300" strokeWidth={1.2} />
                      </div>
                    )}
                    {/* Remove from favourites */}
                    <button
                      onClick={() => toggleFavourite(item.id)}
                      aria-label="Remove from favourites"
                      className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
                    >
                      <Heart className="w-3.5 h-3.5" strokeWidth={2} fill="currentColor" />
                    </button>
                  </div>
                  {/* Body */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-medium text-[15px] leading-snug text-zinc-900">{item.name}</h3>
                      <span className="font-semibold text-[15px] text-zinc-900 tabular-nums flex-shrink-0">£{item.price.toFixed(2)}</span>
                    </div>
                    <p className="text-[12.5px] text-zinc-500 leading-snug line-clamp-2 mb-3">{item.description}</p>
                    <button
                      disabled={!canAdd}
                      onClick={() => setOpenItem(item)}
                      className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-all active:scale-[0.98] ${
                        canAdd
                          ? "bg-orange-500 hover:bg-orange-600 text-white"
                          : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                      }`}
                    >
                      <Plus className="w-4 h-4" strokeWidth={2.5} />
                      {outOfStock ? "Unavailable" : "Add to order"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {authModal.open && (
        <AuthModal
          initialTab={authModal.tab}
          onClose={() => setAuthModal({ open: false, tab: "login" })}
        />
      )}

      {openItem && (
        <ItemCustomizationModal item={openItem} onClose={() => setOpenItem(null)} />
      )}
    </>
  );
}