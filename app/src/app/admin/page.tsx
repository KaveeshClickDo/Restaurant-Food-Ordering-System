"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import OperationsPanel      from "@/components/admin/OperationsPanel";
import SchedulePanel        from "@/components/admin/SchedulePanel";
import IntegrationsPanel    from "@/components/admin/IntegrationsPanel";
import MenuManagementPanel  from "@/components/admin/MenuManagementPanel";
import CustomersPanel       from "@/components/admin/CustomersPanel";
import DeliveryPanel        from "@/components/admin/DeliveryPanel";
import DeliveryZonesPanel   from "@/components/admin/DeliveryZonesPanel";
import EmailTemplatesPanel  from "@/components/admin/EmailTemplatesPanel";
import FooterPagesPanel     from "@/components/admin/FooterPagesPanel";
import CustomPagesPanel     from "@/components/admin/CustomPagesPanel";
import MenuLinksPanel       from "@/components/admin/MenuLinksPanel";
import ColorSettingsPanel   from "@/components/admin/ColorSettingsPanel";
import FooterLogosPanel     from "@/components/admin/FooterLogosPanel";
import ReceiptSettingsPanel from "@/components/admin/ReceiptSettingsPanel";
import CouponsPanel         from "@/components/admin/CouponsPanel";
import TaxSettingsPanel     from "@/components/admin/TaxSettingsPanel";
import DriversPanel         from "@/components/admin/DriversPanel";
import BreakfastMenuPanel   from "@/components/admin/BreakfastMenuPanel";
import RefundsPanel         from "@/components/admin/RefundsPanel";
import POSReportsPanel      from "@/components/admin/POSReportsPanel";
import OnlineReportsPanel  from "@/components/admin/OnlineReportsPanel";
import WaitersPanel         from "@/components/admin/WaitersPanel";
import KitchenStaffPanel    from "@/components/admin/KitchenStaffPanel";
import UserManagementPanel  from "@/components/admin/UserManagementPanel";
import ReservationsPanel         from "@/components/admin/ReservationsPanel";
import TableStatusPanel          from "@/components/admin/TableStatusPanel";
import ReservationCustomersPanel from "@/components/admin/ReservationCustomersPanel";
import {
  LayoutDashboard, ExternalLink, ShieldCheck, Store, Calendar, Plug, ChefHat, Users, Truck,
  MapPin, Bell, X, Mail, FileText, LayoutTemplate, Navigation, Palette, ImageIcon, Receipt,
  Tag, Percent, Car, Sunrise, RotateCcw, BarChart3, LineChart, UtensilsCrossed, CalendarDays, BookUser,
  Menu as MenuIcon, ChevronDown, ChevronRight, ChevronLeft, PanelLeftClose, PanelLeftOpen, UserCog,
} from "lucide-react";

// ─── Navigation structure ─────────────────────────────────────────────────────

type NavItem = { id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> };
type NavGroup = { id: string; label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    id: "orders", label: "Orders",
    items: [
      { id: "delivery",  label: "Delivery",        icon: Truck     },
      { id: "refunds",   label: "Refunds",          icon: RotateCcw },
    ],
  },
  {
    id: "menu", label: "Menu",
    items: [
      { id: "menu",      label: "Menu Items",       icon: ChefHat  },
      { id: "breakfast", label: "Breakfast",         icon: Sunrise  },
    ],
  },
  {
    id: "customers", label: "Customers",
    items: [
      { id: "customers", label: "Customers",        icon: Users    },
      { id: "drivers",   label: "Drivers",          icon: Car      },
      { id: "users",     label: "User Management",  icon: UserCog  },
    ],
  },
  {
    id: "table-service", label: "Table Service",
    items: [
      { id: "waiters",              label: "Staff & Tables",  icon: UtensilsCrossed },
      { id: "kitchen-staff",        label: "Kitchen Staff",   icon: ChefHat         },
      { id: "reservations",         label: "Reservations",    icon: CalendarDays    },
      { id: "table-status",         label: "Table Status",    icon: UtensilsCrossed },
      { id: "reservation-customers",label: "Guest Profiles",  icon: BookUser        },
    ],
  },
  {
    id: "finance", label: "Finance",
    items: [
      { id: "online-reports", label: "Finance Reports", icon: LineChart },
      { id: "coupons",        label: "Coupons",          icon: Tag       },
      { id: "tax",            label: "Tax & VAT",         icon: Percent   },
      { id: "pos-reports",    label: "POS Reports",       icon: BarChart3 },
    ],
  },
  {
    id: "settings", label: "Settings",
    items: [
      { id: "operations",   label: "Operations",      icon: Store    },
      { id: "schedule",     label: "Schedule",         icon: Calendar },
      { id: "zones",        label: "Delivery Zones",  icon: MapPin   },
      { id: "integrations", label: "Integrations",    icon: Plug     },
      { id: "email",        label: "Email Templates", icon: Mail     },
    ],
  },
  {
    id: "content", label: "Content & SEO",
    items: [
      { id: "pages",        label: "Footer Pages",   icon: FileText      },
      { id: "custom-pages", label: "Custom Pages",   icon: LayoutTemplate},
      { id: "nav-menus",    label: "Navigation",     icon: Navigation    },
      { id: "colors",       label: "Brand Colors",   icon: Palette       },
      { id: "footer-logos", label: "Footer Logos",   icon: ImageIcon     },
      { id: "receipt",      label: "Receipt",        icon: Receipt       },
    ],
  },
];

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items);
type TabId = string;

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
    case "menu":          return `Managing ${menuItemsLen} items across ${categoriesLen} categories.`;
    case "breakfast":     return `${(s.breakfastMenu?.items ?? []).length} breakfast items · shown ${s.breakfastMenu?.enabled ? `${s.breakfastMenu.startTime}–${s.breakfastMenu.endTime}` : "(currently disabled)"}.`;
    case "customers":     return `${customersLen} registered customers · manage orders & history.`;
    case "delivery":      return `${activeOrderCount} active order${activeOrderCount !== 1 ? "s" : ""} in the queue · track and advance deliveries.`;
    case "zones":         return "Define delivery zones, set per-zone fees, and control distance rules.";
    case "operations":    return "Update branding, fees, timings, and address. All changes apply instantly.";
    case "email":         return `${s.emailTemplates?.filter((t) => t.enabled).length ?? 0} active email templates · customise messages sent to customers.`;
    case "pages":         return "Edit footer page content, toggle page visibility, and update copyright text.";
    case "custom-pages":  return `${(s.customPages ?? []).filter((p) => p.published).length} published · standalone pages with custom content and SEO.`;
    case "nav-menus":     return "Assign pages to header and footer menus, control ordering, and toggle visibility.";
    case "colors":        return "Customise brand colour and page background — changes apply live across the site.";
    case "footer-logos":  return `${(s.footerLogos ?? []).filter((l) => l.enabled).length} active logo${(s.footerLogos ?? []).filter((l) => l.enabled).length !== 1 ? "s" : ""} · upload payment icons, partner logos, and badges.`;
    case "receipt":       return "Configure what appears on printed and emailed receipts — name, phone, VAT number, and footer.";
    case "coupons":       return `${(s.coupons ?? []).filter((c) => c.active).length} active coupon${(s.coupons ?? []).filter((c) => c.active).length !== 1 ? "s" : ""} · percentage and fixed-amount discount codes.`;
    case "tax":           return s.taxSettings?.enabled ? `VAT ${s.taxSettings.rate}% · ${s.taxSettings.inclusive ? "inclusive" : "exclusive"} mode.` : "VAT is currently disabled.";
    case "drivers":       return "Manage driver accounts and track deliveries.";
    case "users":         return "Create, view, and manage all user accounts — customers, drivers, and staff.";
    case "refunds":       return "Process full or partial refunds, choose refund method, and view the full refund history.";
    case "online-reports": return "Revenue, orders, refunds, VAT, and payment breakdowns — filter by date range and export to CSV or PDF.";
    case "pos-reports":    return "View POS sales reports — revenue, profit, staff performance, and best-selling items.";
    case "waiters":        return `${settings.waiters?.length ?? 0} staff · ${settings.diningTables?.length ?? 0} tables — manage waiter accounts, PINs, and dining layout.`;
    case "kitchen-staff":  return `${settings.kitchenStaff?.length ?? 0} kitchen staff — manage KDS login accounts, PINs, and roles.`;
    case "reservations":          return settings.reservationSystem?.enabled ? "Reservations are live — customers can book tables from the website." : "Reservations are currently disabled — enable them below.";
    case "table-status":          return "Live table occupancy for today — check in arriving guests and free tables on checkout.";
    case "reservation-customers": return "Guest profiles built from reservation check-ins — add notes, tags, and manage marketing opt-ins.";
    default:              return "Manage your restaurant settings below.";
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
  const { isOpen, settings, menuItems, categories, customers } = useApp();
  const router       = useRouter();
  const searchParams = useSearchParams();

  // ── Admin authentication ──────────────────────────────────────────────────
  // null = checking, true = authenticated, false = needs login
  const [adminAuthed,   setAdminAuthed]   = useState<boolean | null>(null);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError,    setLoginError]    = useState("");
  const [loginLoading,  setLoginLoading]  = useState(false);

  // ── All hooks must be declared before any early return (Rules of Hooks) ───
  const [activeTab,          setActiveTab]          = useState<TabId>("delivery");
  const [sidebarCollapsed,   setSidebarCollapsed]   = useState(false);
  const [mobileSidebarOpen,  setMobileSidebarOpen]  = useState(false);
  const [collapsedGroups,    setCollapsedGroups]    = useState<Set<string>>(new Set());

  const activeOrderCount = customers.reduce(
    (n, c) => n + c.orders.filter((o) => ["pending", "confirmed", "preparing", "ready"].includes(o.status)).length,
    0,
  );

  const prevCountRef = useRef(activeOrderCount);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [showAlert,     setShowAlert]     = useState(false);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => setAdminAuthed(r.ok))
      .catch(() => setAdminAuthed(false));
  }, []);

  useEffect(() => {
    const prev = prevCountRef.current;
    if (activeOrderCount > prev) {
      setNewOrderCount(activeOrderCount - prev);
      setShowAlert(true);
    }
    prevCountRef.current = activeOrderCount;
  }, [activeOrderCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleLogin(e: { preventDefault(): void }) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const r = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });
      if (r.ok) {
        const redirectTo = searchParams.get("redirect");
        if (redirectTo && redirectTo.startsWith("/")) {
          router.replace(redirectTo);
          return;
        }
        setAdminAuthed(true);
        setLoginPassword("");
      } else {
        const j = await r.json().catch(() => ({})) as { error?: string };
        setLoginError(j.error ?? "Invalid password.");
      }
    } catch {
      setLoginError("Connection error. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/auth", { method: "DELETE" }).catch(() => {});
    setAdminAuthed(false);
  }

  // ── Auth loading / login gate ─────────────────────────────────────────────
  if (adminAuthed === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (adminAuthed === false) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-800 p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Admin Login</h1>
              <p className="text-gray-500 text-xs mt-0.5">Enter your admin password to continue</p>
            </div>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                autoFocus
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition"
              />
            </div>
            {loginError && (
              <p className="text-red-400 text-xs">{loginError}</p>
            )}
            <button
              type="submit"
              disabled={loginLoading || !loginPassword}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg py-2.5 transition"
            >
              {loginLoading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          {!process.env.NEXT_PUBLIC_ADMIN_CONFIGURED && (
            <p className="mt-4 text-gray-600 text-xs text-center">
              Set <code className="text-gray-500">ADMIN_PASSWORD</code> in <code className="text-gray-500">.env.local</code>
            </p>
          )}
        </div>
      </div>
    );
  }

  function dismissAlert() { setShowAlert(false); setNewOrderCount(0); }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  function handleTabSelect(id: TabId) {
    setActiveTab(id);
    setMobileSidebarOpen(false);
  }

  const currentTab  = ALL_TABS.find((t) => t.id === activeTab);
  const CurrentIcon = currentTab?.icon ?? LayoutDashboard;

  // ── Badge helper ──────────────────────────────────────────────────────────
  function getBadge(id: string): { count: number; pulse: boolean } | null {
    if (id === "delivery"  && activeOrderCount > 0) return { count: activeOrderCount, pulse: true };
    if (id === "menu")      return { count: menuItems.length, pulse: false };
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
                    : <ChevronDown  size={11} className="text-gray-600 group-hover:text-gray-400 transition" />
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
                                  "text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none flex-shrink-0",
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

        {/* Kitchen link */}
        <div className="relative group/bottom">
          <Link
            href="/kitchen"
            className={[
              "flex items-center gap-2.5 px-3 py-2 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-white transition",
              sidebarCollapsed ? "justify-center" : "",
            ].join(" ")}
          >
            <ChefHat size={15} className="flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-xs font-medium">Kitchen view</span>}
          </Link>
          {sidebarCollapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
              opacity-0 group-hover/bottom:opacity-100 transition-opacity duration-150">
              <div className="bg-gray-800 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-gray-700">
                Kitchen view
              </div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -ml-1.5 border-4 border-transparent border-r-gray-800" />
            </div>
          )}
        </div>

        {/* View site link */}
        <div className="relative group/bottom2">
          <Link
            href="/"
            className={[
              "flex items-center gap-2.5 px-3 py-2 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-white transition",
              sidebarCollapsed ? "justify-center" : "",
            ].join(" ")}
          >
            <ExternalLink size={15} className="flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-xs font-medium">View site</span>}
          </Link>
          {sidebarCollapsed && (
            <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50
              opacity-0 group-hover/bottom2:opacity-100 transition-opacity duration-150">
              <div className="bg-gray-800 text-white text-xs font-medium px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-gray-700">
                View site
              </div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 -ml-1.5 border-4 border-transparent border-r-gray-800" />
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

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          className={[
            "hidden lg:flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-gray-500 hover:bg-gray-800 hover:text-gray-200 transition",
            sidebarCollapsed ? "justify-center" : "",
          ].join(" ")}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed
            ? <PanelLeftOpen  size={15} className="flex-shrink-0" />
            : <PanelLeftClose size={15} className="flex-shrink-0" />
          }
          {!sidebarCollapsed && <span className="text-xs font-medium">Collapse</span>}
        </button>
      </div>
    </aside>
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── New-order toast ──────────────────────────────────────────────── */}
      {showAlert && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 max-w-xs w-full border border-gray-800">
          <div className="w-8 h-8 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bell size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">
              {newOrderCount === 1 ? "New order received!" : `${newOrderCount} new orders received!`}
            </p>
            <button
              onClick={() => { handleTabSelect("delivery"); dismissAlert(); }}
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
        "transition-[padding-left] duration-300 ease-in-out",
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
                : <ChevronLeft  size={18} className="text-gray-500" />
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
                onClick={() => handleTabSelect("delivery")}
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
        <main>
          <div className="max-w-6xl mx-auto px-3 sm:px-6 py-5 sm:py-8 space-y-6">

            {/* Welcome banner */}
            <div className="bg-gradient-to-br from-orange-500 via-orange-500 to-red-500 rounded-2xl p-5 sm:p-6 text-white flex items-start justify-between gap-4 shadow-lg shadow-orange-200/50">
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
            {activeTab === "menu"          && <MenuManagementPanel />}
            {activeTab === "breakfast"     && <BreakfastMenuPanel />}
            {activeTab === "customers"     && <CustomersPanel />}
            {activeTab === "delivery"      && <DeliveryPanel />}
            {activeTab === "zones"         && <DeliveryZonesPanel />}
            {activeTab === "operations"    && <OperationsPanel />}
            {activeTab === "schedule"      && <SchedulePanel />}
            {activeTab === "integrations"  && <IntegrationsPanel />}
            {activeTab === "email"         && <EmailTemplatesPanel />}
            {activeTab === "pages"         && <FooterPagesPanel />}
            {activeTab === "custom-pages"  && <CustomPagesPanel />}
            {activeTab === "nav-menus"     && <MenuLinksPanel />}
            {activeTab === "colors"        && <ColorSettingsPanel />}
            {activeTab === "footer-logos"  && <FooterLogosPanel />}
            {activeTab === "receipt"       && <ReceiptSettingsPanel />}
            {activeTab === "coupons"       && <CouponsPanel />}
            {activeTab === "tax"           && <TaxSettingsPanel />}
            {activeTab === "drivers"       && <DriversPanel />}
            {activeTab === "users"         && <UserManagementPanel />}
            {activeTab === "refunds"       && <RefundsPanel />}
            {activeTab === "online-reports" && <OnlineReportsPanel />}
            {activeTab === "pos-reports"   && <POSReportsPanel />}
            {activeTab === "waiters"        && <WaitersPanel />}
            {activeTab === "kitchen-staff"  && <KitchenStaffPanel />}
            {activeTab === "reservations"          && <ReservationsPanel />}
            {activeTab === "table-status"          && <TableStatusPanel />}
            {activeTab === "reservation-customers" && <ReservationCustomersPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}
