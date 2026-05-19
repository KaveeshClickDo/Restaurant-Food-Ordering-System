"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/context/AppContext";

export default function DynamicPage() {
  const { footerPage: slug } = useParams<{ footerPage: string }>();
  const { settings } = useApp();

  // Footer Pages and Custom Pages have been unified — every published page now
  // lives in `customPages`. The route segment is still named `footerPage` for
  // URL stability.
  const page = (settings.customPages ?? []).find((p) => p.slug === slug && p.published) ?? null;

  const metaTitle       = page?.seoTitle || page?.title || null;
  const metaDescription = page?.seoDescription || null;

  return (
    <div className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12">
      {metaTitle && <title>{metaTitle}</title>}
      {metaDescription && <meta name="description" content={metaDescription} />}

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
    </div>
  );
}
