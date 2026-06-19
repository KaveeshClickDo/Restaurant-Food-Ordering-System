import { z } from "zod";
import { NonEmptyString, PositiveMoney, Money } from "./primitives";

const NonEmptyIdArray = z.array(NonEmptyString).min(1, "At least one orderId is required.");

export const WaiterRefundSchema = z.object({
  orderIds:     NonEmptyIdArray,
  refundAmount: PositiveMoney,
  refundMethod: z.enum(["cash", "card"]).optional(),
  reason:       NonEmptyString,
  refundedBy:   z.string().optional(),
});

export const WaiterSettleSchema = z.object({
  orderIds:      NonEmptyIdArray,
  tableLabel:    NonEmptyString,
  // "gift_card" = the card covered the whole bill, so there's no cash/card
  // remainder to record (mirrors the POS "gift card only" tender).
  paymentMethod: z.enum(["cash", "card", "gift_card"]).optional(),
  // Optional gift card tender applied across the table's combined bill. The
  // server looks up + clamps the amount and stamps it on the first order of
  // the batch, then redeems against that order id.
  giftCardCode:  z.string().optional(),
  giftCardUsed:  Money.optional(),
  // Bill-level manual discount + table-service tip + table-sevice fee, applied across the whole
  // bill and stamped on the anchor (first) order. discountAmount is the money
  // value the waiter app already computed from the percentage; the server
  // re-clamps it to the bill subtotal so it can never exceed what's owed.
  discountAmount: Money.optional(),
  discountNote:   z.string().optional(),
  tipAmount:      Money.optional(),
  serviceFeeAmount: Money.optional(),
  // VAT on the post-discount bill, synced from the admin Tax & VAT setting.
  // vatInclusive=true means it's already inside the item prices (the bill total
  // is unchanged); false means it's added on top. Stored on the anchor order so
  // Finance Reports' VAT breakdown includes dine-in.
  vatAmount:     Money.optional(),
  vatInclusive:  z.boolean().optional(),
});

export const WaiterVoidSchema = z.object({
  orderIds: NonEmptyIdArray,
  reason:   NonEmptyString,
  voidedBy: z.string().optional(),
});

const RefundEntry = z.object({
  id:           NonEmptyString,
  orderId:      NonEmptyString,
  amount:       PositiveMoney,
  type:         z.enum(["full", "partial"]),
  reason:       NonEmptyString,
  // Gift-card refunds are intentionally NOT supported: a gift card is prepaid
  // money, so only the cash/card/gateway portion is refundable. (See the gift
  // card model — spending a card is non-refundable.)
  method:       z.enum(["original_payment", "store_credit", "cash"]),
  note:         z.string().optional(),
  processedAt:  NonEmptyString,
  processedBy:  NonEmptyString,
  stripeRefundId: z.string().nullable().optional(),
  paypalRefundId: z.string().nullable().optional(),
});

export const AdminRefundSchema = z.object({
  newStatus:      NonEmptyString,
  refunds:        z.array(RefundEntry).min(1),
  refundedAmount: Money,
  customerId:     z.string().optional(),
  newStoreCredit: z.number().nonnegative().optional(),
});

// F-PU-1: credit spend is now tied to a specific order — server verifies the
// order belongs to the calling session, and idempotently sets the order's
// store_credit_used field so a replay can't drain the balance twice.
export const SpendCreditSchema = z.object({
  amount:   PositiveMoney,
  order_id: NonEmptyString,
});
