import { useEffect, useState } from "react";
import type { FlightsPayload, NodeDoc } from "@arsu/core";
import { routePoint } from "../geometry";

export type RegionId = "regional" | "northeast" | "west" | "atlantic" | "global";
export type AirspaceProps = {
  flights: FlightsPayload;
  nodes?: Map<string, NodeDoc>;
  selected?: string | null;
  onSelect?: (id: string) => void;
  onSelectNode?: (id: string) => void;
  region?: RegionId;
};
export const REGIONS = {
  regional: { lat: 39.5, lon: -94, radius: 1.52, zoom: 4 },
  northeast: { lat: 42, lon: -79.5, radius: 1.20, zoom: 6 },
  west: { lat: 38.5, lon: -116, radius: 1.26, zoom: 5 },
  atlantic: { lat: 46, lon: -38, radius: 1.85, zoom: 3 },
  global: { lat: 34, lon: -55, radius: 2.75, zoom: 2 },
};
export const SERVICE_HUBS = [
  { id: "unimatic", code: "KORD", city: "Chicago", label: "UNIMATIC CORE HUB", short: "Unimatic", lat: 41.9742, lon: -87.9073 },
  { id: "unimatic-standby", code: "KDEN", city: "Denver", label: "STANDBY REPLICA VAULT", short: "Standby", lat: 39.8561, lon: -104.6737 },
  { id: "dispatch", code: "KJFK", city: "New York", label: "DISPATCH RELEASE CTRL", short: "Dispatch", lat: 40.6413, lon: -73.7781 },
  { id: "weight-balance", code: "KATL", city: "Atlanta", label: "WEIGHT & BALANCE", short: "W&B", lat: 33.6407, lon: -84.4277 },
  { id: "crew-sched", code: "KDFW", city: "Dallas", label: "CREW SCHEDULING", short: "Crew", lat: 32.8998, lon: -97.0403 },
  { id: "pax-connect", code: "CYYZ", city: "Toronto", label: "PAX CONNECT GATEWAY", short: "Pax Connect", lat: 43.6777, lon: -79.6248 },
  { id: "notam", code: "KBOS", city: "Boston", label: "FAA NOTAM INGEST", short: "NOTAM", lat: 42.3656, lon: -71.0096 },
  { id: "ops-radar", code: "KSFO", city: "San Francisco", label: "OPS RADAR TELEMETRY", short: "Radar", lat: 37.6213, lon: -122.379 },
];
export const COMMS = [
  ["weight-balance", "unimatic"], ["crew-sched", "unimatic"],
  ["pax-connect", "unimatic"], ["ops-radar", "unimatic"],
  ["dispatch", "unimatic"], ["dispatch", "weight-balance"],
  ["dispatch", "crew-sched"], ["dispatch", "notam"],
  ["unimatic", "unimatic-standby"], ["unimatic-standby", "unimatic"],
].map(([from, to]) => ({ from: SERVICE_HUBS.find(h => h.id === from)!, to: SERVICE_HUBS.find(h => h.id === to)! }));
export const healthColor = (nodes: AirspaceProps["nodes"], id: string) => {
  const health = nodes?.get(id)?.health;
  return health === "down" ? "#f87171" : health === "degraded" ? "#fbbf24" : health === "up" ? "#ededed" : "#ff7a2f";
};

export const outlines = [
  [[-92, 46.7], [-90, 47], [-88, 48], [-85, 47.9], [-84.4, 46.5], [-87, 46.4], [-90, 46.6], [-92, 46.7]],
  [[-87, 45.8], [-86, 45.7], [-86, 43], [-87, 41.6], [-87.8, 42.5], [-87.8, 44.5], [-87, 45.8]],
  [[-84.7, 46], [-82.5, 46.2], [-80, 45.5], [-81.5, 44.5], [-82.4, 43], [-83.5, 44], [-84.7, 46]],
  [[-83.3, 41.7], [-81, 42.4], [-79, 42.8], [-80.5, 41.9], [-83.3, 41.7]],
  [[-79.8, 43.3], [-78, 43.8], [-76, 44.1], [-76.5, 43.5], [-79.8, 43.3]],
  [[-94, 59], [-91, 57], [-85, 55], [-80, 52], [-78, 56], [-76, 61], [-82, 63], [-90, 63], [-94, 59]],
  [[-123, 49], [-110, 49], [-100, 49], [-95, 49]],
  [
    [-168, 70], [-156, 71], [-145, 70], [-137, 69], [-130, 70],
    [-120, 72], [-110, 73], [-96, 74], [-85, 70], [-75, 68],
    [-66, 60], [-60, 58], [-56, 53], [-53, 48], [-57, 47],
    [-61, 50], [-65, 49], [-69, 47], [-66, 45], [-60, 46],
    [-64, 44], [-67, 45], [-70, 43], [-71, 42], [-70, 41.5],
    [-72, 41], [-74, 40.5], [-75, 39], [-76, 37], [-75, 35],
    [-78, 34], [-80, 32], [-81, 30], [-80, 27], [-80.5, 25],
    [-82, 25], [-82, 28], [-84, 30], [-86, 30], [-89, 29],
    [-90, 29], [-92, 30], [-95, 29], [-97, 26], [-97, 22],
    [-95, 19], [-91, 18], [-90, 21], [-87, 21], [-86, 18],
    [-84, 16], [-83, 15], [-84, 11], [-80, 9], [-78, 9],
    [-82, 8], [-85, 10], [-87, 13], [-91, 15], [-96, 16],
    [-102, 18], [-106, 23], [-109, 25], [-112, 29], [-114, 31],
    [-111, 25], [-110, 23], [-112, 24], [-115, 28], [-117, 32],
    [-120, 34], [-122, 37], [-124, 40], [-124, 43], [-124, 46],
    [-123, 48], [-125, 49], [-128, 52], [-130, 55], [-135, 58],
    [-139, 60], [-145, 60], [-151, 59], [-154, 57], [-160, 55],
    [-165, 54], [-159, 58], [-164, 61], [-166, 64], [-168, 66],
    [-164, 67], [-168, 70],
  ],
  [
    [-81, 12],
    [-70, 10],
    [-59, 6],
    [-48, -2],
    [-35, -8],
    [-43, -23],
    [-54, -35],
    [-68, -55],
    [-74, -43],
    [-77, -20],
    [-81, 0],
    [-81, 12],
  ],
  [
    [-53, 60],
    [-44, 60],
    [-20, 76],
    [-40, 83],
    [-58, 76],
    [-53, 60],
  ],
  [
    [-10, 36],
    [-9, 44],
    [-1, 49],
    [6, 54],
    [5, 59],
    [20, 71],
    [32, 70],
    [28, 60],
    [42, 55],
    [50, 50],
    [38, 42],
    [29, 40],
    [22, 36],
    [14, 40],
    [-10, 36],
  ],
  [
    [-17, 35],
    [10, 37],
    [32, 31],
    [43, 12],
    [51, 11],
    [41, -12],
    [31, -30],
    [18, -35],
    [10, -20],
    [1, 4],
    [-16, 15],
    [-17, 35],
  ],
  [
    [30, 70],
    [65, 73],
    [110, 73],
    [150, 60],
    [170, 63],
    [180, 50],
    [142, 44],
    [130, 34],
    [120, 20],
    [106, 10],
    [97, 6],
    [78, 8],
    [69, 24],
    [49, 30],
    [35, 42],
  ],
];

export default function MissionGlobe({
  flights,
  selected,
  onSelect,
  nodes,
  onSelectNode,
  region = "regional",
}: AirspaceProps) {
  const [rotation, setRotation] = useState(REGIONS[region].lon);
  const [zoom, setZoom] = useState(1.5);
  const [comms, setComms] = useState(true);
  const [landmarks, setLandmarks] = useState(true);
  const reset = () => { setRotation(REGIONS[region].lon); setZoom(region === "global" ? 1 : region === "northeast" || region === "west" ? 2.5 : 1.5); };
  useEffect(reset, [region]);
  const project = (lon: number, lat: number) => {
    const p = (lat * Math.PI) / 180;
    const l = ((lon - rotation) * Math.PI) / 180;
    const tilt = (REGIONS[region].lat * Math.PI) / 180;
    const z =
      Math.cos(tilt) * Math.cos(p) * Math.cos(l) + Math.sin(tilt) * Math.sin(p);
    return {
      x: 500 + 310 * zoom * Math.cos(p) * Math.sin(l),
      y:
        340 -
        310 *
          zoom *
          (Math.cos(tilt) * Math.sin(p) -
            Math.sin(tilt) * Math.cos(p) * Math.cos(l)),
      z,
    };
  };
  const path = (coords: number[][]) => {
    let visible = false;
    return coords
      .map(([lon, lat]) => {
        const p = project(lon, lat);
        if (p.z < 0) {
          visible = false;
          return "";
        }
        const d = `${visible ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        visible = true;
        return d;
      })
      .join(" ");
  };
  const airports = new Map(
    flights.flights.flatMap((f) => [
      [f.from.code, f.from] as const,
      [f.to.code, f.to] as const,
    ]),
  );
  return (
    <div className="globe-scene">
      <svg
        viewBox="0 0 1000 700"
        role="img"
        aria-label="Interactive orthographic aviation globe with simulated flight routes"
      >
        <defs>
          <radialGradient id="earth">
            <stop offset="0" stopColor="#183342" />
            <stop offset=".72" stopColor="#0c1b28" />
            <stop offset="1" stopColor="#030910" />
          </radialGradient>
          <radialGradient id="halo">
            <stop offset=".86" stopColor="#316a86" stopOpacity="0" />
            <stop offset=".94" stopColor="#518ba8" stopOpacity=".16" />
            <stop offset="1" stopColor="#518ba8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="500" cy="340" r={335 * zoom} fill="url(#halo)" />
        <circle
          cx="500"
          cy="340"
          r={310 * zoom}
          fill="url(#earth)"
          stroke="#456778"
          strokeWidth=".7"
        />
        <g fill="none" stroke="#426073" strokeWidth=".5" opacity=".35">
          {Array.from({ length: 12 }, (_, i) => (
            <path
              key={`lat${i}`}
              d={path(
                Array.from({ length: 181 }, (_, j) => [
                  j * 2 - 180,
                  i * 15 - 75,
                ]),
              )}
            />
          ))}
          {Array.from({ length: 24 }, (_, i) => (
            <path
              key={`lon${i}`}
              d={path(
                Array.from({ length: 91 }, (_, j) => [
                  i * 15 - 180,
                  j * 2 - 90,
                ]),
              )}
            />
          ))}
        </g>
        <g fill="none" stroke="#66818a" strokeWidth="1.1" opacity=".65">
          {outlines.map((c, i) => (
            <path key={i} d={path(c)} />
          ))}
        </g>
        <g
          fill="none"
          stroke={flights.groundStop ? "#f17966" : "#a9c9d7"}
          strokeWidth=".7"
          opacity=".23"
        >
          {flights.flights.map((f) => (
            <path
              key={f.id}
              d={path(
                Array.from({ length: 41 }, (_, i) =>
                  routePoint(f.from, f.to, i / 40),
                ),
              )}
            />
          ))}
        </g>
        {comms && COMMS.map(({ from, to }) => <path key={`${from.id}-${to.id}`} d={path(Array.from({ length: 65 }, (_, i) => routePoint(from, to, i / 64)))} fill="none" stroke={healthColor(nodes, to.id)} strokeWidth="1.5" strokeDasharray={nodes?.get(to.id)?.health === "down" ? "5 5" : undefined} style={{ filter: "drop-shadow(0 0 3px #38bdf866)" }} />)}
        {landmarks && SERVICE_HUBS.map((hub) => {
          const p = project(hub.lon, hub.lat);
          return p.z > 0 ? <g key={hub.id} role="button" tabIndex={0} aria-label={`${hub.city}: ${hub.label}`} onClick={() => onSelectNode?.(hub.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectNode?.(hub.id); } }} style={{ cursor: "pointer" }}>
            <circle cx={p.x} cy={p.y} r="5" fill="#06131e" stroke={healthColor(nodes, hub.id)} strokeWidth="2" />
            <text x={p.x + 9} y={p.y + 12} fill={healthColor(nodes, hub.id)} fontSize="9" paintOrder="stroke" stroke="#06131e" strokeWidth="3">{hub.code} · {hub.short}</text>
            <title>{hub.city} · {hub.label}</title>
          </g> : null;
        })}
        {landmarks && [...airports.values()].filter(a => !SERVICE_HUBS.some(h => h.code === a.code)).map((a) => {
          const p = project(a.lon, a.lat);
          return p.z > 0 ? (
            <g key={a.code}>
              <circle cx={p.x} cy={p.y} r="2" fill="#e1edf2" />
              <text x={p.x + 6} y={p.y - 5} fill="#97aeb9" fontSize="8">
                {a.code}
              </text>
            </g>
          ) : null;
        })}
        {flights.flights.map((f) => {
          const p = project(f.position.lon, f.position.lat);
          return p.z > 0 ? (
            <g
              key={f.id}
              tabIndex={0}
              role="button"
              aria-label={`Inspect ${f.callsign}`}
              onClick={() => onSelect?.(f.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect?.(f.id);
              }}
              className="flight-target"
            >
              <circle cx={p.x} cy={p.y} r="12" fill="transparent" />
              <path
                d="M0,-4 L3,4 L0,2 L-3,4 Z"
                transform={`translate(${p.x} ${p.y}) rotate(${f.heading})`}
                fill={flights.groundStop ? "#f17966" : "#e7f3fb"}
              />
              {selected === f.id && (
                <circle cx={p.x} cy={p.y} r="10" fill="none" stroke="white" />
              )}
            </g>
          ) : null;
        })}
      </svg>
      <div className="globe-controls">
        <button onClick={reset}>RECENTER</button>
        <button aria-pressed={comms} onClick={() => setComms(v => !v)}>COMMS LINKS</button>
        <button aria-pressed={landmarks} onClick={() => setLandmarks(v => !v)}>LANDMARKS</button>
        <button
          onClick={() => setRotation((r) => r - 20)}
          aria-label="Rotate globe west"
        >
          ←
        </button>
        <span>ORBIT VIEW</span>
        <button
          onClick={() => setRotation((r) => r + 20)}
          aria-label="Rotate globe east"
        >
          →
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(12, z * 1.15))}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.7, z / 1.15))}
          aria-label="Zoom out"
        >
          −
        </button>
      </div>
    </div>
  );
}
