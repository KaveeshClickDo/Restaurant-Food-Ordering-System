import { NextResponse } from "next/server";

type RouteHandler<T extends unknown[]> = (...args: T) => Promise<NextResponse>;

/**
 * Wraps a Next.js App Router route handler so that any uncaught exception
 * returns a JSON 500 instead of the default plain-text "Internal Server Error".
 */
export function withError<T extends unknown[]>(fn: RouteHandler<T>): RouteHandler<T> {
  return async (...args: T): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected server error";
      console.error("[API error]", message);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  };
}
