/**
 * capacitorBridge.ts
 *
 * Thin JS→Native bridge for the Capacitor Android shell.
 *
 * Design:
 *  - Uses window.Capacitor (injected by the native shell at runtime) rather
 *    than importing @capacitor/core, so this file compiles cleanly in the
 *    browser/Next.js build without Capacitor installed.
 *  - All functions return graceful { ok: false } when not running inside
 *    the Capacitor Android app.
 *  - Native plugin implementations live in:
 *      android/.../plugins/BluetoothPrinterPlugin.kt
 *      android/.../plugins/UsbPrinterPlugin.kt
 *      android/.../plugins/TcpPrinterPlugin.kt
 */

// ─── Capacitor global (injected by native shell) ──────────────────────────────

interface CapacitorGlobal {
  isNativePlatform(): boolean;
  getPlatform(): "android" | "ios" | "web";
  Plugins: Record<string, unknown>;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export function isCapacitorAndroid(): boolean {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  return Boolean(cap?.isNativePlatform() && cap.getPlatform() === "android");
}

function getPlugin<T>(name: string): T | null {
  if (!isCapacitorAndroid()) return null;
  const plugin = window.Capacitor!.Plugins[name];
  return (plugin as T) ?? null;
}

// ─── Plugin interfaces ────────────────────────────────────────────────────────

export interface BluetoothDevice {
  name: string;
  address: string; // MAC address: "AA:BB:CC:DD:EE:FF"
}

interface _BTPlugin {
  getPairedDevices(): Promise<{ devices: BluetoothDevice[] }>;
  print(opts: { address: string; bytes: number[] }): Promise<void>;
}

interface _USBPlugin {
  getDevices(): Promise<{ devices: Array<{ name: string; deviceId: number }> }>;
  print(opts: { bytes: number[]; deviceId?: number }): Promise<void>;
}

interface _TCPPlugin {
  print(opts: { ip: string; port: number; bytes: number[] }): Promise<void>;
}

// ─── Bluetooth printer ────────────────────────────────────────────────────────

/**
 * Return all Bluetooth devices currently paired with this Android device.
 * Returns [] when not running on Android or BT is disabled.
 */
export async function getBluetoothPairedDevices(): Promise<BluetoothDevice[]> {
  const plugin = getPlugin<_BTPlugin>("BluetoothPrinter");
  if (!plugin) return [];
  try {
    const { devices } = await plugin.getPairedDevices();
    return devices ?? [];
  } catch (err) {
    console.error("[BT] getPairedDevices failed:", err);
    return [];
  }
}

/**
 * Send raw ESC/POS bytes to a Bluetooth printer by MAC address.
 * Never throws — returns ok/error.
 */
export async function sendBluetooth(
  address: string,
  bytes: number[],
): Promise<{ ok: boolean; error?: string }> {
  const plugin = getPlugin<_BTPlugin>("BluetoothPrinter");
  if (!plugin) {
    return {
      ok: false,
      error: "Bluetooth printing is only available in the Android app. Use Network or Browser print mode on this device.",
    };
  }
  try {
    await plugin.print({ address, bytes });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Bluetooth print error: ${msg}` };
  }
}

// ─── USB printer ──────────────────────────────────────────────────────────────

export interface UsbPrinterDevice {
  name: string;
  deviceId: number;
}

/**
 * Return USB devices connected to this Android device.
 * Requires the UsbPrinterPlugin and USB Host permission in AndroidManifest.
 */
export async function getUsbDevices(): Promise<UsbPrinterDevice[]> {
  const plugin = getPlugin<_USBPlugin>("UsbPrinter");
  if (!plugin) return [];
  try {
    const { devices } = await plugin.getDevices();
    return devices ?? [];
  } catch (err) {
    console.error("[USB] getDevices failed:", err);
    return [];
  }
}

/**
 * Send raw ESC/POS bytes to a USB printer.
 * deviceId is optional — uses first available device if omitted.
 */
export async function sendUsb(
  bytes: number[],
  deviceId?: number,
): Promise<{ ok: boolean; error?: string }> {
  const plugin = getPlugin<_USBPlugin>("UsbPrinter");
  if (!plugin) {
    return {
      ok: false,
      error: "USB printing via native plugin is only available in the Android app.",
    };
  }
  try {
    await plugin.print({ bytes, deviceId });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `USB print error: ${msg}` };
  }
}

// ─── Direct TCP printer (no server proxy) ────────────────────────────────────

/**
 * Send raw ESC/POS bytes directly to a LAN printer from the Android device.
 * This bypasses the /api/print server proxy — works offline on LAN.
 * Falls back to /api/print when not on Android.
 */
export async function sendTcpNative(
  ip: string,
  port: number,
  bytes: number[],
): Promise<{ ok: boolean; error?: string }> {
  const plugin = getPlugin<_TCPPlugin>("TcpPrinter");
  if (!plugin) {
    // Not on Android — caller should use the /api/print server proxy instead
    return { ok: false, error: "native_unavailable" };
  }
  try {
    await plugin.print({ ip, port, bytes });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `TCP print error: ${msg}` };
  }
}
