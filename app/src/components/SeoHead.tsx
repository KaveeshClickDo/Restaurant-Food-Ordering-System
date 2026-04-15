"use client";

import { useEffect, useRef } from "react";
import { AdminSettings } from "@/types";

/**
 * Injected inside AppProvider so it runs on every page.
 * Receives settings as a prop (not via useApp) to avoid a circular dependency
 * with the context it lives inside.
 *
 * React 19 natively hoists <title> and <meta> elements rendered anywhere in the
 * component tree to <head>, keeping them reactive to state changes. This means
 * returning them as JSX is the correct approach — no document.title manipulation
 * needed, and no risk of Next.js reconciliation resetting the value.
 */
export default function SeoHead({ settings }: { settings: AdminSettings }) {
  const { seo, customHeadCode } = settings;
  const prevCode = useRef<string | null>(null);

  // ── Custom <head> code injection ─────────────────────────────────────────────
  useEffect(() => {
    // Skip if nothing changed
    if (customHeadCode === prevCode.current) return;
    prevCode.current = customHeadCode;

    // Remove all elements we previously injected
    document.head.querySelectorAll("[data-sg-head]").forEach((el) => el.remove());

    if (!customHeadCode.trim()) return;

    // Parse the raw HTML string using a <template> element
    const tpl = document.createElement("template");
    tpl.innerHTML = customHeadCode;
    const fragment = tpl.content;

    // <script> tags must be cloned as real script elements to actually execute
    fragment.querySelectorAll("script").forEach((inert) => {
      const live = document.createElement("script");
      inert.getAttributeNames().forEach((attr) => {
        live.setAttribute(attr, inert.getAttribute(attr)!);
      });
      if (inert.textContent) live.textContent = inert.textContent;
      live.setAttribute("data-sg-head", "true");
      document.head.appendChild(live);
      inert.remove(); // prevent double-injection via the loop below
    });

    // All remaining non-script nodes (meta, link, style, noscript, etc.)
    Array.from(fragment.childNodes).forEach((node) => {
      if (node instanceof Element) {
        const clone = node.cloneNode(true) as Element;
        clone.setAttribute("data-sg-head", "true");
        document.head.appendChild(clone);
      }
    });
  }, [customHeadCode]);

  // ── Reactive title + meta tags ────────────────────────────────────────────────
  // React 19 hoists <title> and <meta> rendered in any component to <head> and
  // keeps them in sync. This replaces the previous document.title approach which
  // could be overridden by Next.js's own reconciliation of the layout metadata.
  return (
    <>
      {seo.metaTitle       && <title>{seo.metaTitle}</title>}
      {seo.metaDescription && <meta name="description" content={seo.metaDescription} />}
      {seo.metaKeywords    && <meta name="keywords"    content={seo.metaKeywords} />}
    </>
  );
}
