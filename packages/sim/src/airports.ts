import { Airport } from '@arsu/core';

// Real airport coords — seed flights fly real great-circle routes.
export const AIRPORTS: Airport[] = [
  { code: 'CYYZ', name: 'Toronto Pearson', lat: 43.6777, lon: -79.6248 },
  { code: 'CYVR', name: 'Vancouver Intl', lat: 49.1939, lon: -123.1844 },
  { code: 'CYUL', name: 'Montreal Trudeau', lat: 45.4706, lon: -73.7408 },
  { code: 'CYYC', name: 'Calgary Intl', lat: 51.1315, lon: -113.9987 },
  { code: 'CYOW', name: 'Ottawa Intl', lat: 45.3225, lon: -75.6692 },
  { code: 'KJFK', name: 'New York JFK', lat: 40.6413, lon: -73.7781 },
  { code: 'KEWR', name: 'Newark Liberty', lat: 40.6895, lon: -74.1745 },
  { code: 'KBOS', name: 'Boston Logan', lat: 42.3656, lon: -71.0096 },
  { code: 'KORD', name: "Chicago O'Hare", lat: 41.9742, lon: -87.9073 },
  { code: 'KATL', name: 'Atlanta Hartsfield', lat: 33.6407, lon: -84.4277 },
  { code: 'KDEN', name: 'Denver Intl', lat: 39.8561, lon: -104.6737 },
  { code: 'KDFW', name: 'Dallas/Fort Worth', lat: 32.8998, lon: -97.0403 },
  { code: 'KIAH', name: 'Houston Bush', lat: 29.9902, lon: -95.3368 },
  { code: 'KMIA', name: 'Miami Intl', lat: 25.7959, lon: -80.287 },
  { code: 'KLAX', name: 'Los Angeles Intl', lat: 33.9416, lon: -118.4085 },
  { code: 'KSFO', name: 'San Francisco Intl', lat: 37.6213, lon: -122.379 },
  { code: 'KSEA', name: 'Seattle-Tacoma', lat: 47.4502, lon: -122.3088 },
  { code: 'KPHX', name: 'Phoenix Sky Harbor', lat: 33.4373, lon: -112.0078 },
  { code: 'KLAS', name: 'Las Vegas Harry Reid', lat: 36.084, lon: -115.1537 },
  { code: 'KMCO', name: 'Orlando Intl', lat: 28.4312, lon: -81.3081 },
  { code: 'EGLL', name: 'London Heathrow', lat: 51.47, lon: -0.4543 },
  { code: 'EHAM', name: 'Amsterdam Schiphol', lat: 52.3105, lon: 4.7683 },
  { code: 'LFPG', name: 'Paris Charles de Gaulle', lat: 49.0097, lon: 2.5479 },
  { code: 'EDDF', name: 'Frankfurt am Main', lat: 50.0379, lon: 8.5622 },
];

export function airportByCode(code: string): Airport {
  const a = AIRPORTS.find((x) => x.code === code);
  if (!a) throw new Error(`unknown airport ${code}`);
  return a;
}
