export async function register() {
  // no-op — required to activate onRequestError below
}

export async function onRequestError(
  err: { message?: string; digest?: string },
  _request: Request,
  _context: unknown,
) {
  // Log every unhandled API route error to the server console.
  // Next.js 15 calls this hook before it sends the plain-text
  // "Internal Server Error" response, giving us a traceable log line.
  console.error("[onRequestError]", err?.message ?? err);
}
