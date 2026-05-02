"use client";

import Link from "next/link";
import { useApp } from "@/context/AppContext";

export default function SiteFooter() {
  const { settings } = useApp();
  const { restaurant } = settings;

  const managedLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "footer" && l.active)
    .sort((a, b) => a.order - b.order);

  const legacyLinks = (settings.footerPages ?? [])
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.slug, label: p.title, href: `/${p.slug}` }));

  const navLinks = managedLinks.length > 0 ? managedLinks : legacyLinks;

  const activeLogos = (settings.footerLogos ?? [])
    .filter((l) => l.enabled)
    .sort((a, b) => a.order - b.order);

  return (
    <footer className="border-t border-zinc-200/70 bg-white mt-auto">
      <div className="px-4 sm:px-6 py-8 sm:py-10 max-w-5xl mx-auto">
        {/* Branding */}
        <Link href="/" className="flex items-start gap-3 mb-6 hover:opacity-80 transition-opacity w-fit">
          {restaurant.logoImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={restaurant.logoImage} alt={restaurant.name}
              className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[15px] font-bold flex-shrink-0">
              {restaurant.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-zinc-900 tracking-tight">{restaurant.name}</div>
            {restaurant.tagline && (
              <div className="text-[12.5px] text-zinc-500 mt-0.5">{restaurant.tagline}</div>
            )}
          </div>
        </Link>

        {/* Footer nav links */}
        {navLinks.length > 0 && (
          <nav className="flex flex-wrap gap-x-6 gap-y-2 mb-7">
            {navLinks.map((link) => (
              <Link key={link.id} href={link.href}
                className="text-[12.5px] text-zinc-600 hover:text-zinc-900 transition-colors">
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        {/* Footer logos */}
        {activeLogos.length > 0 && (
          <div className="flex flex-wrap items-center gap-5 mb-7">
            {activeLogos.map((logo) =>
              logo.href ? (
                <a key={logo.id} href={logo.href} target="_blank" rel="noreferrer" title={logo.label}
                  className="opacity-50 hover:opacity-80 transition-opacity">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo.imageUrl} alt={logo.label} className="max-h-8 max-w-[100px] object-contain" />
                </a>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={logo.id} src={logo.imageUrl} alt={logo.label} title={logo.label}
                  className="max-h-8 max-w-[100px] object-contain opacity-50" />
              )
            )}
          </div>
        )}

        <div className="pt-5 border-t border-zinc-200/70 text-[11.5px] text-zinc-400">
          {settings.footerCopyright || `© ${new Date().getFullYear()} ${restaurant.name}. All rights reserved.`}
        </div>
      </div>
    </footer>
  );
}
