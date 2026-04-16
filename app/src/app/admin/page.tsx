"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import OperationsPanel from "@/components/admin/OperationsPanel";
import SchedulePanel from "@/components/admin/SchedulePanel";
import IntegrationsPanel from "@/components/admin/IntegrationsPanel";
import MenuManagementPanel from "@/components/admin/MenuManagementPanel";
import CustomersPanel from "@/components/admin/CustomersPanel";
import DeliveryPanel from "@/components/admin/DeliveryPanel";
import DeliveryZonesPanel from "@/components/admin/DeliveryZonesPanel";
import EmailTemplatesPanel from "@/components/admin/EmailTemplatesPanel";
import FooterPagesPanel from "@/components/admin/FooterPagesPanel";
import CustomPagesPanel from "@/components/admin/CustomPagesPanel";
import MenuLinksPanel from "@/components/admin/MenuLinksPanel";
import ColorSettingsPanel from "@/components/admin/ColorSettingsPanel";
import FooterLogosPanel from "@/components/admin/FooterLogosPanel";
import ReceiptSettingsPanel from "@/components/admin/ReceiptSettingsPanel";
import CouponsPanel from "@/components/admin/CouponsPanel";
import TaxSettingsPanel from "@/components/admin/TaxSettingsPanel";
import DriversPanel from "@/components/admin/DriversPanel";
import BreakfastMenuPanel from "@/components/admin/BreakfastMenuPanel";
import { LayoutDashboard, ExternalLink, ShieldCheck, Store, Calendar, Plug, ChefHat, Users, Truck, MapPin, Bell, X, Mail, FileText, LayoutTemplate, Navigation, Palette, ImageIcon, Receipt, Tag, Percent, Car, Sunrise } from "lucide-react";

const TABS = [
  { id: "menu",         label: "Menu Items",   icon: ChefHat },
  { id: "breakfast",    label: "Breakfast",    icon: Sunrise },
  { id: "customers",   label: "Customers",    icon: Users },
  { id: "delivery",    label: "Delivery",     icon: Truck },
  { id: "zones",       label: "Zones",        icon: MapPin },
  { id: "operations",  label: "Operations",   icon: Store },
  { id: "schedule",    label: "Schedule",     icon: Calendar },
  { id: "integrations",label: "Integrations", icon: Plug },
  { id: "email",        label: "Email",        icon: Mail },
  { id: "pages",        label: "Footer Pages", icon: FileText },
  { id: "custom-pages", label: "Custom Pages", icon: LayoutTemplate },
  { id: "nav-menus",    label: "Menus",        icon: Navigation },
  { id: "colors",       label: "Colors",       icon: Palette },
  { id: "footer-logos", label: "Logos",        icon: ImageIcon },
  { id: "receipt",      label: "Receipt",      icon: Receipt },
  { id: "coupons",      label: "Coupons",      icon: Tag },
  { id: "tax",          label: "Tax",          icon: Percent },
  { id: "drivers",      label: "Drivers",      icon: Car },
] as const;

type TabId = typeof TABS[number]["id"];

export default function AdminPage() {
  const { isOpen, settings, menuItems, categories, customers } = useApp();
  const [activeTab, setActiveTab] = useState<TabId>("menu");

  const activeOrderCount = customers.reduce(
    (n, c) => n + c.orders.filter((o) => ["pending", "confirmed", "preparing", "ready"].includes(o.status)).length,
    0
  );

  // ── New-order notification ─────────────────────────────────────────────────
  // Track previous active-order count; show a toast when it grows (i.e. a new
  // order arrived from the customer portal — detected via the cross-tab storage
  // event that updates `customers` in AppContext without a page reload).
  const prevCountRef = useRef(activeOrderCount);
  const [newOrderCount, setNewOrderCount] = useState(0);   // how many just arrived
  const [showAlert, setShowAlert]         = useState(false);

  useEffect(() => {
    const prev = prevCountRef.current;
    if (activeOrderCount > prev) {
      const arrived = activeOrderCount - prev;
      setNewOrderCount(arrived);
      setShowAlert(true);
    }
    prevCountRef.current = activeOrderCount;
  }, [activeOrderCount]);

  function dismissAlert() {
    setShowAlert(false);
    setNewOrderCount(0);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── New-order toast (slides in from top-right) ───────────────────── */}
      {showAlert && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 max-w-xs w-full">
          <div className="w-8 h-8 bg-orange-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bell size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">
              {newOrderCount === 1 ? "New order received!" : `${newOrderCount} new orders received!`}
            </p>
            <button
              onClick={() => { setActiveTab("delivery"); dismissAlert(); }}
              className="mt-1 text-xs text-orange-400 hover:text-orange-300 font-semibold transition"
            >
              View in Delivery tab →
            </button>
          </div>
          <button onClick={dismissAlert} className="text-gray-500 hover:text-white transition flex-shrink-0 mt-0.5">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Top nav */}
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center">
              <LayoutDashboard size={18} className="text-white" />
            </div>
            <div>
              <span className="font-bold text-gray-900">Admin Dashboard</span>
              <span className="ml-2 text-xs text-gray-400">{settings.restaurant.name}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live order bell — visible when orders are pending */}
            {activeOrderCount > 0 && (
              <button
                onClick={() => setActiveTab("delivery")}
                className="relative flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-orange-100 transition"
              >
                <Bell size={13} className="animate-bounce" />
                {activeOrderCount} active
              </button>
            )}
            <span
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                isOpen ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-green-500" : "bg-red-500"} animate-pulse`} />
              {isOpen ? "Store open" : "Store closed"}
            </span>
            <Link
              href="/kitchen"
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-500 transition"
            >
              <ChefHat size={14} />
              Kitchen
            </Link>
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-500 transition"
            >
              <ExternalLink size={14} />
              View menu
            </Link>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto scrollbar-hide">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all flex-shrink-0 ${
                activeTab === id
                  ? "border-orange-500 text-orange-600"
                  : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-200"
              }`}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{label}</span>
              {id === "menu" && (
                <span className="ml-1 bg-gray-100 text-gray-500 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {menuItems.length}
                </span>
              )}
              {id === "customers" && (
                <span className="ml-1 bg-gray-100 text-gray-500 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {customers.length}
                </span>
              )}
              {id === "delivery" && activeOrderCount > 0 && (
                <span className="ml-1 bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                  {activeOrderCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Body */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-6">
        {/* Welcome banner */}
        <div className="bg-gradient-to-r from-orange-500 to-red-400 rounded-2xl p-5 text-white flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Welcome back 👋</h1>
            <p className="text-orange-100 text-sm mt-0.5">
            {activeTab === "menu"
              ? `Managing ${menuItems.length} items across ${categories.length} categories.`
              : activeTab === "breakfast"
              ? `${(settings.breakfastMenu?.items ?? []).length} breakfast items · shown to customers ${settings.breakfastMenu?.enabled ? `${settings.breakfastMenu.startTime}–${settings.breakfastMenu.endTime}` : "(currently disabled)"}.`
              : activeTab === "customers"
              ? `${customers.length} registered customers · manage orders & history.`
              : activeTab === "delivery"
              ? `${activeOrderCount} active order${activeOrderCount !== 1 ? "s" : ""} in the queue · track and advance deliveries.`
              : activeTab === "zones"
              ? `Define delivery zones, set per-zone fees, and control payment method distance rules.`
              : activeTab === "operations"
              ? `Update your branding, fees, timings, and restaurant address. All changes apply instantly.`
              : activeTab === "email"
              ? `${settings.emailTemplates?.filter((t) => t.enabled).length ?? 0} active email templates · customise messages sent to customers.`
              : activeTab === "pages"
              ? `Edit footer page content, toggle page visibility, and update copyright text.`
              : activeTab === "custom-pages"
              ? `${(settings.customPages ?? []).filter((p) => p.published).length} published · create and manage standalone pages with custom content and SEO settings.`
              : activeTab === "nav-menus"
              ? `Assign pages to the header and footer menus, control ordering, and toggle visibility.`
              : activeTab === "colors"
              ? `Customise your brand colour and page background — changes apply live across the entire site.`
              : activeTab === "footer-logos"
              ? `${(settings.footerLogos ?? []).filter((l) => l.enabled).length} active logo${(settings.footerLogos ?? []).filter((l) => l.enabled).length !== 1 ? "s" : ""} · upload partner logos, payment icons, and certification badges for the footer.`
              : activeTab === "receipt"
              ? "Configure what appears on printed and emailed receipts — name, phone, website, VAT number, and footer messages."
              : activeTab === "coupons"
              ? `${(settings.coupons ?? []).filter((c) => c.active).length} active coupon${(settings.coupons ?? []).filter((c) => c.active).length !== 1 ? "s" : ""} · create percentage and fixed-amount discount codes for customers.`
              : activeTab === "tax"
              ? settings.taxSettings?.enabled
                ? `VAT ${settings.taxSettings.rate}% · ${settings.taxSettings.inclusive ? "inclusive" : "exclusive"} mode — applied across cart, checkout, receipts, and emails.`
                : "VAT is currently disabled — enable it to apply tax across the ordering flow."
              : activeTab === "drivers"
              ? `${(settings.drivers ?? []).length} driver${(settings.drivers ?? []).length !== 1 ? "s" : ""} registered · manage accounts, assign orders, and track active deliveries.`
              : "Manage your restaurant settings below. All changes apply instantly."}
          </p>
          </div>
          <ShieldCheck size={36} className="text-orange-200 flex-shrink-0 hidden sm:block" />
        </div>

        {/* Panel content */}
        {activeTab === "menu"         && <MenuManagementPanel />}
        {activeTab === "breakfast"    && <BreakfastMenuPanel />}
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
      </div>
    </div>
  );
}
