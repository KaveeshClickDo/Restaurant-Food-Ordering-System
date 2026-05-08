"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AdminSettings } from "@/types";

/**
 * Injected inside AppProvider — runs on every page.
 *
 * React 19 hoists <title> and <meta> rendered anywhere in the tree to <head>.
 * We render them ONLY when the admin has configured a custom value, so the
 * server-rendered metadata from generateMetadata() acts as the SSR default and
 * SeoHead overrides it dynamically once settings load from Supabase.
 */
export default function SeoHead({ settings }: { settings: AdminSettings }) {
  const { seo, customHeadCode } = settings;
  const pathname  = usePathname();
  const prevCode  = useRef<string | null>(null);
  const prevFav   = useRef<string>("");

  // ── Custom <head> code injection ─────────────────────────────────────────────
  useEffect(() => {
    if (customHeadCode === prevCode.current) return;
    prevCode.current = customHeadCode;

    document.head.querySelectorAll("[data-sg-head]").forEach((el) => el.remove());

    if (!customHeadCode.trim()) return;

    const tpl = document.createElement("template");
    tpl.innerHTML = customHeadCode;
    const fragment = tpl.content;

    fragment.querySelectorAll("script").forEach((inert) => {
      const live = document.createElement("script");
      inert.getAttributeNames().forEach((attr) => {
        live.setAttribute(attr, inert.getAttribute(attr)!);
      });
      if (inert.textContent) live.textContent = inert.textContent;
      live.setAttribute("data-sg-head", "true");
      document.head.appendChild(live);
      inert.remove();
    });

    Array.from(fragment.childNodes).forEach((node) => {
      if (node instanceof Element) {
        const clone = node.cloneNode(true) as Element;
        clone.setAttribute("data-sg-head", "true");
        document.head.appendChild(clone);
      }
    });
  }, [customHeadCode]);

  // ── Live favicon update ───────────────────────────────────────────────────────
  // Browsers cache favicons aggressively, so we manipulate the DOM directly
  // rather than relying on React's hoisted <link> reconciliation.
  useEffect(() => {
    const faviconUrl = seo.faviconUrl?.trim() ?? "";
    if (faviconUrl === prevFav.current) return;
    prevFav.current = faviconUrl;

    // Remove any existing dynamic favicon links added by this component
    document.head.querySelectorAll("link[data-sg-favicon]").forEach((el) => el.remove());

    if (!faviconUrl) return;

    const link = document.createElement("link");
    link.rel  = "icon";
    link.href = faviconUrl;
    link.setAttribute("data-sg-favicon", "true");
    document.head.appendChild(link);
  }, [seo.faviconUrl]);

  const title       = seo.metaTitle?.trim()       || "";
  const description = seo.metaDescription?.trim() || "";
  const keywords    = seo.metaKeywords?.trim()    || "";
  const ogImage     = seo.ogImage?.trim()         || "";
  const siteUrl     = seo.siteUrl?.trim()         || "";
  const siteName    = settings.restaurant?.name   || "";

  // Build per-page canonical: siteUrl + current path
  const canonical   = siteUrl
    ? `${siteUrl.replace(/\/$/, "")}${pathname === "/" ? "" : pathname}`
    : "";

  return (
    <>
      {title       && <title>{title}</title>}
      {description && <meta name="description"        content={description} />}
      {keywords    && <meta name="keywords"           content={keywords} />}
      {canonical   && <link rel="canonical"           href={canonical} />}

      {/* Open Graph */}
      {title       && <meta property="og:title"       content={title} />}
      {description && <meta property="og:description" content={description} />}
      {siteName    && <meta property="og:site_name"   content={siteName} />}
      {canonical   && <meta property="og:url"         content={canonical} />}
      {ogImage     && <meta property="og:image"       content={ogImage} />}
      {ogImage     && <meta property="og:image:width"  content="1200" />}
      {ogImage     && <meta property="og:image:height" content="630" />}
                      <meta property="og:type"        content="website" />

      {/* Twitter */}
      {title       && <meta name="twitter:title"       content={title} />}
      {description && <meta name="twitter:description" content={description} />}
      {ogImage     && <meta name="twitter:image"       content={ogImage} />}
                      <meta name="twitter:card" content={ogImage ? "summary_large_image" : "summary"} />
    </>
  );
}
