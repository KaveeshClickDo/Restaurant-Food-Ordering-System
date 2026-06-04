import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function rewardLoyaltyPoints(customerId: string | null | undefined, orderTotal: number) {
  // Ignore guests, POS walk-ins, and £0 orders
  if (!customerId || customerId === "guest" || customerId === "pos-walk-in" || orderTotal <= 0) {
    return;
  }

  try {
    // 1. Fetch the live loyalty rate from app_settings
    const { data: settingsRow } = await supabaseAdmin
      .from("app_settings")
      .select("data")
      .single();

    const loyaltyPointsPerPound = settingsRow?.data?.loyaltyPointsPerPound ?? 1;
    const pointsToAdd = Math.floor(orderTotal * loyaltyPointsPerPound);

    if (pointsToAdd <= 0) return;

    // 2. Fetch current customer points
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("loyalty_points")
      .eq("id", customerId)
      .maybeSingle();

    if (customer) {
      const currentPoints = Number(customer.loyalty_points ?? 0);
      
      // 3. Update the customer with the new balance
      await supabaseAdmin
        .from("customers")
        .update({ loyalty_points: currentPoints + pointsToAdd })
        .eq("id", customerId);
        
      console.log(`[Loyalty] Awarded ${pointsToAdd} points to ${customerId}`);
    }
  } catch (err) {
    console.error("[Loyalty] Failed to reward points:", err);
  }
}