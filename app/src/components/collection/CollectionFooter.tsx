"use client";

import { useApp } from "@/context/AppContext";

/**
 * Slim dark footer for the /collection operator surface. Mirrors the credit
 * line from the public SiteFooter but styled for the full-screen dark console.
 */
export default function CollectionFooter() {
  const { settings } = useApp();
  const year = new Date().getFullYear();
  const copyright =
    settings.footerCopyright || `© ${year} ${settings.restaurant?.name ?? ""}. All rights reserved.`;

  return (
    <footer className="flex-shrink-0 bg-slate-900 border-t border-slate-800 px-4 py-2.5 text-center">
      <p className="text-[11px] text-slate-500">
        {copyright} · Designed by SeekaHost Technologies Ltd.
      </p>
    </footer>
  );
}
