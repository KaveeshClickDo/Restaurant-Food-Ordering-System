"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UtensilsCrossed, Heart, ShoppingBag, Receipt, User } from "lucide-react";
import { useApp } from "@/context/AppContext";

export default function MobileBottomNav({
  onCartOpen,
  onAuth,
}: {
  onCartOpen: () => void;
  onAuth: () => void;
}) {
  // Fetch these directly from context so you don't need to pass them as props
  const { cartCount, currentUser } = useApp();
  const pathname = usePathname();

  const tabs = [
    { id: "menu",       label: "Menu",    href: "/",           Icon: UtensilsCrossed },
    { id: "favourites", label: "Saved",   href: "/favourites", Icon: Heart },
    { id: "cart",       label: "Cart",    href: "#",           Icon: ShoppingBag },
    { id: "orders",     label: "Orders",  href: "/my-orders",  Icon: Receipt },
    { id: "profile",    label: "Profile", href: "/account",    Icon: User },
  ] as const;

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-zinc-200/60"
      style={{
        boxShadow: "0 -1px 0 rgba(0,0,0,0.05), 0 -4px 20px rgba(0,0,0,0.07)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-end h-[58px]">
        {tabs.map(({ id, label, href, Icon }) => {
          if (id === "cart") {
            return (
              <button
                key="cart"
                onClick={onCartOpen}
                aria-label={`Cart${cartCount > 0 ? ` — ${cartCount} items` : ""}`}
                className="flex-1 flex flex-col items-center justify-end pb-2 relative"
              >
                <div className="relative -mt-5 mb-1">
                  <div className="w-12 h-12 rounded-full bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-500/40 border-[3px] border-white">
                    <ShoppingBag className="w-5 h-5 text-white" strokeWidth={1.8} />
                  </div>
                  {cartCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums leading-none border border-white">
                      {cartCount > 99 ? "99+" : cartCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold text-orange-500 leading-none">Cart</span>
              </button>
            );
          }

          const active = pathname === href;
          const needsAuth = (id === "orders" || id === "profile" || id === "favourites") && !currentUser;

          return (
            <Link
              key={id}
              href={needsAuth ? "#" : href}
              onClick={(e) => {
                if (needsAuth) { e.preventDefault(); onAuth(); }
              }}
              aria-label={label}
              className="flex-1 flex flex-col items-center justify-end pb-2 pt-2 relative group"
            >
              <span
                className={`absolute top-0 left-3 right-3 h-[2.5px] rounded-full transition-all duration-200 ${
                  active ? "bg-orange-500 opacity-100" : "opacity-0"
                }`}
              />
              <Icon
                className={`w-[22px] h-[22px] transition-colors duration-150 ${
                  active ? "text-orange-500" : "text-zinc-400 group-active:text-zinc-600"
                }`}
                strokeWidth={active ? 2 : 1.6}
                fill={id === "favourites" && active ? "currentColor" : "none"}
              />
              <span
                className={`text-[10px] leading-none mt-1 transition-colors duration-150 ${
                  active ? "text-orange-500 font-semibold" : "text-zinc-400 font-medium"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}