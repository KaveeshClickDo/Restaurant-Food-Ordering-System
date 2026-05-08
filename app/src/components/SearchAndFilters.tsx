"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

export type DietaryFilter = "vegetarian" | "vegan" | "halal" | "gluten-free";

const DIETARY_OPTIONS: { key: DietaryFilter; label: string; emoji: string }[] = [
  { key: "vegetarian",  label: "Vegetarian",  emoji: "🥦" },
  { key: "vegan",       label: "Vegan",       emoji: "🌱" },
  { key: "halal",       label: "Halal",       emoji: "☪️"  },
  { key: "gluten-free", label: "Gluten-free", emoji: "🌾" },
];

interface Props {
  search: string;
  onSearch: (v: string) => void;
  active: DietaryFilter[];
  onToggle: (f: DietaryFilter) => void;
}

export default function SearchAndFilters({ search, onSearch, active, onToggle }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/* Search input — taller for comfortable touch */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search menu…"
          className="w-full pl-10 pr-10 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent transition"
        />
        {search && (
          <button
            onClick={() => onSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Dietary filter chips — horizontal scroll on mobile */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-0.5 px-0.5">
        <SlidersHorizontal size={14} className="text-gray-400 flex-shrink-0" />
        {DIETARY_OPTIONS.map(({ key, label, emoji }) => (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all active:scale-95 ${
              active.includes(key)
                ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"
            }`}
          >
            <span>{emoji}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
