"use client";

import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import {
    Receipt,
    PackageX,
    Navigation,
    RotateCcw,
    ChefHat,
    Bike,
    CheckCheck,
    X,
    Pin,
    Search,
    LayoutDashboard,
    LogOut,
} from "lucide-react";
import AuthModal from "@/components/AuthModal";
import type { Order } from "@/types";
import Link from "next/link";
import CartPanel from "@/components/CartPanel";
import MobileBottomNav from "@/components/MobileBottomNav";

// ── Track order modal ───────────────────────────────────────────────
function TrackOrderModal({ order, onClose }: { order: Order; onClose: () => void }) {
    const STEPS: { key: string; label: string; icon: React.ReactNode }[] = [
        { key: "pending", label: "Order received", icon: <Receipt className="w-4 h-4" strokeWidth={1.8} /> },
        { key: "preparing", label: "In the kitchen", icon: <ChefHat className="w-4 h-4" strokeWidth={1.8} /> },
        { key: "ready", label: "On the way", icon: <Bike className="w-4 h-4" strokeWidth={1.8} /> },
        { key: "delivered", label: "Delivered", icon: <CheckCheck className="w-4 h-4" strokeWidth={2} /> },
    ];

    const statusIndex: Record<string, number> = {
        pending: 0, confirmed: 1, preparing: 1, ready: 2, delivered: 3,
    };
    const currentStep = statusIndex[order.status] ?? 0;

    const itemSummary = order.items.map((i) => `${i.qty}× ${i.name}`).join(", ");

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Tracking order</p>
                        <p className="text-[15px] font-bold text-zinc-900 mt-0.5">#{order.id.slice(-6).toUpperCase()}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-500 hover:bg-zinc-200 transition-colors">
                        <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                </div>

                {/* Route visualization */}
                <div className="px-5 py-6 bg-stone-50">
                    <div className="relative flex items-center justify-between">
                        {/* Line */}
                        <div className="absolute left-6 right-6 top-5 h-0.5 bg-zinc-200 z-0" />
                        <div
                            className="absolute left-6 top-5 h-0.5 bg-orange-500 z-0 transition-all duration-700"
                            style={{ width: `${(currentStep / 3) * 100}%`, maxWidth: "calc(100% - 3rem)" }}
                        />
                        {/* Steps */}
                        {STEPS.map((step, i) => (
                            <div key={step.key} className="relative z-10 flex flex-col items-center gap-1.5" style={{ width: "25%" }}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${i <= currentStep
                                    ? "bg-orange-500 text-white shadow-lg shadow-orange-500/30"
                                    : "bg-white border-2 border-zinc-200 text-zinc-400"
                                    }`}>
                                    {step.icon}
                                </div>
                                <p className={`text-[10px] font-medium text-center leading-tight transition-colors ${i <= currentStep ? "text-orange-600" : "text-zinc-400"
                                    }`}>
                                    {step.label}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Driver info */}
                {order.driverName && (
                    <div className="mx-5 mt-4 flex items-center gap-3 bg-zinc-50 rounded-2xl p-3.5">
                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-[16px] flex-shrink-0">
                            {order.driverName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-zinc-400 leading-none mb-0.5">Your driver</p>
                            <p className="text-[14px] font-semibold text-zinc-800">{order.driverName}</p>
                        </div>
                        <Navigation className="w-5 h-5 text-orange-500" strokeWidth={1.8} />
                    </div>
                )}

                {/* Order details */}
                <div className="px-5 py-4 space-y-3">
                    <div className="bg-zinc-50 rounded-2xl p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">Order summary</p>
                        <p className="text-[13px] text-zinc-700 leading-relaxed">{itemSummary}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-zinc-50 rounded-2xl p-3.5">
                            <p className="text-[10px] text-zinc-400 mb-1">Total</p>
                            <p className="text-[15px] font-bold text-zinc-900 tabular-nums">£{order.total.toFixed(2)}</p>
                        </div>
                        <div className="bg-zinc-50 rounded-2xl p-3.5">
                            <p className="text-[10px] text-zinc-400 mb-1">Type</p>
                            <p className="text-[14px] font-semibold text-zinc-800 capitalize">{order.fulfillment}</p>
                        </div>
                    </div>

                    {order.address && (
                        <div className="flex items-start gap-2.5 bg-zinc-50 rounded-2xl p-3.5">
                            <Pin className="w-4 h-4 text-zinc-400 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
                            <p className="text-[13px] text-zinc-700 leading-snug">{order.address}</p>
                        </div>
                    )}
                </div>

                <div className="pb-6" />
            </div>
        </div>
    );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function MyOrdersPage() {
    const { currentUser, addToCart, settings, refreshCurrentUser, logout } = useApp();
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [trackingOrder, setTrackingOrder] = useState<Order | null>(null);
    const [authModal, setAuthModal] = useState<{ open: boolean; tab: "login" | "register" }>({ open: false, tab: "login" });
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [showMobileCart, setShowMobileCart] = useState(false);

    const ACTIVE_STATUSES = new Set(["pending", "confirmed", "preparing", "ready"]);
    const displayOrders = currentUser?.orders ?? [];
    const hasActiveOrders = displayOrders.some((o) => ACTIVE_STATUSES.has(o.status));

    // Refresh immediately on mount so switching to this screen always shows fresh data.
    useEffect(() => {
        if (currentUser) refreshCurrentUser().catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id]);

    // Poll every 15 s while active orders exist — graceful fallback if Realtime is unreliable.
    useEffect(() => {
        if (!currentUser?.id || !hasActiveOrders) return;
        const id = setInterval(() => refreshCurrentUser().catch(() => { }), 15_000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id, hasActiveOrders]);

    // Re-fetch when the browser tab becomes visible again.
    useEffect(() => {
        function onVisible() {
            if (document.visibilityState === "visible" && currentUser) {
                refreshCurrentUser().catch(() => { });
            }
        }
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id]);

    const allOrders = [...displayOrders].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const activeOrder = allOrders.find((o) => ACTIVE_STATUSES.has(o.status)) ?? null;
    const pastOrders = allOrders.filter((o) => !ACTIVE_STATUSES.has(o.status));

    const activeLabel: Record<string, string> = {
        pending: "Order received",
        confirmed: "Confirmed",
        preparing: "In the kitchen",
        ready: "Ready to collect / pick up",
    };

    return (
        <div className="h-full flex overflow-hidden" style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif', backgroundColor: '#f5f5f3' }}>

            {/* ── Main content area ─────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0 h-full">

                {/* Top search header */}
                <header className="hidden lg:flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-zinc-200/70 bg-white flex-shrink-0">
                    {/* Mobile: logo */}
                    <div className="lg:hidden flex items-center gap-2 flex-shrink-0">
                        {settings.restaurant.logoImage ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={settings.restaurant.logoImage} alt={settings.restaurant.name}
                                className="w-8 h-8 rounded-xl object-cover" />
                        ) : (
                            <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[14px] font-bold">
                                {settings.restaurant.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                    </div>

                    {/* Search */}
                    <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-zinc-100 max-w-xl">
                        <Search className="w-4 h-4 text-zinc-400 flex-shrink-0" strokeWidth={1.8} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search dishes…"
                            className="flex-1 bg-transparent outline-none text-[13.5px] text-zinc-900 placeholder:text-zinc-400"
                        />
                        {search && (
                            <button onClick={() => setSearch("")} className="text-[11px] font-medium text-zinc-400 hover:text-zinc-700 transition-colors">
                                Clear
                            </button>
                        )}
                    </div>

                    {/* Auth / user (desktop) */}
                    <div className="hidden lg:flex items-center gap-2">
                        {currentUser ? (
                            <div className="relative">
                                <button
                                    onClick={() => setUserMenuOpen((o) => !o)}
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 transition-colors"
                                >
                                    <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-[11px] font-bold">
                                        {currentUser.name?.charAt(0).toUpperCase() ?? "U"}
                                    </div>
                                    <span className="text-[13px] font-medium text-zinc-700">{currentUser.name?.split(" ")[0]}</span>
                                </button>
                                {userMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                                        <div className="absolute right-0 top-full mt-2 w-44 bg-white rounded-xl border border-zinc-200/70 shadow-lg z-20 overflow-hidden py-1">
                                            <Link href="/account" onClick={() => setUserMenuOpen(false)}
                                                className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-zinc-700 hover:bg-zinc-50 transition-colors">
                                                <LayoutDashboard className="w-4 h-4" strokeWidth={1.6} />Account
                                            </Link>
                                            <button onClick={() => { logout(); setUserMenuOpen(false); }}
                                                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors">
                                                <LogOut className="w-4 h-4" strokeWidth={1.6} />Sign out
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-[13px] font-medium hover:bg-orange-600 transition-colors">
                                Sign in
                            </button>
                        )}
                    </div>

                </header>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto pb-28 lg:pb-8">

                    <div className="min-h-full pb-10" style={{ backgroundColor: "#f5f5f3" }}>
                        <div className="px-5 pt-7 pb-2">
                            <h1 className="text-[28px] font-extrabold text-zinc-900 tracking-tight leading-tight">My Orders</h1>
                            <p className="text-[13.5px] text-zinc-500 mt-1">Recent activity from your kitchen.</p>
                        </div>

                        {!currentUser ? (
                            <div className="mx-5 mt-6 bg-white rounded-3xl p-8 flex flex-col items-center gap-4 text-center shadow-sm">
                                <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
                                    <Receipt className="w-7 h-7 text-zinc-400" strokeWidth={1.4} />
                                </div>
                                <p className="text-[13.5px] text-zinc-500">Sign in to see your order history</p>
                                <button onClick={() => setAuthModal({ open: true, tab: "login" })}
                                    className="px-6 py-2.5 rounded-full bg-zinc-900 hover:bg-zinc-700 text-white text-[13.5px] font-semibold transition-colors">
                                    Sign in
                                </button>
                            </div>

                        ) : displayOrders.length === 0 ? (
                            <div className="mx-5 mt-6 bg-white rounded-3xl p-8 flex flex-col items-center gap-3 text-center shadow-sm">
                                <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center">
                                    <PackageX className="w-7 h-7 text-zinc-400" strokeWidth={1.4} />
                                </div>
                                <p className="text-[13.5px] text-zinc-500">No orders yet — your order history will appear here.</p>
                            </div>

                        ) : (
                            <>
                                {activeOrder && (
                                    <div className="mx-5 mt-4">
                                        <div className="bg-zinc-900 rounded-3xl p-5 shadow-lg">
                                            <div className="flex items-center gap-1.5 mb-4">
                                                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                                <span className="text-[11px] font-bold uppercase tracking-widest text-green-400">In Progress</span>
                                            </div>
                                            <p className="text-[13px] text-zinc-400 mb-0.5">Order #{activeOrder.id.slice(-6).toUpperCase()}</p>
                                            <p className="text-[18px] font-bold text-white leading-snug mb-3">
                                                {activeLabel[activeOrder.status] ?? activeOrder.status}
                                            </p>
                                            <p className="text-[12.5px] text-zinc-400 leading-relaxed mb-5 line-clamp-2">
                                                {activeOrder.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                                            </p>
                                            <div className="flex items-center justify-between">
                                                <span className="text-[16px] font-bold text-white tabular-nums">£{activeOrder.total.toFixed(2)}</span>
                                                <button
                                                    onClick={() => setTrackingOrder(activeOrder)}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-zinc-900 text-[13px] font-bold hover:bg-zinc-100 transition-colors active:scale-[0.98]"
                                                >
                                                    <Navigation className="w-3.5 h-3.5" strokeWidth={2} />
                                                    Track order
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {pastOrders.length > 0 && (
                                    <div className="px-5 mt-6">
                                        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-3">Past orders</p>
                                        <div className="space-y-3 max-w-lg">
                                            {pastOrders.map((order) => {
                                                const dateStr = new Date(order.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                                                const itemSummary = order.items.slice(0, 2).map((i) => `${i.qty}× ${i.name}`).join(", ")
                                                    + (order.items.length > 2 ? ` +${order.items.length - 2} more` : "");
                                                const isCancelled = order.status === "cancelled" || order.status === "refunded" || order.status === "partially_refunded";
                                                return (
                                                    <div key={order.id} className="bg-white rounded-3xl p-5 shadow-sm">
                                                        <div className="flex items-start justify-between gap-2 mb-2">
                                                            <p className="text-[12px] text-zinc-400">{dateStr}</p>
                                                            <span className={`text-[10.5px] font-bold uppercase tracking-wider ${isCancelled ? "text-red-400" : "text-zinc-400"}`}>
                                                                {isCancelled ? order.status.replace("_", " ") : "Delivered"}
                                                            </span>
                                                        </div>
                                                        <p className="text-[14px] font-semibold text-zinc-900 leading-snug mb-3 line-clamp-2">{itemSummary}</p>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[15px] font-bold text-zinc-900 tabular-nums">£{order.total.toFixed(2)}</span>
                                                            <button
                                                                onClick={() => {
                                                                    order.items.forEach((line) => {
                                                                        addToCart({
                                                                            id: crypto.randomUUID(),
                                                                            menuItemId: line.menuItemId ?? line.name,
                                                                            name: line.name,
                                                                            price: line.price,
                                                                            quantity: line.qty,
                                                                            selectedVariation: line.selectedVariation,
                                                                            selectedAddOns: line.selectedAddOns,
                                                                            specialInstructions: line.specialInstructions,
                                                                        });
                                                                    });
                                                                    router.push("/");
                                                                }}
                                                                className="flex items-center gap-1 text-[13px] font-semibold text-orange-500 hover:text-orange-600 transition-colors"
                                                            >
                                                                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                                                                Reorder
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Mobile Bottom Nav ── */}
            <MobileBottomNav
                onCartOpen={() => setShowMobileCart(true)}
                onAuth={() => setAuthModal({ open: true, tab: "login" })}
            />

            {/* ── Mobile Cart Drawer ── */}
            {showMobileCart && (
                <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowMobileCart(false)} />
                    <div className="relative bg-white rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
                        <CartPanel
                            onMobileClose={() => setShowMobileCart(false)}
                            onOrderPlaced={() => { setShowMobileCart(false); router.push('/my-orders'); }}
                        />
                    </div>
                </div>
            )}


            {trackingOrder && (
                <TrackOrderModal order={trackingOrder} onClose={() => setTrackingOrder(null)} />
            )}

            {authModal.open && (
                <AuthModal
                    initialTab={authModal.tab}
                    onClose={() => setAuthModal({ open: false, tab: "login" })}
                />
            )}

        </div>
    );
}