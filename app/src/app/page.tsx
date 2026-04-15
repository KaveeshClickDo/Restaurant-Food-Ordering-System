"use client";

import { useEffect, useRef, useState } from "react";
import { MenuItem } from "@/types";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CategoryNav from "@/components/CategoryNav";
import MenuSection from "@/components/MenuSection";
import SearchAndFilters, { DietaryFilter } from "@/components/SearchAndFilters";
import Cart from "@/components/Cart";
import { useApp } from "@/context/AppContext";
import { ShoppingBag, X } from "lucide-react";

export default function HomePage() {
  const { cartCount, cartTotal, categories, menuItems } = useApp();
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [dietaryFilters, setDietaryFilters] = useState<DietaryFilter[]>([]);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const isManualScroll = useRef(false);

  // Filter items
  const filtered: MenuItem[] = menuItems.filter((item) => {
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase());
    const matchesDiet =
      dietaryFilters.length === 0 ||
      dietaryFilters.every((f) => item.dietary.includes(f));
    return matchesSearch && matchesDiet;
  });

  const toggleDietary = (f: DietaryFilter) => {
    setDietaryFilters((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
    );
  };

  // ScrollSpy
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isManualScroll.current) return;
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("section-", "");
            setActiveCategory(id);
          }
        });
      },
      { root: container, rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    );

    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [filtered]);

  const scrollToCategory = (id: string) => {
    setActiveCategory(id);
    isManualScroll.current = true;
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => { isManualScroll.current = false; }, 800);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <Header />

      {/* Body */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 pt-4 sm:pt-6 pb-28 xl:pb-6">
        {/* Mobile horizontal category strip */}
        <div className="flex lg:hidden gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => scrollToCategory(cat.id)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                activeCategory === cat.id
                  ? "bg-orange-500 text-white border-orange-500"
                  : "bg-white text-gray-600 border-gray-200"
              }`}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
        </div>

        <div className="flex gap-6">
          {/* Left — sticky category nav (desktop) */}
          <aside className="hidden lg:block w-52 flex-shrink-0">
            <div className="sticky top-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 pb-2">
                  Menu
                </p>
                <CategoryNav
                  categories={categories}
                  activeId={activeCategory}
                  onSelect={scrollToCategory}
                />
              </div>
            </div>
          </aside>

          {/* Middle — menu */}
          <main className="flex-1 min-w-0">
            {/* Search & filters */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-4 mb-4 sm:mb-5">
              <SearchAndFilters
                search={search}
                onSearch={setSearch}
                active={dietaryFilters}
                onToggle={toggleDietary}
              />
            </div>

            {/* Scrollable section */}
            <div ref={scrollRef} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-5">
              <MenuSection
                categories={categories}
                items={filtered}
                sectionRefs={sectionRefs}
              />
            </div>
          </main>

          {/* Right — sticky cart (desktop) */}
          <aside className="hidden xl:block w-80 flex-shrink-0">
            <div className="sticky top-6">
              <Cart />
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile floating cart button */}
      <div className="xl:hidden fixed bottom-6 left-0 right-0 flex justify-center z-40 px-4">
        <button
          onClick={() => setShowMobileCart(true)}
          className="flex items-center gap-3 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3.5 rounded-2xl shadow-2xl transition-all active:scale-95"
        >
          <span className="relative">
            <ShoppingBag size={20} />
            {cartCount > 0 && (
              <span className="absolute -top-2 -right-2 w-4 h-4 bg-white text-orange-500 rounded-full text-[10px] font-bold flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </span>
          <span className="font-semibold">
            {cartCount === 0 ? "View basket" : `${cartCount} item${cartCount > 1 ? "s" : ""} · £${cartTotal.toFixed(2)}`}
          </span>
        </button>
      </div>

      <Footer />

      {/* Mobile cart drawer */}
      {showMobileCart && (
        <div className="xl:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowMobileCart(false)}
          />
          <div className="relative bg-transparent max-h-[85vh] overflow-y-auto p-4 pb-8">
            <button
              onClick={() => setShowMobileCart(false)}
              className="absolute top-2 right-6 z-10 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-md"
            >
              <X size={16} />
            </button>
            <Cart />
          </div>
        </div>
      )}
    </div>
  );
}
