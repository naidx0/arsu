// MAP — the "whoa" surface. Dark-tiled leaflet: flights on real
// great-circle routes, airport dots, service health badges, ground-stop
// and stale-feed banners.

import { useMemo } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';
import type { Airport, FlightsPayload, Health, NodeDoc } from '@arsu/core';

function planeIcon(heading: number, cls: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="plane ${cls}" style="transform: rotate(${Math.round(heading - 45)}deg)">✈</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function flightCls(status: string, groundStop: boolean): string {
  if (status === 'enroute') return 'enroute';
  if (status === 'arrived') return 'arrived';
  if (groundStop && (status === 'departed' || status === 'boarding')) return 'held';
  return 'ground';
}

export default function OpsMap({
  flights,
  nodes,
}: {
  flights: FlightsPayload;
  nodes: Map<string, NodeDoc>;
}) {
  const airports = useMemo(() => {
    const m = new Map<string, Airport>();
    for (const f of flights.flights) {
      m.set(f.from.code, f.from);
      m.set(f.to.code, f.to);
    }
    return [...m.values()];
  }, [flights.flights]);

  const svcNodes = [...nodes.values()].filter((n) => n.kind !== 'store' || n.id.includes('standby'));
  const healthOf = (id: string): Health => nodes.get(id)?.health ?? 'down';

  return (
    <div className="map-wrap">
      <div className="svc-badges">
        {svcNodes.length === 0 && (
          <span className="svc-badge degraded">awaiting recon — launch the swarm</span>
        )}
        {svcNodes.map((n) => (
          <span key={n.id} className={`svc-badge ${healthOf(n.id)}`}>
            {n.id}
          </span>
        ))}
      </div>
      {flights.groundStop && <div className="map-banner stop">GROUND STOP</div>}
      {!flights.groundStop && flights.staleFeed && (
        <div className="map-banner stale">FEED STALE — OPS-RADAR DOWN</div>
      )}
      <MapContainer
        center={[46, -60]}
        zoom={3}
        minZoom={2}
        style={{ height: '100%' }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        {airports.map((a) => (
          <CircleMarker
            key={a.code}
            center={[a.lat, a.lon]}
            radius={3}
            pathOptions={{ color: '#41d9ff', weight: 1, fillOpacity: 0.5 }}
          >
            <Tooltip className="ap">{a.code} — {a.name}</Tooltip>
          </CircleMarker>
        ))}
        {flights.flights.map((f) => (
          <Marker
            key={f.id}
            position={[f.position.lat, f.position.lon]}
            icon={planeIcon(f.heading, flightCls(f.status, flights.groundStop))}
          >
            <Tooltip className="ap">
              {f.callsign} · {f.from.code}→{f.to.code} · {f.status}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
