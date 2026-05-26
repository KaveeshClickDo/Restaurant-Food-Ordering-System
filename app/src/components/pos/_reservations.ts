export type ResRow = {
  id: string; table_id: string; table_label: string; section: string;
  customer_name: string; customer_email: string; customer_phone: string;
  date: string; time: string; party_size: number; status: string; note?: string;
  checked_in_at?: string; checked_out_at?: string;
  vip_fee?: number; payment_status?: string; payment_method?: string;
};

export function fmt12Pos(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

export function fmtTsPos(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
