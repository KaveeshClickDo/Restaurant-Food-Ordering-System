"use client";

import { useEffect } from "react";

const isDev = process.env.NODE_ENV === "development";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  const isEnvError =
    isDev &&
    (error.message?.includes("supabaseUrl") ||
      error.message?.includes("SUPABASE") ||
      error.message?.includes("environment variable"));

  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, sans-serif", background: "#f9fafb", color: "#111827" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div style={{ maxWidth: "560px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Something went wrong</h1>
            <p style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
              {error.message || "An unexpected error occurred. Please try again."}
            </p>

            {error.digest && (
              <p style={{ color: "#9ca3af", fontSize: "0.75rem", fontFamily: "monospace", marginBottom: "1rem" }}>
                Error ID: {error.digest}
              </p>
            )}

            {isEnvError && (
              <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: "0.75rem", padding: "1rem", marginBottom: "1rem", textAlign: "left" }}>
                <p style={{ fontWeight: 600, color: "#92400e", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                  Missing Supabase environment variables
                </p>
                <p style={{ color: "#78350f", fontSize: "0.78rem", lineHeight: 1.6 }}>
                  Make sure <code style={{ background: "#fde68a", padding: "0 4px", borderRadius: 3 }}>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                  <code style={{ background: "#fde68a", padding: "0 4px", borderRadius: 3 }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set
                  in <code style={{ background: "#fde68a", padding: "0 4px", borderRadius: 3 }}>.env.local</code> and restart the dev server.
                </p>
              </div>
            )}

            {isDev && error.stack && (
              <details style={{ textAlign: "left", marginBottom: "1.5rem" }}>
                <summary style={{ color: "#9ca3af", fontSize: "0.75rem", cursor: "pointer", marginBottom: "0.5rem" }}>
                  Stack trace (dev only)
                </summary>
                <pre style={{ fontSize: "0.65rem", color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.5rem", padding: "0.75rem", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {error.stack}
                </pre>
              </details>
            )}

            <button
              onClick={reset}
              style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: "0.75rem", padding: "0.75rem 1.5rem", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
