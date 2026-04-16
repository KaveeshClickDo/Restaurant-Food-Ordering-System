"use client";

import { Category, MenuItem } from "@/types";
import MenuItemCard from "@/components/MenuItemCard";
import { Sun, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface Props {
  categories: Category[];
  items: MenuItem[];
  startTime: string;
  endTime: string;
}

export default function BreakfastSection({ categories, items, startTime, endTime }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  const grouped = categories
    .map((cat) => ({ cat, items: items.filter((i) => i.categoryId === cat.id) }))
    .filter(({ items }) => items.length > 0);

  if (grouped.length === 0) return null;

  return (
    <div className="mb-5 rounded-2xl overflow-hidden border border-amber-200 bg-gradient-to-b from-amber-50 to-white shadow-sm">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-400 flex items-center justify-center flex-shrink-0">
            <Sun size={18} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-base">☀️ Breakfast Menu</h2>
            <p className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-0.5">
              <Clock size={11} />
              Available {startTime}–{endTime}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Serving now
          </span>
          {collapsed
            ? <ChevronDown size={18} className="text-amber-400" />
            : <ChevronUp size={18} className="text-amber-400" />}
        </div>
      </button>

      {/* Items */}
      {!collapsed && (
        <div className="px-4 pb-5 space-y-6">
          {grouped.map(({ cat, items: catItems }) => (
            <div key={cat.id}>
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-amber-100">
                <span className="text-lg">{cat.emoji}</span>
                <h3 className="font-semibold text-gray-800 text-sm">{cat.name}</h3>
                <span className="text-xs text-gray-400">({catItems.length})</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {catItems.map((item) => (
                  <MenuItemCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
