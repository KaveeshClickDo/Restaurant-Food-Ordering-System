"use client";

import { useEffect, useMemo, useState } from "react";
import LocationMap, { MapMarker } from "./LocationMap";
import { geocode, type Geo } from "@/lib/useGeocode";

export interface DeliveryStop {
  id: string;
  address: string;
  customerName: string;
}

interface Props {
  restaurantLat: number;
  restaurantLng: number;
  stops: DeliveryStop[];
}

export default function DriverDeliveriesMap({ restaurantLat, restaurantLng, stops }: Props) {
  const [coords, setCoords] = useState<Record<string, Geo | null>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const stop of stops) {
        if (cancelled) return;
        const geo = await geocode(stop.address);
        if (cancelled) return;
        setCoords((prev) => (stop.id in prev ? prev : { ...prev, [stop.id]: geo }));
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
      const geo = coords[s.id];
      if (geo) {
        list.push({
          lat: geo.lat,
          lng: geo.lng,
          color: "#2563eb",
          label: String(i + 1),
          tooltip: `${i + 1}. ${s.customerName}`,
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
