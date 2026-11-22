// MAP — the "whoa" surface. Dark-tiled leaflet: flights on real
// great-circle routes, airport dots, service health badges, ground-stop
// and stale-feed banners.

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { routePoint } from "../geometry";
import { COMMS, REGIONS, SERVICE_HUBS, healthColor, outlines, type AirspaceProps } from "./MissionGlobe";
export type { AirspaceProps, RegionId } from "./MissionGlobe";

function planeIcon(heading: number, cls: string): L.DivIcon {
  return L.divIcon({ className: "", html: `<div class="plane ${cls}" style="transform: rotate(${Math.round(heading - 45)}deg)">✈</div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

function RadarControls({ region = "regional", comms, toggle }: { region: AirspaceProps["region"]; comms: boolean; toggle: () => void }) {
  const map = useMap();
  const reset = () => { const home = REGIONS[region]; map.setView([home.lat, home.lon], home.zoom, { animate: true }); };
  useEffect(reset, [region, map]);
  return <div className="globe-controls map-radar-controls" style={{ position: "absolute", top: 16, right: 16, bottom: "auto", left: "auto", zIndex: 1000 }} ref={el => { if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); } }}>
    <button onClick={reset}>RECENTER</button>
    <button aria-label="Zoom in" onClick={() => map.zoomIn()}>+</button>
    <button aria-label="Zoom out" onClick={() => map.zoomOut()}>−</button>
    <button aria-pressed={comms} onClick={toggle}>COMMS OVERLAY</button>
  </div>;
}

export default function OpsMap({ flights, nodes, selected, onSelect, onSelectNode, region = "regional" }: AirspaceProps) {
  const [comms, setComms] = useState(true);
  const [tileFailed, setTileFailed] = useState(false);
  const airports = useMemo(() => [...new Map(flights.flights.flatMap(f => [[f.from.code, f.from] as const, [f.to.code, f.to] as const])).values()], [flights.flights]);
  const home = REGIONS[region];
  return <div className="map-wrap" style={{ position: "relative", background: "#061019" }}>
    {flights.groundStop && <div className="map-banner stop">GROUND STOP</div>}
    {!flights.groundStop && flights.staleFeed && <div className="map-banner stale">FEED STALE — OPS-RADAR DOWN</div>}
    <MapContainer center={[home.lat, home.lon]} zoom={home.zoom} minZoom={2} maxZoom={18} style={{ height: "100%", background: "#061019" }} zoomControl={false} attributionControl={false} zoomSnap={0.25} wheelPxPerZoomLevel={90}>
      {Array.from({ length: 23 }, (_, i) => <Polyline key={`lon${i}`} positions={[[-80, -165 + i * 15], [80, -165 + i * 15]]} pathOptions={{ color: "#244250", weight: 0.5, opacity: 0.4 }} />)}
      {Array.from({ length: 11 }, (_, i) => <Polyline key={`lat${i}`} positions={[[-75 + i * 15, -180], [-75 + i * 15, 180]]} pathOptions={{ color: "#244250", weight: 0.5, opacity: 0.4 }} />)}
      {outlines.map((line, i) => <Polyline key={`coast${i}`} positions={line.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={{ color: "#537e91", weight: 1.25, opacity: 0.8 }} />)}
      {!tileFailed && <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" maxZoom={18} minZoom={2} eventHandlers={{ tileerror: () => setTileFailed(true) }} />}
      <RadarControls region={region} comms={comms} toggle={() => setComms(v => !v)} />
      {flights.flights.filter(f => f.status !== "arrived").map(f => <Polyline key={`route${f.id}`} positions={Array.from({ length: 65 }, (_, i) => { const [lon, lat] = routePoint(f.from, f.to, i / 64); return [lat, lon] as [number, number]; })} pathOptions={{ color: selected === f.id ? "#e7f3fb" : "#5d92ac", weight: selected === f.id ? 2 : 1, opacity: 0.45 }} />)}
      {comms && COMMS.map(({ from, to }) => <Polyline key={`${from.id}-${to.id}`} positions={Array.from({ length: 65 }, (_, i) => { const [lon, lat] = routePoint(from, to, i / 64); return [lat, lon] as [number, number]; })} pathOptions={{ color: healthColor(nodes, to.id), weight: 2, opacity: 0.85, dashArray: nodes?.get(to.id)?.health === "down" ? "6 7" : undefined }} />)}
      {airports.filter(a => !SERVICE_HUBS.some(h => h.code === a.code)).map(a => <CircleMarker key={a.code} center={[a.lat, a.lon]} radius={3} pathOptions={{ color: "#38bdf8", weight: 1, fillOpacity: 0.5 }}><Tooltip permanent direction="right" className="ap">{a.code}</Tooltip></CircleMarker>)}
      {SERVICE_HUBS.map(h => <CircleMarker key={h.id} center={[h.lat, h.lon]} radius={6} pathOptions={{ color: healthColor(nodes, h.id), fillColor: "#061019", fillOpacity: 1, weight: 2 }} eventHandlers={{ click: () => onSelectNode?.(h.id) }}><Tooltip permanent direction={h.id === "notam" || h.id === "dispatch" ? "right" : "left"} className="ap"><strong>{h.code} · {h.short}</strong><br />{h.city} · {nodes?.get(h.id)?.health ?? "undiscovered"}</Tooltip></CircleMarker>)}
      {flights.flights.map(f => <Marker key={f.id} position={[f.position.lat, f.position.lon]} eventHandlers={{ click: () => onSelect?.(f.id) }} icon={planeIcon(f.heading, f.status === "enroute" ? "enroute" : flights.groundStop ? "held" : "ground")}><Tooltip className="ap" permanent={selected === f.id}>{f.callsign} · {f.from.code}→{f.to.code} · {f.status}</Tooltip></Marker>)}
    </MapContainer>
    <span className="earth-credit" style={{ zIndex: 1000 }}>SIMULATED TRAFFIC · {tileFailed ? "OFFLINE VECTOR RADAR" : "© CARTO · © OpenStreetMap contributors"}</span>
  </div>;
}
