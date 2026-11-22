// packages/sim — the airline-ops estate ARSU protects.
// Modeled on real outage post-mortems (SPEC §2, ARCH §1). One SimEngine
// holds the truth: intrinsic service state, cut edges, corruption,
// standby activation, and the flight ticker. Effective health is always
// computed — cascades are the whole point.

import fs from 'node:fs';
import {
  ActionRequest,
  Airport,
  ChaosRequest,
  Flight,
  FlightsPayload,
  Health,
  NodeKind,
  ServiceInfo,
  ServiceState,
} from '@arsu/core';
import { bearing, slerp } from './geo.js';

export interface ServiceRec extends ServiceInfo {
  state: ServiceState;
  activeDeps: string[]; // current truth — cut_dep removes from here
  corrupted: boolean;
  standbyActive: boolean; // this replica is live for a failed primary
  viaStandby: boolean; // this primary is being served by its standby
  latencyMs: number;
}

const BASE_LATENCY = 12;
const DEGRADED_LATENCY = 1500; // must exceed the 800ms latency_lt budget

const SERVICE_DEFS: ServiceInfo[] = [
  {
    id: 'unimatic',
    name: 'Unimatic',
    kind: 'hub',
    deps: [],
    description:
      'Central flight-information hub — schedule, weight inputs, crew data. The SPOF.',
    standby: 'unimatic-standby',
  },
  {
    id: 'unimatic-standby',
    name: 'Unimatic Standby',
    kind: 'store',
    deps: [],
    description: 'Cold replica of Unimatic — failover target.',
  },
  {
    id: 'weight-balance',
    name: 'Weight & Balance',
    kind: 'worker',
    deps: ['unimatic'],
    description: 'Load and CG calculations for every release.',
  },
  {
    id: 'crew-sched',
    name: 'Crew Scheduling',
    kind: 'worker',
    deps: ['unimatic'],
    description: 'Crew legality and assignment engine.',
  },
  {
    id: 'pax-connect',
    name: 'Pax Connect',
    kind: 'worker',
    deps: ['unimatic'],
    description: 'Bookings, check-in, rebooking.',
  },
  {
    id: 'dispatch',
    name: 'Dispatch',
    kind: 'worker',
    deps: ['unimatic', 'weight-balance', 'crew-sched', 'notam'],
    description: 'Release authority — a down dispatch is a ground stop.',
  },
  {
    id: 'notam',
    name: 'NOTAM Feed',
    kind: 'feed',
    deps: [],
    description: 'FAA notice-to-airmen ingest.',
  },
  {
    id: 'ops-radar',
    name: 'Ops Radar',
    kind: 'feed',
    deps: ['unimatic'],
    description: 'Position feed for the live ops map.',
  },
];

export class SimError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

export class SimEngine {
  private services = new Map<string, ServiceRec>();
  private flights: Flight[] = [];
  private rev = 1000;
  private seedFile: string;
  /** per-flight dwell countdowns (ms) for status transitions */
  private dwell = new Map<string, number>();

  constructor(seedFile = 'data/flights.seed.json') {
    this.seedFile = seedFile;
    for (const def of SERVICE_DEFS) {
      this.services.set(def.id, {
        ...def,
        state: 'up',
        activeDeps: [...def.deps],
        corrupted: false,
        standbyActive: false,
        viaStandby: false,
        latencyMs: BASE_LATENCY,
      });
    }
    this.loadFlights();
  }

  // ---- services ----

  registry(): ServiceInfo[] {
    return [...this.services.values()].map(
      ({ id, name, kind, deps, description, standby }) => ({
        id,
        name,
        kind,
        deps,
        description,
        standby,
      }),
    );
  }

  private svc(id: string): ServiceRec {
    const s = this.services.get(id);
    if (!s) throw new SimError(404, `unknown service '${id}'`);
    return s;
  }

  /** Effective health — recursive through *current* required deps. */
  effective(id: string, seen = new Set<string>()): Health {
    if (seen.has(id)) return 'up'; // dep cycle — don't recurse forever
    seen.add(id);
    const s = this.services.get(id);
    if (!s) return 'down';
    let h: Health = s.state;
    for (const dep of s.activeDeps) {
      const dh = this.effective(dep, seen);
      if (dh === 'down') h = 'down';
      else if (dh === 'degraded' && h !== 'down') h = 'degraded';
    }
    return h;
  }

  health(id: string) {
    const s = this.svc(id);
    const deps: Record<string, Health> = {};
    for (const d of s.activeDeps) deps[d] = this.effective(d);
    return {
      id: s.id,
      state: s.state,
      effective: this.effective(id),
      deps,
      latencyMs: s.latencyMs,
      standbyActive: s.standbyActive || undefined,
      viaStandby: s.viaStandby || undefined,
      corrupted: s.corrupted || undefined,
    };
  }

  latency(id: string): number {
    return this.svc(id).latencyMs;
  }

  /** Business payload — 503 handled by the route when effective≠up. */
  op(id: string): Record<string, unknown> {
    const s = this.svc(id);
    if (s.corrupted) {
      return { id: s.id, error: 'corrupt payload', blob: '0xDEADBEEF'.repeat(4) };
    }
    const base = { id: s.id, rev: this.rev, ts: Date.now() };
    switch (id) {
      case 'unimatic':
        return {
          ...base,
          flightsTracked: this.flights.length,
          hubRev: this.rev,
          via: s.viaStandby ? s.standby : 'primary',
        };
      case 'unimatic-standby':
        return { ...base, mode: s.standbyActive ? 'active' : 'cold' };
      case 'weight-balance':
        return {
          ...base,
          lastCalc: { flight: 'ASA1147', mac: 24.6, ok: true },
          queueDepth: s.state === 'degraded' ? 14 : 2,
        };
      case 'dispatch':
        return {
          ...base,
          releases: this.flights.filter((f) => f.status === 'enroute').length,
          groundStop: this.groundStop(),
        };
      case 'crew-sched':
        return { ...base, crewsOnDuty: 312, legalityViolations: 0 };
      case 'pax-connect':
        return { ...base, checkedIn: 8411, rebookQueue: 0 };
      case 'notam':
        return {
          ...base,
          notices: [
            { id: 'A0112/26', scope: 'KJFK RWY 4L CLSD' },
            { id: 'A0113/26', scope: 'CYYZ DEICE OPS' },
          ],
        };
      case 'ops-radar':
        return {
          ...base,
          contacts: this.flights.filter((f) => f.status === 'enroute').length,
          unimaticRev: this.services.get('unimatic')!.corrupted
            ? -1
            : this.rev,
        };
      default:
        return base;
    }
  }

  // ---- chaos plane (operator only) ----

  chaos(req: ChaosRequest): Record<string, unknown> {
    const s = this.svc(req.target);
    switch (req.type) {
      case 'kill':
        s.state = 'down';
        break;
      case 'degrade':
        s.state = 'degraded';
        s.latencyMs = DEGRADED_LATENCY;
        break;
      case 'cut_dep': {
        if (!req.dep) throw new SimError(400, 'cut_dep requires dep');
        this.svc(req.dep);
        const i = s.activeDeps.indexOf(req.dep);
        if (i === -1)
          throw new SimError(409, `${req.target} has no active dep ${req.dep}`);
        s.activeDeps.splice(i, 1);
        break;
      }
      case 'corrupt':
        s.corrupted = true;
        break;
      default:
        throw new SimError(400, `unknown chaos type ${req.type}`);
    }
    return { ok: true, target: s.id, effective: this.effective(s.id) };
  }

  // ---- action plane (agents only) ----

  act(req: ActionRequest): Record<string, unknown> {
    const s = this.svc(req.target);
    switch (req.type) {
      case 'restart':
        s.state = 'up';
        s.latencyMs = BASE_LATENCY;
        s.corrupted = false;
        s.viaStandby = false;
        break;
      case 'failover': {
        if (!s.standby)
          throw new SimError(409, `${s.id} has no standby`);
        const replica = this.svc(s.standby);
        replica.standbyActive = true;
        replica.state = 'up';
        s.state = 'up';
        s.viaStandby = true;
        break;
      }
      case 'reroute': {
        const wantDep = req.params?.dep as string | undefined;
        const missing = s.deps.filter((d) => !s.activeDeps.includes(d));
        if (missing.length === 0)
          throw new SimError(409, `${s.id} has no severed deps`);
        for (const dep of missing) {
          if (wantDep && dep !== wantDep) continue;
          const depSvc = this.svc(dep);
          // repoint to the dep's standby when one exists, else reconnect
          s.activeDeps.push(depSvc.standby ?? dep);
        }
        break;
      }
      case 'repair':
        s.corrupted = false;
        break;
      default:
        throw new SimError(400, `unknown action type ${req.type}`);
    }
    return { ok: true, target: s.id, effective: this.effective(s.id) };
  }

  reset(): void {
    for (const s of this.services.values()) {
      s.state = 'up';
      s.activeDeps = [...s.deps];
      s.corrupted = false;
      s.standbyActive = false;
      s.viaStandby = false;
      s.latencyMs = BASE_LATENCY;
    }
    this.rev++;
    this.loadFlights();
  }

  // ---- flights ----

  private loadFlights(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.seedFile, 'utf8')) as {
        flights: Flight[];
      };
      this.flights = raw.flights;
    } catch {
      this.flights = [];
    }
    this.dwell.clear();
    for (const f of this.flights) {
      f.position = slerp(f.from, f.to, f.t);
      f.heading = bearing(f.from, f.to);
      this.dwell.set(f.id, 8_000 + Math.random() * 20_000);
    }
  }

  groundStop(): boolean {
    return this.effective('dispatch') !== 'up';
  }

  staleFeed(): boolean {
    return this.effective('ops-radar') !== 'up';
  }

  tick(dtMs: number): FlightsPayload {
    const dt = dtMs / 1000;
    const groundStop = this.groundStop();
    const stale = this.staleFeed();
    for (const f of this.flights) {
      const left = (this.dwell.get(f.id) ?? 0) - dtMs;
      this.dwell.set(f.id, left);
      switch (f.status) {
        case 'enroute':
          f.t = Math.min(1, f.t + f.speed * dt);
          if (f.t >= 1) {
            f.status = 'arrived';
            this.dwell.set(f.id, 15_000);
          }
          break;
        case 'departed':
          if (!groundStop) f.status = 'enroute';
          break;
        case 'boarding':
          if (left <= 0 && !groundStop) {
            f.status = 'departed';
            this.dwell.set(f.id, 4_000);
          }
          break;
        case 'scheduled':
          if (left <= 0) {
            f.status = 'boarding';
            this.dwell.set(f.id, 12_000);
          }
          break;
        case 'arrived':
          if (left <= 0) {
            // turn around — fly the return leg
            const tmp = f.from;
            f.from = f.to;
            f.to = tmp;
            f.t = 0;
            f.status = 'scheduled';
            this.dwell.set(f.id, 10_000 + Math.random() * 25_000);
          }
          break;
      }
      if (!stale) {
        f.position = slerp(f.from, f.to, f.t);
        f.heading = bearing(f.from, f.to);
      }
    }
    return { flights: this.flights, groundStop, staleFeed: stale };
  }

  flightsPayload(): FlightsPayload {
    return {
      flights: this.flights,
      groundStop: this.groundStop(),
      staleFeed: this.staleFeed(),
    };
  }

  airports(): Airport[] {
    const set = new Map<string, Airport>();
    for (const f of this.flights) {
      set.set(f.from.code, f.from);
      set.set(f.to.code, f.to);
    }
    return [...set.values()];
  }
}
