"use client";

/**
 * Customer-facing interactive floor-plan map for table booking.
 *
 * Renders the restaurant's uploaded floor-plan image with every *placed* table
 * (one that an admin positioned in the Tables → Floor Plan editor) drawn as a
 * marker at its normalised 0..1 coordinates. Markers are coloured by per-slot
 * status — available, VIP, booked, or too small for the party — and an available
 * one can be tapped to select it. Shared by ReservationModal and the /book page
 * so both booking surfaces look and behave identically.
 */

import { Crown, Check } from "lucide-react";

export interface MapTable {
  id: string;
  label: string;
  seats: number;
  section: string;
  isVip?: boolean;
  vipPrice?: number;
  posX: number | null;
  posY: number | null;
  status: "available" | "booked" | "too_small";
}

export default function TableMap({
  imageUrl,
  tables,
  selectedId,
  onSelect,
  currencySymbol = "£",
  allowVipSelect = true,
}: {
  imageUrl: string;
  tables: MapTable[];
  selectedId: string | null;
  onSelect: (table: MapTable) => void;
  currencySymbol?: string;
  /** When false, VIP tables are shown highlighted but cannot be selected. */
  allowVipSelect?: boolean;
}) {
  const placed = tables.filter((t) => t.posX != null && t.posY != null);

  return (
    <div className="space-y-3">
      <div className="relative w-full rounded-2xl overflow-hidden border border-gray-200 bg-gray-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Restaurant floor plan"
          className="w-full h-auto block select-none"
          draggable={false}
        />

        {placed.map((t) => {
          const selected   = selectedId === t.id;
          const selectable = t.status === "available" && (allowVipSelect || !t.isVip);

          const cls = selected
            ? "bg-orange-500 border-orange-600 text-white ring-2 ring-offset-1 ring-orange-300"
            : t.status === "booked"
              ? "bg-gray-100 border-gray-300 text-gray-400 line-through"
              : t.status === "too_small"
                ? "bg-gray-50 border-dashed border-gray-300 text-gray-400"
                : t.isVip
                  ? "bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200"
                  : "bg-emerald-50 border-emerald-500 text-emerald-700 hover:bg-emerald-100";

          const title =
            t.status === "booked"      ? `${t.label} — already booked`
            : t.status === "too_small" ? `${t.label} — seats ${t.seats}, too small for your party`
            : t.isVip                  ? `${t.label} — VIP, ${currencySymbol}${(t.vipPrice ?? 0).toFixed(2)} booking fee`
            :                            `${t.label} — up to ${t.seats} guests`;

          return (
            <button
              key={t.id}
              type="button"
              disabled={!selectable}
              onClick={() => selectable && onSelect(t)}
              title={title}
              style={{ left: `${t.posX! * 100}%`, top: `${t.posY! * 100}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 shadow-sm text-[10px] sm:text-[11px] font-bold transition ${
                selectable ? "cursor-pointer active:scale-95" : "cursor-not-allowed opacity-90"
              } ${cls}`}
            >
              {t.isVip && t.status !== "booked" && (
                <Crown size={9} className={selected ? "text-white" : "text-amber-500"} />
              )}
              <span className="leading-none max-w-[2.2rem] truncate px-0.5">{t.label}</span>
              {selected && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-orange-500 border-2 border-white flex items-center justify-center">
                  <Check size={9} className="text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-50 border-2 border-emerald-500" /> Available</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-100 border-2 border-amber-400" /><Crown size={11} className="text-amber-500" /> VIP</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gray-100 border-2 border-gray-300" /> Booked</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-orange-500 border-2 border-orange-600" /> Selected</span>
      </div>
    </div>
  );
}
