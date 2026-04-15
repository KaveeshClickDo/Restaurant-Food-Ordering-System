"use client";

import { Category } from "@/types";

interface Props {
  categories: Category[];
  activeId: string;
  onSelect: (id: string) => void;
}

export default function CategoryNav({ categories, activeId, onSelect }: Props) {
  return (
    <nav className="w-full">
      <ul className="space-y-0.5">
        {categories.map((cat) => (
          <li key={cat.id}>
            <button
              onClick={() => onSelect(cat.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2.5 group ${
                activeId === cat.id
                  ? "bg-orange-50 text-orange-600 font-semibold"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className="text-base">{cat.emoji}</span>
              <span className="leading-tight">{cat.name}</span>
              {activeId === cat.id && (
                <span className="ml-auto w-1 h-4 bg-orange-500 rounded-full" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
