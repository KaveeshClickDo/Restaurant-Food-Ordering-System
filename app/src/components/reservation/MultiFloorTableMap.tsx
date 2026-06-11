"use client";

/**
 * Floor-aware wrapper around the customer booking TableMap.
 *
 * When the restaurant has several named floor plans ("Ground Floor", "Rooftop",
 * …) this renders a floor selector above the map — each pill shows the floor
 * name plus how many tables are free there for the requested slot — and draws
 * only the chosen floor's tables. With a single floor it renders the plain map,
 * exactly as before. Shared by ReservationModal and the /book page so both
 * booking surfaces look and behave identically.
 */

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import type { FloorPlan } from "@/types";
import { effectiveFloorId } from "@/lib/floorPlans";
import TableMap, { type MapTable } from "@/components/reservation/TableMap";

export default function MultiFloorTableMap({
  plans,
  tables,
  selectedId,
  onSelect,
  currencySymbol = "£",
  allowVipSelect = true,
}: {
  /** Customer-visible floor plans (every entry has an image). */
  plans: FloorPlan[];
  tables: MapTable[];
  selectedId: string | null;
  onSelect: (table: MapTable) => void;
  currencySymbol?: string;
  /** When false, VIP tables are shown highlighted but cannot be selected. */
  allowVipSelect?: boolean;
}) {
  const tablesOn = (floorId: string) =>
    tables.filter((t) => effectiveFloorId(t.floorId, plans) === floorId);
  const availableOn = (floorId: string) =>
    tablesOn(floorId).filter((t) => t.status === "available").length;

  // Start on the first floor that has a free table so the guest lands somewhere
  // bookable; fall back to the first floor.
  const [activeId, setActiveId] = useState<string | null>(
    () => (plans.find((p) => availableOn(p.id) > 0) ?? plans[0])?.id ?? null,
  );

  // Keep the selection valid if availability refetches change the plan list.
  useEffect(() => {
    if (!plans.some((p) => p.id === activeId)) setActiveId(plans[0]?.id ?? null);
  }, [plans, activeId]);

  const activePlan = plans.find((p) => p.id === activeId) ?? plans[0];
  if (!activePlan) return null;

  return (
    <div className="space-y-3">
      {/* Floor selector — only worth showing with 2+ floors */}
      {plans.length > 1 && (
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            <Layers size={11} />
            Choose a floor
          </div>
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => {
              const isActive = p.id === activePlan.id;
              const free = availableOn(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveId(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition-all ${
                    isActive
                      ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                      : "bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-600"
                  }`}
                >
                  <span className="max-w-[9rem] truncate" title={p.name}>{p.name}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    isActive ? "bg-white/25 text-white" : free > 0 ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-400"
                  }`}>
                    {free > 0 ? `${free} free` : "full"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <TableMap
        imageUrl={activePlan.imageUrl}
        tables={tablesOn(activePlan.id)}
        selectedId={selectedId}
        onSelect={onSelect}
        currencySymbol={currencySymbol}
        allowVipSelect={allowVipSelect}
        markerScale={activePlan.markerScale ?? 1}
      />
    </div>
  );
}
