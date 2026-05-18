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
  paymentMethod: z.enum(["cash", "card"]).optional(),
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
  method:       z.enum(["original_payment", "store_credit", "cash"]),
  note:         z.string().optional(),
  processedAt:  NonEmptyString,
  processedBy:  NonEmptyString,
  stripeRefundId: z.string().nullable().optional(),
});

export const AdminRefundSchema = z.object({
  newStatus:      NonEmptyString,
  refunds:        z.array(RefundEntry).min(1),
  refundedAmount: Money,
  customerId:     z.string().optional(),
  newStoreCredit: z.number().nonnegative().optional(),
});

export const SpendCreditSchema = z.object({
  amount: PositiveMoney,
});
