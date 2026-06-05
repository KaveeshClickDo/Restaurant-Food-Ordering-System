"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { useIdleLogout } from "@/lib/useIdleLogout";
import OperationsPanel from "@/components/admin/OperationsPanel";
import SchedulePanel from "@/components/admin/SchedulePanel";
import IntegrationsPanel from "@/components/admin/IntegrationsPanel";
import MenuManagementPanel from "@/components/admin/MenuManagementPanel";
import CustomersPanel from "@/components/admin/CustomersPanel";
import DeliveryPanel from "@/components/admin/DeliveryPanel";
import DeliveryZonesPanel from "@/components/admin/DeliveryZonesPanel";
import EmailTemplatesPanel from "@/components/admin/EmailTemplatesPanel";
import CustomPagesPanel from "@/components/admin/CustomPagesPanel";
import MenuLinksPanel from "@/components/admin/MenuLinksPanel";
import ColorSettingsPanel from "@/components/admin/ColorSettingsPanel";
import FooterLogosPanel from "@/components/admin/FooterLogosPanel";
import ReceiptSettingsPanel from "@/components/admin/ReceiptSettingsPanel";
import CouponsPanel from "@/components/admin/CouponsPanel";
import TaxSettingsPanel from "@/components/admin/TaxSettingsPanel";
import DriversPanel from "@/components/admin/DriversPanel";
import RefundsPanel from "@/components/admin/RefundsPanel";
import OrderMonitorPanel from "@/components/admin/OrderMonitorPanel";
import OrderHistoryPanel from "@/components/admin/OrderHistoryPanel";
import PaymentsPanel from "@/components/admin/PaymentsPanel";
import POSReportsPanel from "@/components/admin/POSReportsPanel";
import OnlineReportsPanel from "@/components/admin/OnlineReportsPanel";
import WaitersPanel from "@/components/admin/WaitersPanel";
import KitchenStaffPanel from "@/components/admin/KitchenStaffPanel";
import POSStaffPanel from "@/components/admin/POSStaffPanel";
import CollectionStaffPanel from "@/components/admin/CollectionStaffPanel";
import GiftCardsPanel from "@/components/admin/GiftCardsPanel";
import ReservationsPanel from "@/components/admin/ReservationsPanel";
import TableStatusPanel from "@/components/admin/TableStatusPanel";
import ReservationCustomersPanel from "@/components/admin/ReservationCustomersPanel";
import {
  LayoutDashboard, ExternalLink, ShieldCheck, Store, Calendar, Plug, ChefHat, Users, Truck,
  MapPin, Bell, X, Mail, FileText, Navigation, Palette, ImageIcon, Receipt,
  Tag, Percent, Car, RotateCcw, BarChart3, LineChart, UtensilsCrossed, CalendarDays, BookUser,
  Menu as MenuIcon, ChevronDown, ChevronRight, ChevronLeft,
  Tablet, CreditCard, Globe, Monitor, Compass, Gift, ClipboardList,
  PackageCheck,
} from "lucide-react";

// ─── Navigation structure ─────────────────────────────────────────────────────

type NavItem = { id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };
type NavGroup = { id: string; label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: "orders", label: "Orders",
    items: [
      { id: "online-orders", label: "Online Orders", icon: Truck },
      { id: "pos-orders", label: "POS Orders", icon: Tablet },
      { id: "dine-in-orders", label: "Dine-in Orders", icon: UtensilsCrossed },
      { id: "order-history", label: "Order History", icon: ClipboardList },
    ],
  },
  {
    id: "menu", label: "Menu",
    items: [
      { id: "menu", label: "Menu Items", icon: ChefHat },
    ],
  },
  {
    id: "customers", label: "Customers & Services",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "drivers", label: "Drivers", icon: Car },
      { id: "reservations", label: "Reservations", icon: CalendarDays },
      { id: "table-status", label: "Tables", icon: UtensilsCrossed },
    ],
  },
  {
    id: "table-service", label: "Table Service",
    items: [
      { id: "waiters", label: "Waiter Staff", icon: UtensilsCrossed },
      { id: "kitchen-staff", label: "Kitchen Staff", icon: ChefHat },
      { id: "pos-staff", label: "POS Staff", icon: Tablet },
      { id: "collection-staff", label: "Collection Staff", icon: PackageCheck },
      { id: "reservation-customers", label: "Guest Profiles", icon: BookUser },
    ],
  },
  {
    id: "finance", label: "Finance",
    items: [
      { id: "online-payments", label: "Online Payments", icon: CreditCard },
      { id: "online-refunds", label: "Online Refunds", icon: RotateCcw },
      { id: "online-reports", label: "Finance Reports", icon: LineChart },
      { id: "coupons", label: "Coupons", icon: Tag },
      { id: "gift-cards", label: "Gift Cards", icon: Gift },
      { id: "tax", label: "Tax & VAT", icon: Percent },
      { id: "pos-reports", label: "POS Reports", icon: BarChart3 },
    ],
  },
  {
    id: "settings", label: "Settings",
    items: [
      { id: "operations", label: "Operations", icon: Store },
      { id: "schedule", label: "Schedule", icon: Calendar },
      { id: "zones", label: "Delivery Zones", icon: MapPin },
      { id: "integrations", label: "Integrations", icon: Plug },
    ],
  },
  {
    id: "templates", label: "Templates",
    items: [
      { id: "email", label: "Email Templates", icon: Mail },
      { id: "receipt", label: "Receipt", icon: Receipt },
    ],
  },
  {
    id: "content", label: "Content & SEO",
    items: [
      { id: "custom-pages", label: "Pages", icon: FileText },
      { id: "nav-menus", label: "Navigation", icon: Navigation },
      { id: "colors", label: "Brand Colors", icon: Palette },
      { id: "footer-logos", label: "Footer Logos", icon: ImageIcon },
    ],
  },
];

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items);
type TabId = string;

// ─── "Go To" sub-app links ────────────────────────────────────────────────────
// Surfaced by the "Go To" popover in the sidebar bottom — lets admin hop to
// any sub-app without leaving the admin session. Each link opens in a new tab
// so this view stays put.

interface SubAppLink {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const SUB_APP_LINKS: SubAppLink[] = [
  { href: "/", label: "Customer Site", description: "Public ordering site", icon: Globe },
  { href: "/pos", label: "POS Terminal", description: "Cashier checkout", icon: Tablet },
  { href: "/kitchen", label: "Kitchen Display", description: "KDS order queue", icon: ChefHat },
  { href: "/waiter", label: "Waiter App", description: "Table service / orders", icon: UtensilsCrossed },
  { href: "/customer-display", label: "Customer Display", description: "Counter-facing screen", icon: Monitor },
  { href: "/driver", label: "Driver App", description: "Delivery dispatch view", icon: Truck },
];

// ─── Welcome banner copy ──────────────────────────────────────────────────────

function bannerSubtitle(
  tab: string,
  menuItemsLen: number,
  categoriesLen: number,
  customersLen: number,
  activeOrderCount: number,
  settings: ReturnType<typeof useApp>["settings"],
) {
  const s = settings;
  switch (tab) {
    case "menu": return `Managing ${menuItemsLen} items across ${categoriesLen} categories.`;
    case "customers": return `${customersLen} registered customers · manage orders & history.`;
    case "online-orders": return `${activeOrderCount} active order${activeOrderCount !== 1 ? "s" : ""} in the queue · online deliveries and collections today.`;
    case "pos-orders": return "Live view of POS counter (walk-in) sales — status, today's completed count, and earnings. Read-only.";
    case "dine-in-orders": return "Live view of dine-in / table-service orders — status, today's completed count, and earnings. Read-only.";
    case "order-history": return "All-time order archive across every source — delivery, collection, walk-in, and dine-in. Read-only.";
    case "zones": return "Define delivery zones, set per-zone fees, and control distance rules.";
    case "operations": return "Update branding, fees, timings, and address. All changes apply instantly.";
    case "email": return `${s.emailTemplates?.filter((t) => t.enabled).length ?? 0} active email templates · customise messages sent to customers.`;
    case "custom-pages": return `${(s.customPages ?? []).filter((p) => p.published).length} published · standalone pages with custom content and SEO.`;
    case "nav-menus": return "Assign pages to header and footer menus, control ordering, and toggle visibility.";
    case "colors": return "Customise brand colour and page background — changes apply live across the site.";
    case "footer-logos": return `${(s.footerLogos ?? []).filter((l) => l.enabled).length} active logo${(s.footerLogos ?? []).filter((l) => l.enabled).length !== 1 ? "s" : ""} · upload payment icons, partner logos, and badges.`;
    case "receipt": return "Configure what appears on printed and emailed receipts — name, phone, VAT number, and footer.";
    case "coupons": return `${(s.coupons ?? []).filter((c) => c.active).length} active coupon${(s.coupons ?? []).filter((c) => c.active).length !== 1 ? "s" : ""} · percentage and fixed-amount discount codes.`;
    case "gift-cards": return "Prepaid gift card codes — issue manually, track balances, void, and view redemption history.";
    case "tax": return s.taxSettings?.enabled ? `VAT ${s.taxSettings.rate}% · ${s.taxSettings.inclusive ? "inclusive" : "exclusive"} mode.` : "VAT is currently disabled.";
    case "drivers": return "Manage driver accounts and track deliveries.";
    case "online-refunds": return "Process full or partial refunds on online orders, choose refund method, and view the full refund history.";
    case "online-payments": return "Online Stripe and cash transactions with status, customer, and gateway links — every online order where money actually moved.";
    case "online-reports": return "Revenue, orders, refunds, VAT, and payment breakdowns — filter by date range and export to CSV or PDF.";
    case "pos-reports": return "View POS sales reports — revenue, profit, staff performance, and best-selling items.";
    case "waiters": return "Manage waiter accounts, PINs, and roles. Dining tables moved to the Tables tab.";
    case "kitchen-staff": return "Manage KDS login accounts, PINs, and kitchen roles.";
    case "pos-staff": return "Manage POS terminal accounts — PINs, roles (Admin / Manager / Cashier), and per-role permissions.";
    case "collection-staff": return "Manage Collection screen login accounts and PINs — for taking pickup payments without the POS.";
    case "reservations": return settings.reservationSystem?.enabled ? "Reservations are live — customers can book tables from the website." : "Reservations are currently disabled — enable them below.";
    case "table-status": return "Live occupancy plus add / edit / delete dining tables — used by the host stand and reservations.";
    case "reservation-customers": return "Guest profiles built from reservation check-ins — add notes, tags, and manage marketing opt-ins.";
    default: return "Manage your restaurant settings below.";
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageContent />
    </Suspense>
  );
}

function AdminPageContent() {
  const { isOpen, settings, menuItems, categories, customers, loadAllCustomers, refreshDiningTables } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Admin authentication ──────────────────────────────────────────────────
  // Login lives on the dedicated /admin/login page; middleware guarantees a
  // valid admin session before this page renders. We only confirm the session
  // here and bounce to /admin/login if it has gone away.
  // null = checking, true = authenticated.
  const [adminAuthed, setAdminAuthed] = useState<boolean | null>(null);

  // ── All hooks must be declared before any early return (Rules of Hooks) ───
  // Honor ?tab=<id> on first paint so deep-links (e.g. "Go to Delivery" from
  // the user-management active-orders modal) land on the right panel.
  // Accept legacy aliases so old bookmarks / external links (e.g. emails sent
  // before a rename) still land on the right tab: "delivery" → online-orders,
  // "payments" → online-payments, "refunds" → online-refunds.
  const rawTab = searchParams.get("tab");
  const initialTab = (
    rawTab === "delivery" ? "online-orders" :
      rawTab === "payments" ? "online-payments" :
        rawTab === "refunds" ? "online-refunds" :
          rawTab ?? "online-orders"
  ) as TabId;
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [goToOpen, setGoToOpen] = useState(false);
  const goToWrapperRef = useRef<HTMLDivElement | null>(null);

  // Close the "Go To" popover when the user clicks anywhere outside it.
  useEffect(() => {
    if (!goToOpen) return;
    function onPointerDown(ev: PointerEvent) {
      if (!goToWrapperRef.current) return;
      if (!goToWrapperRef.current.contains(ev.target as Node)) setGoToOpen(false);
    }
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") setGoToOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [goToOpen]);

  const activeOrderCount = customers.reduce(
    (n, c) => n + c.orders.filter((o) => ["pending", "confirmed", "preparing", "ready"].includes(o.status)).length,
    0,
  );

  const prevCountRef = useRef(activeOrderCount);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [showAlert, setShowAlert] = useState(false);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => {
        if (r.ok) setAdminAuthed(true);
        else router.replace("/admin/login");
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  // Once admin-authed, pull the full customers/orders list via the
  // admin-gated API (replaces the prior AppContext anon supabase read)
  // and refresh every 8 seconds to keep panels current.
  useEffect(() => {
    if (adminAuthed !== true) return;
    loadAllCustomers();
    const id = setInterval(() => { loadAllCustomers(); }, 8_000);
    return () => clearInterval(id);
  }, [adminAuthed, loadAllCustomers]);

  // dining_tables has no realtime subscription, so the table-consuming panels
  // (Reservations, Table Status, Dine-in) would show a stale list after an
  // admin adds/removes a table until a full reload — which is exactly the "No
  // active tables" the Reservations tab showed. Mirror the POS page: refresh on
  // mount, on every tab switch (immediate), and on a 15 s visible poll.
  // refreshDiningTables is no-op-if-unchanged, so this never causes spurious renders.
  useEffect(() => {
    if (adminAuthed !== true) return;
    refreshDiningTables();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refreshDiningTables();
    }, 15_000);
    return () => clearInterval(id);
  }, [adminAuthed, activeTab, refreshDiningTables]);

  useEffect(() => {
    const prev = prevCountRef.current;
    if (activeOrderCount > prev) {
      setNewOrderCount(activeOrderCount - prev);
      setShowAlert(true);
    }
    prevCountRef.current = activeOrderCount;
  }, [activeOrderCount]);

  // Sync activeTab when ?tab=<id> changes after mount (e.g. router.push from
  // an in-page modal). Guard against unknown ids and honour the "delivery"
  // legacy alias the same way the initial-tab resolver above does.
  useEffect(() => {
    const raw = searchParams.get("tab");
    const t = raw === "delivery" ? "online-orders" : raw === "payments" ? "online-payments" : raw === "refunds" ? "online-refunds" : raw;
    if (t && ALL_TABS.some((x) => x.id === t)) setActiveTab(t);
  }, [searchParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const logoutInFlight = useRef(false);

  async function handleLogout() {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    try {
      await fetch("/api/admin/auth", { method: "DELETE" }).catch(() => { });
      router.replace("/admin/login");
    } finally {
      logoutInFlight.current = false;
    }
  }

  // Auto-logout after 30 minutes of inactivity. Admin sessions carry the most
  // power in the system, so an unattended browser tab is the highest-risk
  // session to leave alive.
  useIdleLogout({
    enabled: adminAuthed === true,
    timeoutMs: 30 * 60 * 1000,
    onIdle: handleLogout,
  });

  // ── Auth gate ─────────────────────────────────────────────────────────────
  // Middleware redirects unauthenticated visitors to /admin/login before this
  // renders; this spinner only covers the brief in-page session re-check (and
  // the moment before the redirect fires if the session has since expired).
  if (adminAuthed !== true) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  function dismissAlert() { setShowAlert(false); setNewOrderCount(0); }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }

  function handleTabSelect(id: TabId) {
    setActiveTab(id);
    setMobileSidebarOpen(false);
    // Reflect the selection in the URL so refresh / share / back-button keep
    // the right tab open. `replace` keeps history flat — clicking through
    // 10 tabs shouldn't drop 10 entries onto the back stack. `scroll: false`
    // stops the page from jumping to the top on every switch.
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }

  const currentTab = ALL_TABS.find((t) => t.id === activeTab);
  const CurrentIcon = currentTab?.icon ?? LayoutDashboard;

  // ── Badge helper ──────────────────────────────────────────────────────────
  function getBadge(id: string): { count: number; pulse: boolean } | null {
    if (id === "online-orders" && activeOrderCount > 0) return { count: activeOrderCount, pulse: true };
    if (id === "menu") return { count: menuItems.length, pulse: false };
    if (id === "customers") return { count: customers.length, pulse: false };
    return null;
  }

  // ─── Sidebar ───────────────────────────────────────────────────────────────

  const Sidebar = (
    <aside
      className={[
        "fixed inset-y-0 left-0 z-40 flex flex-col bg-gray-950 border-r border-gray-800",
        "transition-[width,transform] duration-300 ease-in-out will-change-transform",
        sidebarCollapsed ? "w-[68px]" : "w-60",
        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      ].join(" ")}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 h-16 px-4 border-b border-gray-800 flex-shrink-0">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <LayoutDashboard size={15} className="text-white" />
        </div>
        {!sidebarCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-white font-bold text-sm leading-tight">Admin</p>
            <p className="text-gray-500 text-xs truncate leading-tight mt-0.5">{settings.restaurant.name}</p>
          </div>
        )}
        {/* Mobile close */}
        {!sidebarCollapsed && (
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition flex-shrink-0"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 space-y-0.5">
        {NAV_GROUPS.map((group) => {
          const isGroupCollapsed = collapsedGroups.has(group.id);
          return (
            <div key={group.id}>
              {/* Group header (hidden when sidebar is icon-only) */}
              {!sidebarCollapsed && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-4 py-2 mt-2 first:mt-0 group"
                >
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest group-hover:text-gray-400 transition">
                    {group.label}
                  </span>
                  {isGroupCollapsed
                    ? <ChevronRight size={11} className="text-gray-600 group-hover:text-gray-400 transition" />
                    : <ChevronDown size={11} className="text-gray-600 group-hover:text-gray-400 transition" />
                  }
                </button>
              )}
              {sidebarCollapsed && (
                <div className="h-px bg-gray-800/60 mx-3 my-2" />
              )}

              {/* Items */}
              {(!isGroupCollapsed || sidebarCollapsed) && (
                <div className="px-2 space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = activeTab === item.id;
                    const Icon = item.icon;
                    const badge = getBadge(item.id);

                    return (
                      <div key={item.id} className="relative group/item">
                        <button
                          onClick={() => handleTabSelect(item.id)}
                          className={[
                            "w-full flex items-center gap-3 rounded-xl transition-all duration-150 select-none",
                            sidebarCollapsed ? "px-0 py-2.5 justify-center" : "px-3 py-2.5",
                            isActive
                              ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                              : "text-gray-400 hover:bg-gray-800 hover:text-gray-100",
                          ].join(" ")}
                        >
                          {/* Active left-bar (collapsed only) */}
                          {isActive && sidebarCollapsed && (
                            <span className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-1 h-5 bg-orange-500 rounded-r-full" />
                          )}

                          <Icon size={17} className="flex-shrink-0" />

                          {!sidebarCollapsed && (
                            <>
                              <span className="text-sm font-medium flex-1 text-left truncate">
                                {item.label}
                              </span>
                              {badge && (
                                <span className={[
                                  "text-[10px] font-bold rounded-full p-1.5 py-1 leading-none flex-shrink-0",
                                  badge.pulse
                                    ? "bg-orange-400 text-white animate-pulse"
                                    : isActive
                                      ? "bg-white/20 text-white"
                                      : "bg-gray-800 text-gray-400",
                                ].join(" ")}>
                                  {badge.count}
                                </span>
                              )}
                            </>
                          )}

                          {/* Collapsed: badge as dot */}
                          {sidebarCollapsed && badge && badge.pulse && (
                            <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                          )}
                        </button>

                        {/* Tooltip on collapsed */}
                        {sidebarCollapsed && (
                          <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
                            opacity-0 group-hover/item:opacity-100 transition-opacity duration-150">
                            <div className="flex items-center gap-2 bg-gray-800 text-white text-xs font-medium
                              px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-gray-700">
                              {item.label}
                              {badge && (
                                <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${badge.pulse ? "bg-orange-500 text-white" : "bg-gray-700 text-gray-300"}`}>
                                  {badge.count}
                                </span>
                              )}
                            </div>
                            {/* Arrow */}
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 -ml-1.5 border-4 border-transparent border-r-gray-800" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="flex-shrink-0 border-t border-gray-800 p-3 space-y-1">
        {/* Store status */}
        <div className={[
          "flex items-center gap-2.5 px-3 py-2 rounded-xl",
          sidebarCollapsed ? "justify-center" : "",
        ].join(" ")}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOpen ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
          {!sidebarCollapsed && (
            <span className={`text-xs font-semibold ${isOpen ? "text-green-400" : "text-red-400"}`}>
              {isOpen ? "Store open" : "Store closed"}
            </span>
          )}
        </div>

        {/* Go To — jump to any sub-app (opens in a new tab so the admin
            session stays put). The popover anchors to this button and closes
            on outside click / Escape (wired up at component scope). */}
        <div ref={goToWrapperRef} className="relative">
          <button
            type="button"
            onClick={() => setGoToOpen((v) => !v)}
            className={[
              "flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-white transition",
              sidebarCollapsed ? "justify-center" : "",
              goToOpen ? "bg-gray-800 text-white" : "",
            ].join(" ")}
            aria-expanded={goToOpen}
            aria-haspopup="menu"
            title={sidebarCollapsed ? "Go To" : undefined}
          >
            <Compass size={15} className="flex-shrink-0" />
            {!sidebarCollapsed && (
              <>
                <span className="text-xs font-medium">Go To</span>
                <ChevronDown
                  size={13}
                  className={`ml-auto text-gray-500 transition-transform ${goToOpen ? "rotate-180" : ""}`}
                />
              </>
            )}
          </button>

          {goToOpen && (
            <div
              role="menu"
              className={[
                "absolute z-50 min-w-[200px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-1.5",
                // Position: above the trigger in expanded mode, to the right in
                // collapsed mode so it doesn't overlap the trigger column.
                sidebarCollapsed
                  ? "left-full ml-3 bottom-0"
                  : "left-0 right-0 bottom-full mb-2",
              ].join(" ")}
            >
              {SUB_APP_LINKS.map(({ href, label, icon: Icon, description }) => (
                <Link
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  onClick={() => setGoToOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-800 hover:text-white transition group"
                >
                  <Icon size={15} className="flex-shrink-0 mt-0.5 text-gray-400 group-hover:text-orange-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold">{label}</div>
                    <div className="text-[10px] text-gray-500 truncate">{description}</div>
                  </div>
                  <ExternalLink size={11} className="flex-shrink-0 mt-0.5 text-gray-600 group-hover:text-gray-400" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Logout */}
        <div className="relative group/logout">
          <button
            onClick={handleLogout}
            className={[
              "flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-gray-500 hover:bg-red-500/10 hover:text-red-400 transition",
              sidebarCollapsed ? "justify-center" : "",
            ].join(" ")}
          >
            <ShieldCheck size={15} className="flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-xs font-medium">Sign out</span>}
          </button>
          {sidebarCollapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
              opacity-0 group-hover/logout:opacity-100 transition-opacity duration-150">
              <div className="bg-gray-800 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-gray-700">
                Sign out
              </div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -ml-1.5 border-4 border-transparent border-r-gray-800" />
            </div>
          )}
        </div>

      </div>
    </aside>
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-50 overflow-hidden flex flex-col">

      {/* ── New-order toast ──────────────────────────────────────────────── */}
      {showAlert && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-gray-900 text-white rounded-2xl min-w-0 shadow-2xl px-5 py-4 max-w-[280px] sm:max-w-xs w-full border border-gray-800">
          <div className="w-8 h-8 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bell size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">
              {newOrderCount === 1 ? "New order received!" : `${newOrderCount} new orders received!`}
            </p>
            <button
              onClick={() => { handleTabSelect("online-orders"); dismissAlert(); }}
              className="mt-1 text-xs text-orange-400 hover:text-orange-300 font-semibold transition"
            >
              View in Delivery →
            </button>
          </div>
          <button onClick={dismissAlert} className="text-gray-500 hover:text-white transition flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      {Sidebar}

      {/* ── Mobile overlay backdrop ──────────────────────────────────────── */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* ── Main content (offset by sidebar on desktop) ───────────────────── */}
      <div className={[
        "flex flex-col flex-1 h-full transition-[padding-left] duration-300 ease-in-out pb-4 w-full",
        sidebarCollapsed ? "lg:pl-[68px]" : "lg:pl-60",
      ].join(" ")}>

        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-white border-b border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 px-4 h-16">

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition flex-shrink-0"
            >
              <MenuIcon size={20} className="text-gray-600" />
            </button>

            {/* Desktop collapse toggle */}
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="hidden lg:flex w-9 h-9 items-center justify-center rounded-xl hover:bg-gray-100 transition flex-shrink-0"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed
                ? <ChevronRight size={18} className="text-gray-500" />
                : <ChevronLeft size={18} className="text-gray-500" />
              }
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <CurrentIcon size={17} className="text-orange-500 flex-shrink-0" />
              <h1 className="text-base font-semibold text-gray-900 truncate">
                {currentTab?.label ?? "Dashboard"}
              </h1>
            </div>

            {/* Active-orders pill */}
            {activeOrderCount > 0 && (
              <button
                onClick={() => handleTabSelect("online-orders")}
                className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-bold px-3 py-1.5 rounded-full hover:bg-orange-100 transition flex-shrink-0"
              >
                <Bell size={12} className="animate-bounce" />
                {activeOrderCount} active
              </button>
            )}

            {/* Store status pill */}
            <span className={[
              "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold flex-shrink-0",
              isOpen ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200",
            ].join(" ")}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              {isOpen ? "Open" : "Closed"}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-6">

            {/* Welcome banner */}
            <div className="bg-gradient-to-br from-orange-500 via-orange-500 to-orange-700 rounded-2xl p-5 sm:p-6 text-white flex items-start justify-between gap-4 shadow-lg shadow-orange-200/50">
              <div className="min-w-0">
                <p className="text-xs font-bold text-orange-200 uppercase tracking-widest mb-1">
                  {NAV_GROUPS.find((g) => g.items.some((i) => i.id === activeTab))?.label}
                </p>
                <h2 className="text-xl sm:text-2xl font-bold truncate">{currentTab?.label ?? "Dashboard"}</h2>
                <p className="text-orange-100 text-sm mt-1 leading-relaxed max-w-xl">
                  {bannerSubtitle(activeTab, menuItems.length, categories.length, customers.length, activeOrderCount, settings)}
                </p>
              </div>
              <ShieldCheck size={40} className="text-white/20 flex-shrink-0 hidden sm:block" />
            </div>

            {/* Panel content */}
            {activeTab === "menu" && <MenuManagementPanel />}
            {activeTab === "customers" && <CustomersPanel />}
            {activeTab === "online-orders" && <DeliveryPanel />}
            {activeTab === "pos-orders" && <OrderMonitorPanel source="pos" />}
            {activeTab === "dine-in-orders" && <OrderMonitorPanel source="dine-in" />}
            {activeTab === "order-history" && <OrderHistoryPanel />}
            {activeTab === "zones" && <DeliveryZonesPanel />}
            {activeTab === "operations" && <OperationsPanel />}
            {activeTab === "schedule" && <SchedulePanel />}
            {activeTab === "integrations" && <IntegrationsPanel />}
            {activeTab === "email" && <EmailTemplatesPanel />}
            {activeTab === "custom-pages" && <CustomPagesPanel />}
            {activeTab === "nav-menus" && <MenuLinksPanel />}
            {activeTab === "colors" && <ColorSettingsPanel />}
            {activeTab === "footer-logos" && <FooterLogosPanel />}
            {activeTab === "receipt" && <ReceiptSettingsPanel />}
            {activeTab === "coupons" && <CouponsPanel />}
            {activeTab === "gift-cards" && <GiftCardsPanel />}
            {activeTab === "tax" && <TaxSettingsPanel />}
            {activeTab === "drivers" && <DriversPanel />}
            {activeTab === "online-refunds" && <RefundsPanel />}
            {activeTab === "online-payments" && <PaymentsPanel />}
            {activeTab === "online-reports" && <OnlineReportsPanel />}
            {activeTab === "pos-reports" && <POSReportsPanel />}
            {activeTab === "waiters" && <WaitersPanel />}
            {activeTab === "kitchen-staff" && <KitchenStaffPanel />}
            {activeTab === "pos-staff" && <POSStaffPanel />}
            {activeTab === "collection-staff" && <CollectionStaffPanel />}
            {activeTab === "reservations" && <ReservationsPanel />}
            {activeTab === "table-status" && <TableStatusPanel />}
            {activeTab === "reservation-customers" && <ReservationCustomersPanel />}
          </div>
        </main>

        {/* FOOTER */}
        <footer className="bg-white border-t border-gray-200 px-4 pt-4 flex-shrink-0 text-center text-[11px] text-gray-400">
          {settings.footerCopyright || `© ${new Date().getFullYear()} ${settings.restaurant.name}. All rights reserved.`}<br />
          Designed by SeekaHost Technologies Ltd.
        </footer>
      </div>
    </div>
  );
}
