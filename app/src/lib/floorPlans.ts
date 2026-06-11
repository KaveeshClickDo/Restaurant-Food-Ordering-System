/**
 * Floor-plan helpers shared by the admin editor, the public settings API and
 * both customer booking surfaces.
 *
 * A restaurant can have several named floor plans (reservationSystem.floorPlans).
 * Deployments from before multi-floor support only have the legacy single-image
 * fields (floorPlanImageUrl / floorPlanMarkerScale); resolveFloorPlans() folds
 * those into a one-element array so every consumer works off the same shape
 * without a data migration.
 */

import type { FloorPlan, ReservationSystem } from "@/types";

/** Stable id given to the floor synthesized from the legacy single-image fields.
 *  Placed tables with a null floor_plan_id belong to the FIRST plan, so the
 *  legacy floor must always be created first and keep this id. */
export const LEGACY_FLOOR_ID = "floor-main";

/** Partial shape so server routes can pass the raw JSONB block without casting. */
type RsLike = Pick<ReservationSystem, "floorPlans" | "floorPlanImageUrl" | "floorPlanMarkerScale">;

/** Every configured floor plan, migrating legacy single-image settings to a
 *  one-element list. May include plans whose image hasn't been uploaded yet —
 *  filter with hasImage() on customer surfaces. */
export function resolveFloorPlans(rs: RsLike | undefined | null): FloorPlan[] {
  const plans = rs?.floorPlans;
  if (Array.isArray(plans) && plans.length > 0) return plans;
  if (rs?.floorPlanImageUrl) {
    return [{
      id:          LEGACY_FLOOR_ID,
      name:        "Main Floor",
      imageUrl:    rs.floorPlanImageUrl,
      markerScale: rs.floorPlanMarkerScale ?? 1,
    }];
  }
  return [];
}

/** Plans that customers can actually see (an image has been uploaded). */
export function hasImage(plan: FloorPlan): boolean {
  return !!plan.imageUrl;
}

/** The floor a placed table belongs to. Tables placed before multi-floor
 *  support carry no floorId — they live on the first plan. */
export function effectiveFloorId(floorId: string | null | undefined, plans: FloorPlan[]): string | null {
  return floorId ?? plans[0]?.id ?? null;
}
