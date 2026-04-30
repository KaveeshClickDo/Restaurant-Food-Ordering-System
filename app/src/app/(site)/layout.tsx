import SiteSidebar from "@/components/SiteSidebar";
import SiteFooter from "@/components/SiteFooter";
import SiteMobileHeader from "@/components/SiteMobileHeader";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden" style={{ backgroundColor: "var(--brand-bg, #FAFAF9)" }}>
      {/* Desktop left sidebar — hidden on mobile */}
      <SiteSidebar />

      {/* Main scroll area */}
      <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
        {/* Mobile top bar — hidden on desktop */}
        <SiteMobileHeader />

        <main className="flex-1 flex flex-col min-h-0">
          {children}
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
