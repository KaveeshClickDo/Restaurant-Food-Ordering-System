import { POSSale } from "@/types/pos";
import { fmtDate, fmtTime } from "../_utils";

export type POSPeriod = "today" | "yesterday" | "week" | "month" | "last30" | "custom";

export const POS_PERIODS: { id: POSPeriod; label: string }[] = [
  { id: "today",     label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week",      label: "This Week" },
  { id: "month",     label: "This Month" },
  { id: "last30",    label: "Last 30 Days" },
  { id: "custom",    label: "Custom" },
];

export function getPOSDateRange(period: POSPeriod, customStart: string, customEnd: string): [Date, Date] {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":     return [today, now];
    case "yesterday": {
      const y  = new Date(today); y.setDate(y.getDate() - 1);
      const ye = new Date(today); ye.setMilliseconds(-1);
      return [y, ye];
    }
    case "week":  { const w = new Date(today); w.setDate(w.getDate() - 6); return [w, now]; }
    case "month": return [new Date(today.getFullYear(), today.getMonth(), 1), now];
    case "last30":{ const l = new Date(today); l.setDate(l.getDate() - 29); return [l, now]; }
    case "custom": return [
      customStart ? new Date(customStart)              : new Date(0),
      customEnd   ? new Date(customEnd + "T23:59:59")  : now,
    ];
  }
}

export function posDailyBuckets(sales: POSSale[], start: Date, end: Date) {
  const map: Record<string, number> = {};
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay  = new Date(end.getFullYear(),  end.getMonth(),   end.getDate());
  while (cursor <= endDay) {
    map[cursor.toDateString()] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const s of sales) {
    const key = new Date(s.date).toDateString();
    if (key in map) map[key] = (map[key] ?? 0) + s.total;
  }
  return Object.entries(map).map(([key, revenue]) => ({
    label:   new Date(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    revenue,
  }));
}

export function posHourlyBuckets(sales: POSSale[]) {
  const map: number[] = Array(24).fill(0);
  for (const s of sales) map[new Date(s.date).getHours()] += s.total;
  return map;
}

export function posExportCSV(sales: POSSale[], sym: string) {
  const header = ["Receipt No","Date","Time","Staff","Customer","Items",`Subtotal (${sym})`,`Discount (${sym})`,`VAT (${sym})`,`Tip (${sym})`,`Service Fee (${sym})`,`Total (${sym})`,"Payment","Voided","Void Reason"].join(",");
  const rows = sales.map((s) => [
    s.receiptNo, fmtDate(s.date), fmtTime(s.date),
    `"${s.staffName}"`, `"${s.customerName ?? ""}"`,
    s.items.length, s.subtotal.toFixed(2), s.discountAmount.toFixed(2),
    s.taxAmount.toFixed(2), s.tipAmount.toFixed(2), s.serviceFeeAmount.toFixed(2), s.total.toFixed(2),
    s.paymentMethod, s.voided ? "Yes" : "No", `"${s.voidReason ?? ""}"`,
  ].join(","));
  const csv  = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `pos-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}
