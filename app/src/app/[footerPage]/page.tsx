"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import { ArrowLeft } from "lucide-react";

export default function DynamicPage() {
  const { footerPage: slug } = useParams<{ footerPage: string }>();
  const { settings } = useApp();

  const footerPage = (settings.footerPages ?? []).find((p) => p.slug === slug);
  const customPage  = (settings.customPages  ?? []).find((p) => p.slug === slug && p.published);
  const page = footerPage ?? customPage ?? null;

  const metaTitle       = customPage?.seoTitle || customPage?.title || footerPage?.title || null;
  const metaDescription = customPage?.seoDescription || null;

  return (
    <div className="min-h-screen bg-[var(--brand-bg)] flex flex-col" style={{ fontFamily: '"Inter", -apple-system, system-ui, sans-serif' }}>
      {metaTitle && <title>{metaTitle}</title>}
      {metaDescription && <meta name="description" content={metaDescription} />}

      {/* Minimal top nav */}
      <header className="flex items-center gap-4 px-5 md:px-8 py-4 bg-white border-b border-zinc-200/70">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center text-[14px] font-bold flex-shrink-0">
            {settings.restaurant.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-[14.5px] font-semibold text-zinc-900 tracking-tight hidden sm:block">
            {settings.restaurant.name}
          </span>
        </div>
        <Link href="/"
          className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900 transition-colors font-medium">
          <ArrowLeft size={14} />
          Back to menu
        </Link>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12">
        {page ? (
          <article className="bg-white rounded-2xl border border-zinc-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] p-5 sm:p-8">
            <div className="rich-content" dangerouslySetInnerHTML={{ __html: page.content }} />
          </article>
        ) : (
          <div className="bg-white rounded-2xl border border-zinc-200/70 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] p-6 sm:p-8 text-center">
            <p className="text-zinc-500 font-medium mb-1">Page not found</p>
            <p className="text-sm text-zinc-400 mb-4">
              This page doesn&apos;t exist or hasn&apos;t been published yet.
            </p>
            <Link href="/" className="text-sm text-zinc-700 font-semibold hover:underline">
              Return to menu
            </Link>
          </div>
        )}
      </main>

      {/* Minimal footer */}
      <footer className="border-t border-zinc-200/70 bg-white px-5 md:px-8 py-6">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-orange-500 text-white flex items-center justify-center text-[12px] font-bold">
              {settings.restaurant.name.charAt(0).toUpperCase()}
            </div>
            <span className="text-[13px] font-semibold text-zinc-700">{settings.restaurant.name}</span>
          </div>
          <p className="text-[11.5px] text-zinc-400">
            {settings.footerCopyright || `© ${new Date().getFullYear()} ${settings.restaurant.name}. All rights reserved.`}
          </p>
        </div>
      </footer>
    </div>
  );
}
