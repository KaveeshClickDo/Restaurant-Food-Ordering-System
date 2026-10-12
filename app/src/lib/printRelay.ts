/**
 * Shared thermal-printer relay: allowlist check + raw TCP send to an IP printer.
 *
 * Lives in lib (not in a route) so both /api/print (POS / kitchen / waiter
 * sessions) and /api/admin/print (admin session) can relay print jobs the same
 * way without one route importing the other. Node.js runtime only (uses
 * `net.Socket`) — the routes that import it run in the Node runtime.
 */

import net from "net";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePrinters } from "@/lib/printerRecords";

/**
 * F-PU-4: server-side allowlist of printer IPs, from every network-connection
 * printer across both categories (resolvePrinters also covers un-migrated
 * rows still on the old single-printer shape). Empty means every request
 * fails closed.
 */
async function loadAllowedPrinterIps(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("data").eq("id", 1).single();
  const printers = resolvePrinters(data?.data as Record<string, unknown> | undefined);
  const ips = printers
    .filter((p) => p.connection === "network" && p.ip?.trim())
    .map((p) => p.ip.trim());
  return new Set(ips);
}

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
    socket.on("error", (err) => settle(enrichSocketError(err as NodeJS.ErrnoException, ip, port)));
    socket.on("timeout", () =>
      settle(new Error(
        `Printer at ${ip}:${port} did not respond within ${timeoutMs / 1000} s. ` +
        `Check the printer is powered on and connected to the network.`
      ))
    );
  });
}

/**
 * Allowlist-check then send raw ESC/POS bytes to an IP printer. Returns a
 * result with the HTTP status the route should respond with — never throws.
 */
export async function relayPrintJob(
  ip: string,
  port: number,
  bytes: number[],
): Promise<{ ok: boolean; status: number; error?: string }> {
  const targetIp = ip.trim();

  const allowed = await loadAllowedPrinterIps();
  if (allowed.size === 0) {
    return { ok: false, status: 503, error: "No printers configured. Add an IP under admin → settings → printer." };
  }
  if (!allowed.has(targetIp)) {
    return { ok: false, status: 400, error: "Target IP is not an allowlisted printer." };
  }

  try {
    await connectAndSend(targetIp, port, Buffer.from(bytes));
    return { ok: true, status: 200 };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown printer error";
    return { ok: false, status: 500, error: message };
  }
}
