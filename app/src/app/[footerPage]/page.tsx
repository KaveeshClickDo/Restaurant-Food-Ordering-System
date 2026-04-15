"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ArrowLeft } from "lucide-react";

export default function DynamicPage() {
  const { footerPage: slug } = useParams<{ footerPage: string }>();
  const { settings } = useApp();

  // Check footer pages first, then custom pages
  const footerPage = (settings.footerPages ?? []).find((p) => p.slug === slug);
  const customPage  = (settings.customPages  ?? []).find((p) => p.slug === slug && p.published);

  const page = footerPage ?? customPage ?? null;

  // Resolve page title for <title> tag
  const metaTitle =
    customPage?.seoTitle ||
    customPage?.title ||
    footerPage?.title ||
    null;

  const metaDescription = customPage?.seoDescription || null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {metaTitle && <title>{metaTitle}</title>}
      {metaDescription && <meta name="description" content={metaDescription} />}

      <Header />

      <main className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-4 py-4 sm:py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-500 transition mb-6"
        >
          <ArrowLeft size={14} />
          Back to menu
        </Link>

        {page ? (
          <article className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-8">
            <div
              className="rich-content"
              dangerouslySetInnerHTML={{ __html: page.content }}
            />
          </article>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
            <p className="text-gray-500 font-medium mb-1">Page not found</p>
            <p className="text-sm text-gray-400 mb-4">
              This page doesn&apos;t exist or hasn&apos;t been published yet.
            </p>
            <Link href="/" className="text-sm text-orange-500 hover:underline">
              Return to menu
            </Link>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
