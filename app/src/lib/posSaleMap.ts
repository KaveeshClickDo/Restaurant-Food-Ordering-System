/**
 * Shared pos_sales row → POSSale mapper.
 *
 * Lives in lib (not in a route file) so both the POS-side endpoint
 * (/api/pos/sales) and the admin-side reports endpoint (/api/admin/pos-sales)
 * can map rows the same way. Next.js route files may only export HTTP method
 * handlers, so a shared mapper can't live there.
 */

import type { POSSale, POSCartItem } from "@/types/pos";

export type PosSaleRow = {
  id: string;
  receipt_no: string;
  date: string;
  staff_id: string | null;
  staff_name: string;
  customer_id: string | null;
  customer_name: string | null;
  table_number: number | null;
  items: POSCartItem[];
  subtotal: number;
  discount_amount: number;
  discount_note: string | null;
  tax_amount: number;
  tax_rate: number;
  tax_inclusive: boolean;
  tip_amount: number;
  service_fee_amount: number;
  total: number;
  payment_method: "cash" | "card" | "split";
  payments: { method: "cash" | "card"; amount: number }[];
  cash_tendered: number | null;
  change_given: number | null;
  voided: boolean;
  void_reason: string | null;
  refund_method: "cash" | "card" | "none" | null;
  refund_amount: number | null;
  gift_card_id: string | null;
  gift_card_used: number | null;
};

export function rowToSale(r: PosSaleRow): POSSale {
  return {
    id:             r.id,
    receiptNo:      r.receipt_no,
    date:           r.date,
    staffId:        r.staff_id ?? "",
    staffName:      r.staff_name,
    customerId:     r.customer_id ?? undefined,
    customerName:   r.customer_name ?? undefined,
    tableNumber:    r.table_number ?? undefined,
    items:          r.items,
    subtotal:       Number(r.subtotal),
    discountAmount: Number(r.discount_amount),
    discountNote:   r.discount_note ?? undefined,
    taxAmount:      Number(r.tax_amount),
    taxRate:        Number(r.tax_rate),
    taxInclusive:   r.tax_inclusive,
    tipAmount:      Number(r.tip_amount),
    serviceFeeAmount: Number(r.service_fee_amount),
    total:          Number(r.total),
    paymentMethod:  r.payment_method,
    payments:       r.payments ?? [],
    cashTendered:   r.cash_tendered  != null ? Number(r.cash_tendered)  : undefined,
    changeGiven:    r.change_given   != null ? Number(r.change_given)   : undefined,
    voided:         r.voided,
    voidReason:     r.void_reason  ?? undefined,
    refundMethod:   r.refund_method ?? undefined,
    refundAmount:   r.refund_amount != null ? Number(r.refund_amount) : undefined,
    giftCardUsed:   r.gift_card_used != null ? Number(r.gift_card_used) : 0,
    // Reconstruct the receipt-facing giftCard stamp (code isn't stored on the
    // sale row, only the id + amount — the amount is what receipts/reports need).
    giftCard:       r.gift_card_id ? { code: "", amount: Number(r.gift_card_used) || 0 } : undefined,
  };
}
