"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DeliveryZone } from "@/types";
import { useApp } from "@/context/AppContext";

const restaurantIcon = L.divIcon({
  className: "delivery-zone-restaurant-pin",
  html: `
    <div style="
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background: #f97316;
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="width:8px;height:8px;border-radius:9999px;background:white;"></div>
    </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function RecenterOnChange({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

function ClickHandler({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMove(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
    },
  });
  return null;
}

function FitToZones({ lat, lng, maxKm }: { lat: number; lng: number; maxKm: number }) {
  const map = useMap();
  useEffect(() => {
    if (maxKm <= 0) return;
    const bounds = L.latLng(lat, lng).toBounds(maxKm * 2000);
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [lat, lng, maxKm, map]);
  return null;
}

export default function DeliveryZoneMap({
  zones,
  lat,
  lng,
  onLocationChange,
}: {
  zones: DeliveryZone[];
  lat: number;
  lng: number;
  onLocationChange: (lat: number, lng: number) => void;
}) {
  const { settings } = useApp();
  const sym = settings.currency?.symbol ?? "£";
  const enabled = useMemo(
    () => zones.filter((z) => z.enabled).sort((a, b) => b.maxRadiusKm - a.maxRadiusKm),
    [zones],
  );
  const maxKm = enabled.length ? Math.max(...enabled.map((z) => z.maxRadiusKm)) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-5 pb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 bg-orange-100 rounded-xl flex items-center justify-center">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-600">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm">Coverage map</h3>
          <p className="text-xs text-gray-400">Click the map or drag the pin to move the restaurant</p>
        </div>

        </div>
        

        <span className="text-xs text-gray-400 font-mono">{lat.toFixed(4)}, {lng.toFixed(4)}</span>
      </div>

      <div className="h-[320px] w-full relative z-0">
        <MapContainer
          center={[lat, lng]}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {enabled.map((zone) => (
            <Circle
              key={zone.id}
              center={[lat, lng]}
              radius={zone.maxRadiusKm * 1000}
              pathOptions={{
                color: zone.color,
                fillColor: zone.color,
                fillOpacity: 0.12,
                weight: 2,
                dashArray: "5 4",
              }}
            />
          ))}

          <Marker
            position={[lat, lng]}
            draggable
            icon={restaurantIcon}
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                onLocationChange(+p.lat.toFixed(6), +p.lng.toFixed(6));
              },
            }}
          />

          <ClickHandler onMove={onLocationChange} />
          <RecenterOnChange lat={lat} lng={lng} />
          <FitToZones lat={lat} lng={lng} maxKm={maxKm} />
        </MapContainer>
      </div>

      {enabled.length > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 space-y-1.5">
          {enabled.map((zone) => (
            <div key={zone.id} className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: zone.color }} />
              <span className="font-medium">{zone.name}</span>
              <span className="text-gray-400">{zone.minRadiusKm}–{zone.maxRadiusKm} km</span>
              <span className="ml-auto font-semibold text-gray-700">{sym}{zone.fee.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
