import { Airport } from '@arsu/core';

const R = 6371; // km
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

type Vec = [number, number, number];

function toVec(lat: number, lon: number): Vec {
  const φ = toRad(lat);
  const λ = toRad(lon);
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

function toLatLon(v: Vec): { lat: number; lon: number } {
  const r = Math.hypot(v[0], v[1], v[2]);
  return {
    lat: toDeg(Math.asin(v[2] / r)),
    lon: toDeg(Math.atan2(v[1], v[0])),
  };
}

/** Great-circle position at fraction t ∈ [0,1] along the route. */
export function slerp(
  from: Airport,
  to: Airport,
  t: number,
): { lat: number; lon: number } {
  const a = toVec(from.lat, from.lon);
  const b = toVec(to.lat, to.lon);
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const Ω = Math.acos(dot);
  if (Ω < 1e-6) return { lat: from.lat, lon: from.lon };
  const s = Math.sin(Ω);
  const k0 = Math.sin((1 - t) * Ω) / s;
  const k1 = Math.sin(t * Ω) / s;
  return toLatLon([
    k0 * a[0] + k1 * b[0],
    k0 * a[1] + k1 * b[1],
    k0 * a[2] + k1 * b[2],
  ]);
}

/** Initial bearing from `from` toward `to`, degrees 0..360. */
export function bearing(from: Airport, to: Airport): number {
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lon - from.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function distanceKm(from: Airport, to: Airport): number {
  const a = toVec(from.lat, from.lon);
  const b = toVec(to.lat, to.lon);
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return R * Math.acos(dot);
}
