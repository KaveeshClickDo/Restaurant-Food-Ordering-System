"use client";

import { Category, MenuItem } from "@/types";
import MenuItemCard from "./MenuItemCard";

interface Props {
  categories: Category[];
  items: MenuItem[];
  sectionRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
}

export default function MenuSection({ categories, items, sectionRefs }: Props) {
  // Group items by category
  const grouped = categories
    .map((cat) => ({
      cat,
      items: items.filter((i) => i.categoryId === cat.id),
    }))
    .filter(({ items }) => items.length > 0);

  if (grouped.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-3xl mb-3">🔍</p>
        <p className="font-medium">No items match your search</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {grouped.map(({ cat, items }) => (
        <section
          key={cat.id}
          id={`section-${cat.id}`}
          ref={(el) => { sectionRefs.current[cat.id] = el; }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">{cat.emoji}</span>
            <h2 className="text-lg font-bold text-gray-900">{cat.name}</h2>
            <span className="text-xs text-gray-400 font-medium">({items.length})</span>
          </div>
          <div>
            {items.map((item) => (
              <MenuItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
