"use client";

import Link from "next/link";
import { useApp } from "@/context/AppContext";

export default function Footer() {
  const { settings } = useApp();

  // Prefer managed menu links; fall back to the legacy enabled-footerPages list
  // so the footer still works out-of-the-box before any links are configured.
  const managedLinks = (settings.menuLinks ?? [])
    .filter((l) => l.location === "footer" && l.active)
    .sort((a, b) => a.order - b.order);

  const legacyLinks = (settings.footerPages ?? [])
    .filter((p) => p.enabled)
    .map((p) => ({ id: p.slug, label: p.title, href: `/${p.slug}` }));

  const navLinks = managedLinks.length > 0 ? managedLinks : legacyLinks;

  return (
    <footer className="bg-gray-900 text-gray-300 mt-12">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
          {/* Brand */}
          <div className="flex-shrink-0">
            <p className="text-white font-bold text-lg">{settings.restaurant.name}</p>
            {settings.restaurant.tagline && (
              <p className="text-gray-400 text-sm mt-1">{settings.restaurant.tagline}</p>
            )}
          </div>

          {/* Nav links */}
          {navLinks.length > 0 && (
            <nav className="flex flex-wrap gap-x-6 gap-y-2">
              {navLinks.map((link) => (
                <Link
                  key={link.id}
                  href={link.href}
                  className="text-sm text-gray-400 hover:text-white transition"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {/* Footer logos */}
        {(() => {
          const activeLogos = (settings.footerLogos ?? [])
            .filter((l) => l.enabled)
            .sort((a, b) => a.order - b.order);
          if (activeLogos.length === 0) return null;
          return (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
              {activeLogos.map((logo) =>
                logo.href ? (
                  <a
                    key={logo.id}
                    href={logo.href}
                    target="_blank"
                    rel="noreferrer"
                    title={logo.label}
                    className="flex items-center opacity-60 hover:opacity-100 transition"
                  >
                    <img
                      src={logo.imageUrl}
                      alt={logo.label}
                      className="max-h-8 max-w-[120px] object-contain"
                    />
                  </a>
                ) : (
                  <img
                    key={logo.id}
                    src={logo.imageUrl}
                    alt={logo.label}
                    title={logo.label}
                    className="max-h-8 max-w-[120px] object-contain opacity-60"
                  />
                )
              )}
            </div>
          );
        })()}

        {/* Divider + copyright */}
        <div className="mt-8 pt-6 border-t border-gray-800">
          <p className="text-xs text-gray-500 text-center">
            {settings.footerCopyright ||
              `© ${new Date().getFullYear()} ${settings.restaurant.name}. All rights reserved.`}
          </p>
        </div>
      </div>
    </footer>
  );
}
