"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

const isDev = process.env.NODE_ENV === "development";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", {
      message: error.message,
      digest:  error.digest,
      stack:   error.stack,
    });
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-16 h-16 bg-orange-50 border border-orange-200 rounded-2xl flex items-center justify-center mb-6">
        <AlertTriangle size={28} className="text-orange-500" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>

      <p className="text-gray-500 text-sm max-w-sm mb-1 leading-relaxed">
        {error.message || "An unexpected error occurred while loading this page."}
      </p>

      {error.digest && (
        <p className="text-gray-400 text-xs font-mono mb-4">
          Error ID: {error.digest}
        </p>
      )}

      {/* In development, show the full stack trace so the root cause is obvious */}
      {isDev && error.stack && (
        <details className="w-full max-w-2xl mb-4 text-left">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 mb-1">
            Stack trace (dev only)
          </summary>
          <pre className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap break-words">
            {error.stack}
          </pre>
        </details>
      )}

      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={reset}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors"
        >
          <RefreshCw size={15} />
          Try again
        </button>
        <Link
          href="/"
          className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors"
        >
          <Home size={15} />
          Back to menu
        </Link>
      </div>
    </div>
  );
}
