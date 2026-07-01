export function fmt(n: number, sym = "£") { return `${sym}${n.toFixed(2)}`; }
export function fmtPct(n: number) { return `${n.toFixed(0)}%`; }
// Offline sales carry an `OFF<seq>` receipt number (vs online `R<seq>`), so a
// receipt prefixed "OFF" was rung up with no internet. Used to badge such sales
// "OFFLINE SALE" wherever a receipt is shown.
export function isOfflineSale(receiptNo?: string | null): boolean { return !!receiptNo && receiptNo.startsWith("OFF"); }
export function getInitials(name: string) { return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2); }
export function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
