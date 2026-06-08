"use client";

import { useEffect, useMemo, useState } from "react";
import LocationMap, { MapMarker } from "./LocationMap";
import { geocode, type Geo } from "@/lib/useGeocode";

export interface DeliveryStop {
  id: string;
  address: string;
  customerName: string;
  /** Customer-supplied pin coordinates persisted with the order at checkout.
   *  When present, used directly — no geocoding, no rate limit, exact location.
   *  When absent (legacy orders), the address string is geocoded as a fallback. */
  lat?: number | null;
  lng?: number | null;
}

/** A stop's resolved coords plus how they were derived — drives marker color
 *  + tooltip so the driver knows whether the pin is exact or a guess. */
type ResolvedStop = (Geo & { source: "pin" }) | (Geo & { source: "geocoded" }) | null;

interface Props {
  restaurantLat: number;
  restaurantLng: number;
  stops: DeliveryStop[];
}

export default function DriverDeliveriesMap({ restaurantLat, restaurantLng, stops }: Props) {
  const [coords, setCoords] = useState<Record<string, ResolvedStop>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const stop of stops) {
        if (cancelled) return;
        // Fast path: order carried a customer-supplied pin. Use directly,
        // skip Nominatim entirely.
        if (
          typeof stop.lat === "number" && typeof stop.lng === "number"
          && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
        ) {
          setCoords((prev) => (stop.id in prev
            ? prev
            : { ...prev, [stop.id]: { lat: stop.lat as number, lng: stop.lng as number, source: "pin" } }));
          continue;
        }
        // Fallback: geocode the address string (legacy orders or address-only flows).
        if (!stop.address) {
          setCoords((prev) => (stop.id in prev ? prev : { ...prev, [stop.id]: null }));
          continue;
        }
        const geo = await geocode(stop.address);
        if (cancelled) return;
        setCoords((prev) => (stop.id in prev
          ? prev
          : { ...prev, [stop.id]: geo ? { ...geo, source: "geocoded" } : null }));
      }
    })();
    return () => { cancelled = true; };
    // We only want to re-run when the list of stop IDs changes, not when their
    // resolved coords arrive (which would loop forever).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map((s) => s.id).join("|")]);

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [
      { lat: restaurantLat, lng: restaurantLng, color: "#f97316", tooltip: "Restaurant", label: "R" },
    ];
    stops.forEach((s, i) => {
      const resolved = coords[s.id];
      if (resolved) {
        // Green = exact customer pin, blue = re-geocoded from address.
        const isPin = resolved.source === "pin";
        list.push({
          lat: resolved.lat,
          lng: resolved.lng,
          color: isPin ? "#16a34a" : "#2563eb",
          label: String(i + 1),
          tooltip: isPin
            ? `${i + 1}. ${s.customerName} — exact pin`
            : `${i + 1}. ${s.customerName} — estimated from address`,
        });
      }
    });
    return list;
  }, [restaurantLat, restaurantLng, stops, coords]);

  const resolved = stops.filter((s) => coords[s.id]).length;
  const pending  = stops.filter((s) => !(s.id in coords)).length;

  return (
    <div>
      <LocationMap
        center={[restaurantLat, restaurantLng]}
        height={260}
        markers={markers}
        fitToContent={resolved > 0}
        className="rounded-2xl border border-gray-200"
      />
      {(pending > 0 || resolved < stops.length) && (
        <p className="mt-2 text-[11px] text-gray-400 text-center">
          {pending > 0
            ? `Locating ${pending} address${pending !== 1 ? "es" : ""}…`
            : `Couldn't locate ${stops.length - resolved} of ${stops.length} address${stops.length !== 1 ? "es" : ""}.`}
        </p>
      )}
    </div>
  );
}
