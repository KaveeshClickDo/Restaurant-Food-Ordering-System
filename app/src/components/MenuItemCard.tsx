"use client";

import { useState } from "react";
import { MenuItem } from "@/types";
import { Plus, Flame, PackageX, PackageMinus, Heart } from "lucide-react";
import { useApp } from "@/context/AppContext";
import ItemCustomizationModal from "./ItemCustomizationModal";
import { resolveStock } from "@/lib/stockUtils";

const DIETARY_BADGES: Record<string, { label: string; className: string }> = {
  vegetarian:   { label: "V",  className: "bg-green-100 text-green-700 border border-green-200" },
  vegan:        { label: "Ve", className: "bg-emerald-100 text-emerald-700 border border-emerald-200" },
  halal:        { label: "H",  className: "bg-purple-100 text-purple-700 border border-purple-200" },
  "gluten-free":{ label: "GF", className: "bg-amber-100 text-amber-700 border border-amber-200" },
};

export default function MenuItemCard({ item }: { item: MenuItem }) {
  const { isOpen, scheduledTime, currentUser, toggleFavourite, isFavourite } = useApp();
  const [showModal, setShowModal] = useState(false);

  const stockStatus = resolveStock(item);
  const outOfStock  = stockStatus === "out_of_stock";
  const lowStock    = stockStatus === "low_stock";

  // Interactable when: (store open OR a future slot is scheduled) AND item is in stock
  const canAdd = (isOpen || !!scheduledTime) && !outOfStock;

  return (
    <>
      <div
        className={`group flex items-start gap-3 sm:gap-4 py-4 border-b border-gray-100 last:border-0 transition-all ${
          canAdd
            ? "cursor-pointer hover:bg-orange-50/40 active:bg-orange-50/70 -mx-2 px-2 sm:-mx-3 sm:px-3 rounded-xl"
            : outOfStock
            ? "opacity-60 cursor-not-allowed"
            : "opacity-60 cursor-not-allowed"
        }`}
        onClick={() => canAdd && setShowModal(true)}
      >
        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-sm leading-snug">{item.name}</h3>
            {item.popular && !outOfStock && (
              <span className="flex items-center gap-0.5 text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                <Flame size={10} />
                Popular
              </span>
            )}
            {/* Stock status badges */}
            {outOfStock && (
              <span className="flex items-center gap-0.5 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                <PackageX size={10} />
                Unavailable
              </span>
            )}
            {lowStock && !outOfStock && (
              <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <PackageMinus size={10} />
                {typeof item.stockQty === "number" ? `${item.stockQty} left` : "Low stock"}
              </span>
            )}
          </div>

          {/* Dietary */}
          <div className="flex flex-wrap gap-1 mt-1">
            {item.dietary.map((d) => (
              <span
                key={d}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${DIETARY_BADGES[d]?.className ?? "bg-gray-100 text-gray-600"}`}
              >
                {DIETARY_BADGES[d]?.label ?? d}
              </span>
            ))}
          </div>

          <p className="text-gray-500 text-xs mt-1.5 line-clamp-2 leading-relaxed">
            {item.description}
          </p>

          <p className={`font-bold text-sm mt-2 ${outOfStock ? "text-gray-400" : "text-gray-900"}`}>
            £{item.price.toFixed(2)}
          </p>
        </div>

        {/* Image + Add button */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          {item.image ? (
            <div className={`relative w-20 h-20 rounded-xl overflow-hidden border border-gray-100 shadow-sm ${outOfStock ? "grayscale opacity-60" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
              {currentUser && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavourite(item.id); }}
                  className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition"
                  title={isFavourite(item.id) ? "Remove from favourites" : "Add to favourites"}
                >
                  <Heart size={12} className={isFavourite(item.id) ? "text-red-500 fill-red-500" : "text-gray-400"} />
                </button>
              )}
            </div>
          ) : currentUser && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavourite(item.id); }}
              className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-200 hover:border-red-300 transition"
              title={isFavourite(item.id) ? "Remove from favourites" : "Add to favourites"}
            >
              <Heart size={13} className={isFavourite(item.id) ? "text-red-500 fill-red-500" : "text-gray-300"} />
            </button>
          )}

          {outOfStock ? (
            /* Unavailable placeholder — not a button */
            <div className="w-10 h-10 rounded-full flex items-center justify-center border-2 border-gray-200 text-gray-300 cursor-not-allowed">
              <PackageX size={14} />
            </div>
          ) : (
            <button
              disabled={!canAdd}
              onClick={(e) => {
                e.stopPropagation();
                if (canAdd) setShowModal(true);
              }}
              className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                canAdd
                  ? "border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white active:bg-orange-600 active:border-orange-600 active:text-white group-hover:scale-110"
                  : "border-gray-300 text-gray-300 cursor-not-allowed"
              }`}
            >
              <Plus size={18} />
            </button>
          )}
        </div>
      </div>

      {showModal && canAdd && (
        <ItemCustomizationModal item={item} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}
