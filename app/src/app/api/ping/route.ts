import { NextResponse } from "next/server";

// Lightweight liveness probe for offline connectivity detection.
// The POS polls HEAD /api/ping to distinguish true network loss from
// navigator.onLine false positives (captive portals, partial connectivity, etc.).
export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}

export async function GET() {
  return new NextResponse(null, { status: 204 });
}
