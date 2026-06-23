"use client";

/**
 * Public digital-signage screen — /display/<slug>. UNAUTHENTICATED: runs
 * unattended on a TV / stick / mini-PC browser.
 *
 *   • 1 enabled poster  → static fullscreen image/video
 *   • 2+ enabled posters → auto-looping cross-fade slideshow
 *
 * Reads /api/signage/<slug> on mount and re-polls so admin edits (new posters,
 * reorder, speed/fit changes, turning the screen off) appear hands-free within
 * the poll window. Best-effort Fullscreen + Screen Wake Lock keep the TV awake
 * and chrome-free. Distinct from the gated /customer-display counter screen.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const POLL_MS = 30_000;

interface DisplayData {
  name: string;
  intervalMs: number;
  transition: "fade" | "none";
  fit: "contain" | "cover";
  background: string;
  slides: { imageUrl: string }[];
}

type Status = "loading" | "ready" | "notfound" | "error";

// Helper to determine if the URL points to a video
function isVideo(url: string): boolean {
  return /\.(mp4|webm|mov|quicktime)$/i.test(url);
}

export default function SignageDisplayPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [display, setDisplay] = useState<DisplayData | null>(null);
  const [index, setIndex] = useState(0);
  const [showHint, setShowHint] = useState(true);

  // Track the current slide URLs so a poll only resets the slideshow when the
  // posters actually changed (not on every 30 s refresh).
  const slidesKeyRef = useRef("");
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // ── Fetch + poll ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/signage/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (res.status === 404) { setStatus("notfound"); setDisplay(null); return; }
      if (!res.ok) { setStatus((s) => (s === "loading" ? "error" : s)); return; }
      const json = (await res.json()) as { ok: boolean; display?: DisplayData };
      if (!json.ok || !json.display) { setStatus("notfound"); setDisplay(null); return; }

      const next = json.display;
      const key = next.slides.map((s) => s.imageUrl).join("|");
      if (key !== slidesKeyRef.current) {
        slidesKeyRef.current = key;
        setIndex(0); // posters changed — restart from the first slide
      }
      setDisplay(next);
      setStatus("ready");
    } catch {
      // Network blip on an unattended screen — keep showing the last good
      // content and try again on the next tick rather than blanking the TV.
      setStatus((s) => (s === "loading" ? "error" : s));
    }
  }, [slug]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const slides = display?.slides ?? [];

  // Extract primitive values so the 30-second background poll doesn't trigger 
  // false re-renders in the effect hooks below.
  const slidesCount = slides.length;
  const intervalMs = display?.intervalMs;
  const currentImageUrl = slides[index]?.imageUrl;

  // ── Slideshow advance helper ────────────────────────────────────────────────
  const nextSlide = useCallback(() => {
    setIndex((i) => (i + 1) % slidesCount);
  }, [slidesCount]);

  // ── Video Playback Manager ──────────────────────────────────────────────────
   useEffect(() => {
    videoRefs.current.forEach((vid, i) => {
      if (!vid) return;
      if (i === index) {
        vid.currentTime = 0; // Restart video only when transitioning TO this slide
        vid.play().catch(() => {
          // If browser blocks autoplay, skip to the next slide
          if (slidesCount >= 2) nextSlide();
        });
      } else {
        vid.pause(); // Pause inactive videos
      }
    });
  }, [index, nextSlide, slidesCount]); // NOTE: 'slides' array is purposefully removed here

  useEffect(() => {
    if (slidesCount < 2 || !currentImageUrl) return;

    // If it's a video, do NOT set a timeout. The video's native onEnded event handles it.
    if (isVideo(currentImageUrl)) return;

    // If it's an image, set a timeout using the interval settings
    const step = Math.max(3000, intervalMs ?? 8000);
    const id = setTimeout(nextSlide, step);

    return () => clearTimeout(id);
  }, [index, currentImageUrl, slidesCount, intervalMs, nextSlide]); // NOTE: 'slides' array removed here too

  // ── Keep the screen awake (best-effort) ─────────────────────────────────────
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    async function acquire() {
      try {
        if (nav.wakeLock?.request) lock = await nav.wakeLock.request("screen");
      } catch { /* denied / unsupported — harmless */ }
    }
    function onVisible() { if (document.visibilityState === "visible" && !cancelled) acquire(); }
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => { });
    };
  }, []);

  // ── Tap to go fullscreen (browsers require a user gesture) ───────────────────
  function enterFullscreen() {
    setShowHint(false);
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => { });
  }

  // ── Render states ───────────────────────────────────────────────────────────
  const bg = display?.background || "#000000";

  if (status === "loading") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "notfound") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-black text-center px-6">
        <p className="text-white/80 text-2xl font-semibold">Screen unavailable</p>
        <p className="text-white/40 text-sm">This display is turned off or doesn’t exist.</p>
      </div>
    );
  }

  // ready / error-with-last-good-content
  return (
    <div
      onClick={enterFullscreen}
      className="fixed inset-0 overflow-hidden cursor-pointer select-none"
      style={{ backgroundColor: bg }}
    >
      {slides.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
          <p className="text-white/70 text-xl font-semibold">{display?.name || "Display"}</p>
          <p className="text-white/40 text-sm">No media added yet.</p>
        </div>
      ) : (
        slides.map((slide, i) => {
          const isVid = isVideo(slide.imageUrl);
          const commonStyle: React.CSSProperties = {
            objectFit: display?.fit === "cover" ? "cover" : "contain",
            opacity: i === index ? 1 : 0,
            transition: display?.transition === "none" ? "none" : "opacity 900ms ease-in-out",
          };
          const commonClassName = "absolute inset-0 w-full h-full";

          return isVid ? (
            <video
              key={`${slide.imageUrl}-${i}`}
              ref={(el) => { videoRefs.current[i] = el; }}
              src={slide.imageUrl}
              className={commonClassName}
              style={commonStyle}
              muted
              playsInline
              loop={slides.length < 2} // Only loop if it's the ONLY item on the display
              onEnded={() => {
                if (slides.length >= 2) nextSlide(); // Advance when video finishes
              }}
              onError={() => {
                if (slides.length >= 2) nextSlide(); // Skip if video breaks
              }}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={`${slide.imageUrl}-${i}`}
              src={slide.imageUrl}
              alt=""
              draggable={false}
              className={commonClassName}
              style={commonStyle}
            />
          );
        })
      )}

      {/* One-time hint to enter fullscreen (a real gesture is required). */}
      {showHint && slides.length > 0 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-black/50 text-white/80 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
          Tap for fullscreen
        </div>
      )}
    </div>
  );
}