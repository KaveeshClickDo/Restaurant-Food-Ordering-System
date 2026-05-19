/**
 * POST /api/print
 *
 * Accepts a raw ESC/POS byte array and forwards it to an IP thermal printer
 * over a direct TCP socket (the standard "RAW" protocol used by Epson, Star,
 * Citizen, and most other thermal printers on port 9100).
 *
 * This must run in the Node.js runtime (not Edge) because it uses `net.Socket`.
 * Next.js App Router defaults to Node.js for API routes, so no explicit
 * `export const runtime` is required.
 */

import { NextResponse } from "next/server";
import net from "net";
import { isAdminAuthenticated } from "@/lib/adminAuth";
import {
  getPosSession,
  getKitchenSession,
  getWaiterSession,
  unauthorizedJson,
} from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseBody } from "@/lib/apiValidation";
import { PrintSchema } from "@/lib/schemas/pos";

async function isStaffAuthenticated(): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const [pos, kitchen, waiter] = await Promise.all([
    getPosSession(),
    getKitchenSession(),
    getWaiterSession(),
  ]);
  return Boolean(pos || kitchen || waiter);
}

/**
 * F-PU-4: server-side allowlist of printer IPs.
 *
 * The list is sourced from app_settings.data.printer.allowedIps, with a
 * fallback to the single `printer.ip` field for backward compatibility.
 * If the resulting list is empty (no printer configured), every print
 * request is rejected — failing closed.
 */
async function loadAllowedPrinterIps(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("data").eq("id", 1).single();
  const printer = (data?.data as { printer?: { ip?: string; allowedIps?: string[] } } | undefined)?.printer;
  const list: string[] = [];
  if (Array.isArray(printer?.allowedIps)) {
    for (const v of printer.allowedIps) if (typeof v === "string" && v.trim()) list.push(v.trim());
  }
  if (printer?.ip && typeof printer.ip === "string" && printer.ip.trim()) {
    list.push(printer.ip.trim());
  }
  return new Set(list);
}

export async function POST(request: Request) {
  if (!await isStaffAuthenticated()) return unauthorizedJson();

  const parsed = await parseBody(request, PrintSchema);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  const { ip, port, bytes } = parsed.data;
  const targetIp = ip.trim();

  const allowed = await loadAllowedPrinterIps();
  if (allowed.size === 0) {
    return NextResponse.json(
      { ok: false, error: "No printers configured. Add an IP under admin → settings → printer." },
      { status: 503 },
    );
  }
  if (!allowed.has(targetIp)) {
    return NextResponse.json(
      { ok: false, error: "Target IP is not an allowlisted printer." },
      { status: 400 },
    );
  }

  const portNum = port;
  const buffer = Buffer.from(bytes);

  try {
    await connectAndSend(ip.trim(), portNum, buffer);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown printer error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── TCP helper ──────────────────────────────────────────────────────────────

function enrichSocketError(err: NodeJS.ErrnoException, ip: string, port: number): Error {
  switch (err.code) {
    case "ECONNREFUSED":
      return new Error(
        `Printer at ${ip}:${port} refused the connection. ` +
        `Check that the printer is powered on, not in error/sleep state, and that port ${port} is correct.`
      );
    case "ETIMEDOUT":
      return new Error(
        `Connection to ${ip}:${port} timed out. ` +
        `Check the IP address is correct and the printer is on the same network as this server.`
      );
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return new Error(
        `Printer at ${ip} is unreachable. ` +
        `Ensure the printer and server are on the same network/VLAN.`
      );
    case "ENOTFOUND":
      return new Error(
        `Host "${ip}" not found. Use a numeric IP address (e.g. 192.168.1.100) instead of a hostname.`
      );
    case "EADDRNOTAVAIL":
      return new Error(`IP address ${ip} is not available on this network.`);
    default:
      return new Error(err.message || `Socket error (${err.code ?? "unknown"})`);
  }
}

function connectAndSend(
  ip: string,
  port: number,
  data: Buffer,
  timeoutMs = 6_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled  = false;

    function settle(err?: Error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else     resolve();
    }

    socket.setTimeout(timeoutMs);

    socket.connect(port, ip, () => {
      socket.write(data, (writeErr) => {
        if (writeErr) {
          settle(enrichSocketError(writeErr as NodeJS.ErrnoException, ip, port));
          return;
        }
        // Half-close the write side — finish event fires once all bytes are
        // flushed to the kernel send buffer (fixing the previous settle-too-early bug)
        socket.end();
      });
    });

    // Wait until the write buffer is fully drained before resolving
    socket.on("finish", () => settle());

    socket.on("error", (err) =>
      settle(enrichSocketError(err as NodeJS.ErrnoException, ip, port))
    );

    socket.on("timeout", () =>
      settle(new Error(
        `Printer at ${ip}:${port} did not respond within ${timeoutMs / 1000} s. ` +
        `Check the printer is powered on and connected to the network.`
      ))
    );
  });
}
