"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Circle, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  color?: string;       // hex
  tooltip?: string;
  isPrimary?: boolean;  // primary marker (orange + draggable when enabled)
}

export interface MapZoneCircle {
  lat: number;
  lng: number;
  radiusKm: number;
  color: string;
  label?: string;
}

interface Props {
  center: [number, number];
  zoom?: number;
  height?: number | string;
  markers?: MapMarker[];
  zones?: MapZoneCircle[];
  /** Allow clicking the map to move the primary marker. */
  clickToMove?: boolean;
  /** Allow dragging the primary marker. */
  draggable?: boolean;
  /** Fired when the primary marker is moved by click or drag. */
  onPrimaryMove?: (lat: number, lng: number) => void;
  /** When set, fit map bounds to include all markers + zones. */
  fitToContent?: boolean;
  className?: string;
}

function makePinIcon(color: string, label?: string): L.DivIcon {
  const safeLabel = label ? String(label).slice(0, 2) : "";
  return L.divIcon({
    className: "location-map-pin",
    html: `
      <div style="
        width: 28px;
        height: 28px;
        border-radius: 9999px;
        background: ${color};
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        color: white;
        font-size: 11px;
        font-weight: 700;
        font-family: system-ui, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
      ">${safeLabel}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function ClickHandler({ enabled, onMove }: { enabled: boolean; onMove?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (!enabled || !onMove) return;
      onMove(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
    },
  });
  return null;
}

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

function FitToContent({ markers, zones }: { markers: MapMarker[]; zones: MapZoneCircle[] }) {
  const map = useMap();
  useEffect(() => {
    const points: L.LatLngTuple[] = [];
    markers.forEach((m) => points.push([m.lat, m.lng]));
    zones.forEach((z) => {
      const b = L.latLng(z.lat, z.lng).toBounds(z.radiusKm * 2000);
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      points.push([ne.lat, ne.lng], [sw.lat, sw.lng]);
    });
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14, { animate: false });
      return;
    }
    map.fitBounds(points, { padding: [24, 24] });
  }, [markers, zones, map]);
  return null;
}

export default function LocationMap({
  center,
  zoom = 13,
  height = 240,
  markers = [],
  zones = [],
  clickToMove = false,
  draggable = false,
  onPrimaryMove,
  fitToContent = false,
  className = "",
}: Props) {
  const primaryIdx = useMemo(() => markers.findIndex((m) => m.isPrimary), [markers]);

  return (
    <div className={`relative z-0 overflow-hidden ${className}`} style={{ height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {zones.map((z, i) => (
          <Circle
            key={`zone-${i}`}
            center={[z.lat, z.lng]}
            radius={z.radiusKm * 1000}
            pathOptions={{
              color: z.color,
              fillColor: z.color,
              fillOpacity: 0.1,
              weight: 2,
              dashArray: "5 4",
            }}
          />
        ))}

        {markers.map((m, i) => {
          const color = m.color ?? (m.isPrimary ? "#f97316" : "#3b82f6");
          const isDraggable = !!(draggable && m.isPrimary);
          return (
            <Marker
              key={`marker-${i}-${m.lat}-${m.lng}`}
              position={[m.lat, m.lng]}
              icon={makePinIcon(color, m.label)}
              draggable={isDraggable}
              eventHandlers={
                isDraggable
                  ? {
                      dragend: (e) => {
                        const p = (e.target as L.Marker).getLatLng();
                        onPrimaryMove?.(+p.lat.toFixed(6), +p.lng.toFixed(6));
                      },
                    }
                  : undefined
              }
            >
              {m.tooltip && (
                <Tooltip direction="top" offset={[0, -14]} opacity={0.95}>
                  {m.tooltip}
                </Tooltip>
              )}
            </Marker>
          );
        })}

        <ClickHandler enabled={clickToMove} onMove={onPrimaryMove} />
        {primaryIdx >= 0 && !fitToContent && (
          <Recenter lat={markers[primaryIdx].lat} lng={markers[primaryIdx].lng} />
        )}
        {fitToContent && <FitToContent markers={markers} zones={zones} />}
      </MapContainer>
    </div>
  );
}
