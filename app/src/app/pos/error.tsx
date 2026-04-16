"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

const isDev = process.env.NODE_ENV === "development";

export default function POSError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("POS error:", {
      message: error.message,
      digest:  error.digest,
      stack:   error.stack,
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-8">
      <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mb-6">
        <AlertTriangle size={28} className="text-red-400" />
      </div>
      <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
      <p className="text-slate-400 text-sm mb-1 text-center max-w-sm">
        {error.message || "An unexpected error occurred in the POS system."}
      </p>
      {error.digest && (
        <p className="text-slate-600 text-xs mb-4 font-mono">
          Error ID: {error.digest}
        </p>
      )}

      {isDev && error.stack && (
        <details className="w-full max-w-xl mb-4 text-left">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300 mb-2">
            Stack trace (dev only)
          </summary>
          <pre className="text-[10px] text-red-400 bg-red-950/50 border border-red-900/50 rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap break-words">
            {error.stack}
          </pre>
        </details>
      )}

      <button
        onClick={reset}
        className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-semibold transition-colors mt-2"
      >
        <RefreshCw size={16} />
        Try again
      </button>
    </div>
  );
}
