"use client";

import { useEffect, useRef, useState } from "react";
import { MenuItem } from "@/types";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CategoryNav from "@/components/CategoryNav";
import MenuSection from "@/components/MenuSection";
import BreakfastSection from "@/components/BreakfastSection";
import SearchAndFilters, { DietaryFilter } from "@/components/SearchAndFilters";
import Cart from "@/components/Cart";
import { useApp } from "@/context/AppContext";
import { ShoppingBag, X } from "lucide-react";

function isBreakfastActive(startTime: string, endTime: string): boolean {
  const now = new Date();
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

export default function HomePage() {
  const { cartCount, cartTotal, categories, menuItems, settings } = useApp();
  const bm = settings.breakfastMenu;

  const [showBreakfast,  setShowBreakfast]  = useState(false);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id ?? "");
  const [search,         setSearch]         = useState("");
  const [dietaryFilters, setDietaryFilters] = useState<DietaryFilter[]>([]);
  const [showMobileCart, setShowMobileCart] = useState(false);

  const sectionRefs    = useRef<Record<string, HTMLElement | null>>({});
  const scrollRef      = useRef<HTMLDivElement>(null);
  const isManualScroll = useRef(false);

  useEffect(() => {
    setShowBreakfast(
      !!(bm?.enabled && isBreakfastActive(bm.startTime, bm.endTime) && (bm.items ?? []).length > 0)
    );
  }, [bm]);

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

  const toggleDietary = (f: DietaryFilter) =>
    setDietaryFilters((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);

  // ScrollSpy
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isManualScroll.current) return;
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.id.replace("section-", ""));
          }
        });
      },
      { root: container, rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    );

    Object.values(sectionRefs.current).forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [filtered]);

  const scrollToCategory = (id: string) => {
    setActiveCategory(id);
    isManualScroll.current = true;
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => { isManualScroll.current = false; }, 800);
  };

  const hasCart = cartCount > 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />

      {/* ── Sticky mobile category strip ─────────────────────────────────── */}
      <div className="lg:hidden sticky top-0 z-20 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-4">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide py-2.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => scrollToCategory(cat.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-all active:scale-95 ${
                  activeCategory === cat.id
                    ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"
                }`}
              >
                <span className="text-base leading-none">{cat.emoji}</span>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Page body ─────────────────────────────────────────────────────── */}
      {/* pb accounts for the docked cart bar height (~76px) + safe area */}
      <div className="max-w-7xl mx-auto w-full px-3 sm:px-4 pt-4 sm:pt-5 pb-24 xl:pb-6">
        <div className="flex gap-6">

          {/* Left — sticky category nav (desktop only) */}
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

          {/* Centre — menu content */}
          <main className="flex-1 min-w-0 space-y-3 sm:space-y-4">
            {/* Search & filters */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-4">
              <SearchAndFilters
                search={search}
                onSearch={setSearch}
                active={dietaryFilters}
                onToggle={toggleDietary}
              />
            </div>

            {/* Breakfast section */}
            {showBreakfast && (
              <BreakfastSection
                categories={bm!.categories}
                items={bm!.items}
                startTime={bm!.startTime}
                endTime={bm!.endTime}
              />
            )}

            {/* Menu sections */}
            <div ref={scrollRef} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 sm:p-5">
              <MenuSection
                categories={categories}
                items={filtered}
                sectionRefs={sectionRefs}
              />
            </div>
          </main>

          {/* Right — sticky cart (desktop xl+) */}
          <aside className="hidden xl:block w-80 flex-shrink-0">
            <div className="sticky top-6">
              <Cart />
            </div>
          </aside>
        </div>
      </div>

      <Footer />

      {/* ── Docked mobile cart bar ─────────────────────────────────────────
           Always rendered so the space is reserved; opacity-0 when empty.
           Full-width, attached to the bottom edge — feels native.          */}
      <div
        className={`xl:hidden fixed bottom-0 left-0 right-0 z-40 transition-all duration-300 ${
          hasCart
            ? "translate-y-0 opacity-100"
            : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        {/* White backing so it covers content when scrolling */}
        <div className="bg-white border-t border-gray-100 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] px-4 pt-3 pb-5">
          <button
            onClick={() => setShowMobileCart(true)}
            className="w-full flex items-center justify-between bg-orange-500 hover:bg-orange-600 active:bg-orange-700 active:scale-[0.99] text-white px-5 py-3.5 rounded-2xl shadow-lg shadow-orange-500/25 transition-all"
          >
            {/* Left: count badge + label */}
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-7 h-7 bg-white/20 rounded-xl text-sm font-bold">
                {cartCount}
              </span>
              <span className="font-semibold text-base">
                {cartCount === 1 ? "1 item" : `${cartCount} items`}
              </span>
            </div>
            {/* Right: total */}
            <div className="flex items-center gap-2">
              <span className="font-bold text-base">£{cartTotal.toFixed(2)}</span>
              <ShoppingBag size={18} />
            </div>
          </button>
        </div>
      </div>

      {/* ── Mobile cart drawer ─────────────────────────────────────────────── */}
      {showMobileCart && (
        <div className="xl:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowMobileCart(false)}
          />
          <div className="relative bg-transparent max-h-[90vh] overflow-y-auto px-3 pb-6 pt-2">
            <button
              onClick={() => setShowMobileCart(false)}
              className="absolute top-0 right-5 z-10 w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-md"
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
