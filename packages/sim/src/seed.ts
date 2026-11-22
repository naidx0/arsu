// npm run seed — regenerate data/flights.seed.json.
// ~40 flights on real airport-pair great-circle routes. Deterministic-ish:
// fixed PRNG seed so demo runs look the same.

import fs from 'node:fs';
import path from 'node:path';
import { Flight, FlightStatus } from '@arsu/core';
import { AIRPORTS } from './airports.js';
import { bearing, slerp } from './geo.js';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CALLSIGNS = ['UAL', 'AAL', 'DAL', 'ASA', 'SWA', 'JBU', 'ACA', 'WJA', 'BAW', 'KLM'];

export function generateFlights(count = 40, rng = mulberry32(0xa851)): Flight[] {
  const flights: Flight[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    let from = AIRPORTS[Math.floor(rng() * AIRPORTS.length)];
    let to = AIRPORTS[Math.floor(rng() * AIRPORTS.length)];
    let guard = 0;
    while (from.code === to.code && guard++ < 10) {
      to = AIRPORTS[Math.floor(rng() * AIRPORTS.length)];
    }
    const callsign =
      CALLSIGNS[Math.floor(rng() * CALLSIGNS.length)] +
      (100 + Math.floor(rng() * 8900));
    if (used.has(callsign)) continue;
    used.add(callsign);

    const roll = rng();
    const status: FlightStatus =
      roll < 0.7 ? 'enroute' : roll < 0.85 ? 'scheduled' : 'boarding';
    const t = status === 'enroute' ? 0.05 + rng() * 0.85 : 0;
    flights.push({
      id: `fl-${i.toString().padStart(3, '0')}`,
      callsign,
      from,
      to,
      t,
      speed: 0.002 + rng() * 0.004, // ~3–8 min per leg in demo time
      status,
      position: slerp(from, to, t),
      heading: bearing(from, to),
    });
  }
  return flights;
}

const out = path.resolve('data/flights.seed.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
const flights = generateFlights();
fs.writeFileSync(out, JSON.stringify({ flights }, null, 2));
console.log(`seed: wrote ${flights.length} flights → ${out}`);
