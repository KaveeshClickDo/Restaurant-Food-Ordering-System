"use client";

import { Category, MealPeriod, MenuItem } from "@/types";
import MenuItemCard from "@/components/MenuItemCard";
import { Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface Props {
  period: MealPeriod;
  categories: Category[];
  items: MenuItem[];
}

export default function MealPeriodSection({ period, categories, items }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  const grouped = categories
    .map((cat) => ({ cat, items: items.filter((i) => i.categoryId === cat.id) }))
    .filter(({ items }) => items.length > 0);

  if (grouped.length === 0) return null;

  // Fallback to the default amber if missing
  const tColor = period.themeColor || "#f59e0b";

  return (
    <div
      className="mb-5 rounded-2xl overflow-hidden shadow-sm"
      style={{
        borderColor: `${tColor}4D`,
        background: `linear-gradient(to bottom, ${tColor}1A, #ffffff)`
      }}
    >

      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"

      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: tColor }}
          >
            <Clock size={18} className="text-white" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-base">{period.name}</h2>
            <p
              className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-0.5"
              style={{ color: tColor }}
            >
              <Clock size={11} />
              Available {period.startTime}–{period.endTime}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border"
            style={{
              backgroundColor: `${tColor}1A`, 
              borderColor: `${tColor}4D`,    
              color: tColor
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: tColor }}
            />
            Serving now
          </span>
          {collapsed
            ? <ChevronDown size={18} style={{ color: tColor }} />
            : <ChevronUp size={18} style={{ color: tColor }} />}
        </div>
      </button>

      {/* Items */}
      {!collapsed && (
        <div className="px-4 pb-5 space-y-6">
          {grouped.map(({ cat, items: catItems }) => (
            <div key={cat.id}>
              <div
                className="flex items-center gap-2 mb-3 pb-2 border-b"
                style={{ borderColor: `${tColor}33` }}
              >
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
