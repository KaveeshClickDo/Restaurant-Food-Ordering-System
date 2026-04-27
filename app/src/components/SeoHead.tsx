"use client";

import { useEffect, useRef } from "react";
import { AdminSettings } from "@/types";

/**
 * Injected inside AppProvider — runs on every page.
 *
 * React 19 hoists <title> and <meta> rendered anywhere in the tree to <head>.
 * We render them ONLY when the admin has configured a custom value, so the
 * static metadata from layout.tsx acts as the SSR default and SeoHead overrides
 * it dynamically once settings load from Supabase / localStorage.
 *
 * We deliberately do NOT render <title> or <meta name="description"> when the
 * value is empty — doing so would create duplicate tags with the static fallback.
 */
export default function SeoHead({ settings }: { settings: AdminSettings }) {
  const { seo, customHeadCode } = settings;
  const prevCode = useRef<string | null>(null);

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

  const title       = seo.metaTitle?.trim()       || "";
  const description = seo.metaDescription?.trim() || "";
  const keywords    = seo.metaKeywords?.trim()    || "";
  const ogImage     = seo.ogImage?.trim()         || "";
  const siteUrl     = seo.siteUrl?.trim()         || "";

  return (
    <>
      {/* Only override when admin has set a custom value */}
      {title       && <title>{title}</title>}
      {description && <meta name="description"        content={description} />}
      {keywords    && <meta name="keywords"           content={keywords} />}

      {/* Open Graph */}
      {title       && <meta property="og:title"       content={title} />}
      {description && <meta property="og:description" content={description} />}
      {siteUrl     && <meta property="og:url"         content={siteUrl} />}
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
