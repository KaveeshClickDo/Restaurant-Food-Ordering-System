"use client";

import AuthModal from "@/components/AuthModal";
import CartPanel from "@/components/CartPanel";
import ReservationModal from "@/components/ReservationModal";
import SiteFooter from "@/components/SiteFooter";
import SiteMobileHeader from "@/components/SiteMobileHeader";
import SiteSidebar from "@/components/SiteSidebar";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeCat = searchParams.get("cat") || "all";

  // Hold state for the modals triggered by the Sidebar
  const [authModal, setAuthModal] = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
  const [showReservation, setShowReservation] = useState(false);

  return (
    <div className="h-full flex overflow-hidden" style={{ backgroundColor: "var(--brand-bg, #FAFAF9)" }}>

      <SiteSidebar
        activeCat={activeCat}
        setCat={(id) => { }} // Not needed because SiteSidebar's <Link> updates the URL natively
        onAuth={() => setAuthModal({ open: true, tab: "login" })}
        onReserve={() => setShowReservation(true)}
      />


      {/* Main scroll area */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Mobile top bar — hidden on desktop */}
        <SiteMobileHeader />

        <main className="flex-1 flex flex-col overflow-y-auto h-full">
          <div className="flex-1">
            {children}
          </div>

          <div className="mt-8">
            <SiteFooter />
          </div>
        </main>

      </div>

      {/* ── Desktop Right Cart Panel ── */}
      <aside className="hidden lg:flex w-[340px] flex-shrink-0 h-full border-l border-zinc-200/70 overflow-hidden">
        <CartPanel onOrderPlaced={() => router.push('/my-orders')} />
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
