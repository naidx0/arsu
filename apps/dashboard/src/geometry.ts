export function routePoint(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  t: number,
): [number, number] {
  const rad = Math.PI / 180;
  const a = [
    Math.cos(from.lat * rad) * Math.cos(from.lon * rad),
    Math.cos(from.lat * rad) * Math.sin(from.lon * rad),
    Math.sin(from.lat * rad),
  ];
  const b = [
    Math.cos(to.lat * rad) * Math.cos(to.lon * rad),
    Math.cos(to.lat * rad) * Math.sin(to.lon * rad),
    Math.sin(to.lat * rad),
  ];
  const angle = Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        a.reduce((sum, v, i) => sum + v * b[i], 0),
      ),
    ),
  );
  if (angle < 1e-6) return [from.lon, from.lat];
  const k0 = Math.sin((1 - t) * angle) / Math.sin(angle),
    k1 = Math.sin(t * angle) / Math.sin(angle);
  const [x, y, z] = a.map((v, i) => v * k0 + b[i] * k1);
  return [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad];
}
