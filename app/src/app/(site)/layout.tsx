"use client";

import AuthModal from "@/components/AuthModal";
import Cart from "@/components/Cart";
import ReservationModal from "@/components/ReservationModal";
import SiteFooter from "@/components/SiteFooter";
import SiteMobileHeader from "@/components/SiteMobileHeader";
import SiteSidebar from "@/components/SiteSidebar";
import { useApp } from "@/context/AppContext";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

// The body lives in an inner component so the outer default export can wrap
// it in <Suspense>. Next.js 15 requires every useSearchParams() consumer to
// sit under a Suspense boundary — without it, every page under this layout
// (e.g. /book) bails the static prerender pass with
// "useSearchParams() should be wrapped in a suspense boundary".
function SiteLayoutContent({ children }: { children: React.ReactNode }) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const activeCat    = searchParams.get("cat") || "all";
  const { cart }     = useApp();
  const cartHasItems = cart.length > 0;

  const [authModal,       setAuthModal]       = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [showReservation, setShowReservation] = useState(false);

  return (
    <div className="h-full flex overflow-hidden" style={{ backgroundColor: "var(--brand-bg, #FAFAF9)" }}>

      <SiteSidebar
        activeCat={activeCat}
        setCat={() => { /* no-op: SiteSidebar's <Link> updates the URL natively */ }}
        onAuth={() => setAuthModal({ open: true, tab: "login" })}
        onReserve={() => setShowReservation(true)}
      />


      {/* Main scroll area */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Mobile top bar — hidden on desktop */}
        <SiteMobileHeader onReserve={() => setShowReservation(true)} />

        <main className="flex-1 flex flex-col overflow-y-auto h-full pb-15 lg:pb-0">
          <div className="flex-1">
            {children}
          </div>

          <div className="mt-0">
            <SiteFooter />
          </div>
        </main>

      </div>

      {/* ── Desktop Right Cart Panel ──
          Collapsed (w-0) while the basket is empty; slides open when the first
          item lands. Width is animated (NOT transform: a transform here would
          become the containing block for the fixed-position CheckoutModal that
          renders inside <Cart>, breaking the overlay when the cart empties on
          order success). The inner wrapper keeps the panel's natural width so
          content doesn't reflow while the aside clips it during the slide. */}
      <aside
        className={`hidden lg:flex flex-shrink-0 h-full overflow-hidden transition-[width] duration-500 ease-in-out ${
          cartHasItems ? "w-[310px] xl:w-[350px] border-l border-zinc-200/70" : "w-0"
        }`}
        aria-hidden={!cartHasItems}
      >
        <div className="w-[310px] xl:w-[350px] flex-shrink-0 h-full flex">
          <Cart onOrderPlaced={() => router.push('/my-orders')} />
        </div>
      </aside>

      {/* ── Global Modals triggered by Sidebar ── */}
      {authModal.open && (
        <AuthModal
          initialTab={authModal.tab}
          onClose={() => setAuthModal({ open: false, tab: "login" })}
        />
      )}

      {showReservation && (
        <ReservationModal onClose={() => setShowReservation(false)} />
      )}
    </div>
  );
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SiteLayoutContent>{children}</SiteLayoutContent>
    </Suspense>
  );
}
