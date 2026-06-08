"use client";

import type { PaymentStatus } from "@/types";
import { CheckCircle2, Banknote, RotateCcw, AlertCircle, Clock } from "lucide-react";

/**
 * PaymentStatusBadge — admin-facing badge that tells the operator whether the
 * money for an order has actually been collected.
 *
 * Distinct from the OrderStatus badge (pending → preparing → delivered),
 * which only tracks fulfillment. A "delivered" order can still be "unpaid"
 * (cash-on-delivery before the driver returns) and a "paid" order can still
 * be "pending" (just placed, kitchen hasn't seen it).
 *
 * Render this next to the OrderStatus badge anywhere admin sees an order.
 */

const CONFIG: Record<PaymentStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  paid: {
    label: "Paid",
    cls:   "bg-emerald-100 text-emerald-700 border-emerald-200",
    icon:  <CheckCircle2 size={11} />,
  },
  unpaid: {
    label: "Unpaid",
    cls:   "bg-amber-100 text-amber-700 border-amber-200",
    icon:  <Banknote size={11} />,
  },
  partially_refunded: {
    label: "Partially refunded",
    cls:   "bg-blue-100 text-blue-700 border-blue-200",
    icon:  <RotateCcw size={11} />,
  },
  refunded: {
    label: "Refunded",
    cls:   "bg-teal-100 text-teal-700 border-teal-200",
    icon:  <RotateCcw size={11} />,
  },
  failed: {
    label: "Failed",
    cls:   "bg-red-100 text-red-700 border-red-200",
    icon:  <AlertCircle size={11} />,
  },
};

const FALLBACK = {
  label: "Pending",
  cls:   "bg-gray-100 text-gray-600 border-gray-200",
  icon:  <Clock size={11} />,
};

export function PaymentStatusBadge({
  status,
  size = "sm",
}: {
  status?: PaymentStatus | null;
  size?: "xs" | "sm";
}) {
  const cfg = status ? CONFIG[status] ?? FALLBACK : FALLBACK;
  const sizing = size === "xs"
    ? "text-[10px] px-1.5 py-0.5 gap-0.5"
    : "text-xs px-2 py-0.5 gap-1";
  return (
    <span className={`inline-flex items-center font-semibold rounded-full border ${cfg.cls} ${sizing}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

/**
 * Render the Stripe Payment Intent id as a clickable badge linking to the
 * Stripe dashboard. Detects test vs live by the `pi_test_` prefix Stripe
 * uses (actually live keys are just `pi_` + alphanumerics — there's no
 * marker on the id itself, but Stripe's dashboard URL handles both).
 */
export function StripeIntentLink({ paymentIntentId }: { paymentIntentId: string }) {
  // Stripe dashboard auto-resolves to the right account.
  const url = `https://dashboard.stripe.com/payments/${paymentIntentId}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-600 hover:text-indigo-800 hover:underline"
      title="Open in Stripe Dashboard"
    >
      {paymentIntentId}
    </a>
  );
}
