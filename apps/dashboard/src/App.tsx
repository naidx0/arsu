import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity01Icon,
  AiNetworkIcon,
  Airplane01Icon,
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  DashboardSquare01Icon,
  Database01Icon,
  FlashIcon,
  Globe02Icon,
  Layers01Icon,
  Location01Icon,
  PlayIcon,
  Radar01Icon,
  RefreshIcon,
  Satellite01Icon,
  Search01Icon,
  Shield01Icon,
  Unlink01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import type {
  AgentDoc,
  AgentRole,
  AgentState,
  EventDoc,
  FlightsPayload,
  Health,
  InvariantDoc,
  InvariantKind,
  MissionState,
  NodeDoc,
  Severity,
  TaskDoc,
  ViolationDoc,
} from "@arsu/core";
import { post, useBoard, type Board } from "./api";
import MissionGlobe, { type RegionId } from "./components/MissionGlobe";
import OpsMap from "./components/OpsMap";
import OperationalSummary from "./components/OperationalSummary";
import PipelineWalkthrough from "./components/PipelineWalkthrough";
import RehearsalConsole from "./components/RehearsalConsole";
import { missionCondition, missionStage } from "./mission-state";
import { routePoint } from "./geometry";
import { showcaseBoard } from "./showcase";
import "./mission.css";

// ---------------------------------------------------------------------------
// Map adapters. The map components live in their own lane and evolve
// independently; this is the single contract App relies on for all three.
// ---------------------------------------------------------------------------
type AirspaceViewProps = {
  flights: FlightsPayload;
  nodes: Map<string, NodeDoc>;
  selected: string | null;
  region: RegionId;
  onSelect: (id: string) => void;
  onSelectNode: (id: string) => void;
};
const AviationGlobe = lazy(
  () => import("./components/AviationGlobe"),
) as unknown as ComponentType<AirspaceViewProps>;
const RadarMap = OpsMap as unknown as ComponentType<AirspaceViewProps>;
const GlobeFallback = MissionGlobe as unknown as ComponentType<AirspaceViewProps>;

type Icon = typeof Shield01Icon;

// ---------------------------------------------------------------------------
// Static vocabulary
// ---------------------------------------------------------------------------
const navigation = [
  { id: "Mission Control", icon: DashboardSquare01Icon },
  { id: "Airspace", icon: Globe02Icon },
  { id: "Topology", icon: WorkflowSquare01Icon },
  { id: "Verification", icon: Shield01Icon },
  { id: "Swarm", icon: AiNetworkIcon },
  { id: "Pipeline", icon: PlayIcon },
  { id: "Blackboard", icon: Database01Icon },
] as const;
type View = (typeof navigation)[number]["id"];

const STAGES = [
  "DISCOVERY",
  "ONTOLOGY",
  "VERIFICATION",
  "MONITORING",
  "RESPONDING",
  "RESTORED",
];

const SYSTEMS: Record<
  string,
  { code: string; city: string; role: string; fn: string }
> = {
  unimatic: {
    code: "KORD",
    city: "Chicago",
    role: "CORE HUB",
    fn: "Single source of truth for flight plans, tails and schedule revisions.",
  },
  "unimatic-standby": {
    code: "KDEN",
    city: "Denver",
    role: "REPLICA",
    fn: "Warm standby replica — promoted to primary by hub-failover.",
  },
  dispatch: {
    code: "KJFK",
    city: "New York",
    role: "RELEASE AUTH",
    fn: "Issues flight releases; needs hub, load sheet, crew legality and NOTAMs.",
  },
  "weight-balance": {
    code: "KATL",
    city: "Atlanta",
    role: "LOAD CTRL",
    fn: "Computes load sheets, centre of gravity and take-off weights.",
  },
  "crew-sched": {
    code: "KDFW",
    city: "Dallas",
    role: "CREW LEGAL",
    fn: "Assigns crews and checks duty-time legality before release.",
  },
  "pax-connect": {
    code: "CYYZ",
    city: "Toronto",
    role: "PAX GATEWAY",
    fn: "Passenger manifests, rebooking and connection protection.",
  },
  notam: {
    code: "KBOS",
    city: "Boston",
    role: "EXT FEED",
    fn: "FAA NOTAM ingest — runway, airspace and navaid restrictions.",
  },
  "ops-radar": {
    code: "KSFO",
    city: "San Francisco",
    role: "ADS-B FEED",
    fn: "Live ADS-B aircraft positions for the ops floor and airspace map.",
  },
};
const SYSTEM_ORDER = Object.keys(SYSTEMS);

/** Used only when a board has no edges yet (cold start). */
const FALLBACK_DEPS: Record<string, string[]> = {
  "weight-balance": ["unimatic"],
  "crew-sched": ["unimatic"],
  "pax-connect": ["unimatic"],
  dispatch: ["unimatic", "weight-balance", "crew-sched", "notam"],
  "ops-radar": ["unimatic"],
};

const KIND_LABELS: Record<InvariantKind, string> = {
  http_status: "HTTP 200 Endpoint Availability",
  latency_lt: "Latency Budget (< 800ms SLA)",
  dep_health: "Comms Link & Upstream Dependency",
  data_field: "Payload Schema & Revision Integrity",
  consistency: "Cross-Hub State Consistency (Unimatic ↔ Radar)",
};

type FaultType = "kill" | "degrade" | "cut_dep" | "corrupt";
type FaultDef = {
  type: FaultType;
  target: string;
  dep?: string;
  label: string;
  cta: string;
  hint: string;
  danger?: boolean;
};
const FAULTS: FaultDef[] = [
  {
    type: "kill",
    target: "unimatic",
    label: "Take Unimatic hub offline",
    cta: "KILL UNIMATIC HUB (SPOF)",
    hint: "6 systems cascade · ground stop",
    danger: true,
  },
  {
    type: "degrade",
    target: "weight-balance",
    label: "Slow the weight & balance feed",
    cta: "DEGRADE WEIGHT & BALANCE (+1500MS)",
    hint: "1.5s latency > 800ms SLA",
  },
  {
    type: "cut_dep",
    target: "dispatch",
    dep: "notam",
    label: "Cut dispatch's NOTAM feed",
    cta: "SEVER DISPATCH → NOTAM LINK",
    hint: "release authority offline",
  },
  {
    type: "corrupt",
    target: "pax-connect",
    label: "Corrupt the passenger data feed",
    cta: "CORRUPT PAX-CONNECT PAYLOAD",
    hint: "rev checksum mismatch",
  },
];

const SKILL_FIRST_STEP: Record<string, { action: string; steps: number }> = {
  "hub-failover": { action: "failover", steps: 3 },
  "degraded-restore": { action: "repair", steps: 4 },
  "dep-reconnect": { action: "reroute", steps: 3 },
  "feed-resync": { action: "restart", steps: 3 },
};

const COLLECTIONS = [
  "nodes",
  "edges",
  "invariants",
  "specs",
  "violations",
  "tasks",
  "agents",
  "skills",
  "events",
] as const;
type Collection = (typeof COLLECTIONS)[number];

const EVENT_FILTERS = [
  "ALL",
  "VIOLATIONS & CHAOS",
  "REMEDIATION & TRIAGE",
  "PROBES & PROOFS",
] as const;
type EventFilter = (typeof EVENT_FILTERS)[number];

const ROLE_ICONS: Record<AgentRole, Icon> = {
  recon: Search01Icon,
  verify: Shield01Icon,
  runner: Activity01Icon,
  orchestrator: DashboardSquare01Icon,
  response: Layers01Icon,
};

const HEALTH_LABEL: Record<Health, string> = {
  up: "ONLINE",
  degraded: "DEGRADED",
  down: "OFFLINE",
};
const HEALTH_COLOR: Record<Health, string> = {
  up: "#34d399",
  degraded: "#fbbf24",
  down: "#f87171",
};
const HEALTH_RANK: Record<Health, number> = { up: 0, degraded: 1, down: 2 };
const worse = (a: Health | undefined, b: Health): Health =>
  a && HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b;

// ---------------------------------------------------------------------------
// Local fault engine — runs the full chaos → triage → remediation → restore
// cascade on the client whenever the host is unavailable (example data, cold
// start, or a failed POST). The patch is an overlay on top of whichever base
// board is showing, so it works for both showcase and live data.
// ---------------------------------------------------------------------------
interface Failure {
  kinds: InvariantKind[] | "all";
  detail: string;
}
interface LocalFault {
  id: string;
  type: FaultType;
  target: string;
  dep?: string;
  skill: string;
  health: Record<string, Health>;
  failures: Record<string, Failure>;
  severed: string[];
  groundStop: boolean;
  staleFeed: boolean;
  resolution: string;
  violationIds: string[];
}
type AgentPatch = { state?: AgentState; task?: string | null; bump?: number };
interface LocalPatch {
  faults: LocalFault[];
  violations: Record<string, ViolationDoc>;
  tasks: Record<string, TaskDoc>;
  agents: Partial<Record<AgentRole, AgentPatch>>;
  events: EventDoc[];
  mission?: MissionState;
}
const emptyPatch = (): LocalPatch => ({
  faults: [],
  violations: {},
  tasks: {},
  agents: {},
  events: [],
});
const patchIsEmpty = (p: LocalPatch) =>
  !p.faults.length &&
  !p.events.length &&
  !Object.keys(p.violations).length &&
  !Object.keys(p.tasks).length &&
  !Object.keys(p.agents).length &&
  !p.mission;

function patchAgents(
  agents: LocalPatch["agents"],
  changes: Partial<Record<AgentRole, AgentPatch>>,
): LocalPatch["agents"] {
  const next = { ...agents };
  for (const [role, change] of Object.entries(changes) as Array<
    [AgentRole, AgentPatch]
  >) {
    const prev = next[role] ?? {};
    next[role] = {
      state: change.state ?? prev.state,
      task: change.task !== undefined ? change.task : prev.task,
      bump: (prev.bump ?? 0) + (change.bump ?? 0),
    };
  }
  return next;
}

function blastRadius(base: Board, target: string): string[] {
  const pairs = base.edges.size
    ? [...base.edges.values()].map((e) => [e.from, e.to] as const)
    : Object.entries(FALLBACK_DEPS).flatMap(([from, deps]) =>
        deps.map((to) => [from, to] as const),
      );
  const out = new Set([target]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, to] of pairs)
      if (out.has(to) && !out.has(from)) {
        out.add(from);
        grew = true;
      }
  }
  return [...out];
}

function planFault(
  base: Board,
  id: string,
  type: FaultType,
  target: string,
  dep?: string,
): LocalFault {
  const kind =
    base.nodes.get(target)?.kind ??
    (target === "unimatic"
      ? "hub"
      : target === "notam" || target === "ops-radar"
        ? "feed"
        : "worker");
  const health: Record<string, Health> = {};
  const failures: Record<string, Failure> = {};
  let severed: string[] = [];
  let skill = "degraded-restore";
  let resolution = `degraded-restore restored ${target}`;
  if (type === "kill") {
    for (const n of blastRadius(base, target)) {
      health[n] = "down";
      failures[n] = {
        kinds: "all",
        detail:
          n === target
            ? `HTTP 503 — ${target} process killed`
            : `upstream ${target} unreachable — cascade (ECONNREFUSED)`,
      };
    }
    if (kind === "hub") {
      const standby = base.nodes.has(`${target}-standby`)
        ? `${target}-standby`
        : "unimatic-standby";
      skill = "hub-failover";
      resolution = `hub-failover to ${standby} complete`;
    } else if (kind === "feed") {
      skill = "feed-resync";
      resolution = `feed-resync restarted ${target} — feed fresh`;
    } else resolution = `degraded-restore restarted ${target}`;
  } else if (type === "degrade") {
    health[target] = "degraded";
    failures[target] = {
      kinds: ["latency_lt"],
      detail: "1500ms > 800ms budget",
    };
    resolution = `degraded-restore repaired ${target} — latency back under 800ms`;
  } else if (type === "cut_dep") {
    const d = dep ?? "notam";
    health[target] = "down";
    failures[target] = {
      kinds: "all",
      detail: `link ${target} → ${d} severed — ECONNRESET`,
    };
    severed = [`${target}-${d}`];
    skill = "dep-reconnect";
    resolution = `dep-reconnect rerouted ${target} → ${d} via backup link`;
  } else {
    health[target] = "degraded";
    failures[target] = {
      kinds: ["data_field", "consistency"],
      detail: "payload corrupted — rev checksum mismatch",
    };
    resolution = `degraded-restore repaired ${target} payload — rev consistent`;
  }
  const affected = Object.keys(health);
  return {
    id,
    type,
    target,
    dep,
    skill,
    health,
    failures,
    severed,
    groundStop: affected.includes("dispatch"),
    staleFeed: type === "kill" && affected.includes("ops-radar"),
    resolution,
    violationIds: [],
  };
}

function applyPatch(base: Board, p: LocalPatch): Board {
  if (patchIsEmpty(p)) return base;
  const health: Record<string, Health> = {};
  const failures: Record<string, Failure[]> = {};
  let groundStop = false;
  let staleFeed = false;
  for (const f of p.faults) {
    for (const [id, h] of Object.entries(f.health))
      health[id] = worse(health[id], h);
    for (const [id, fl] of Object.entries(f.failures))
      (failures[id] ??= []).push(fl);
    groundStop ||= f.groundStop;
    staleFeed ||= f.staleFeed;
  }
  const nodes = new Map(
    [...base.nodes].map(([id, n]): [string, NodeDoc] => [
      id,
      health[id] ? { ...n, health: worse(n.health, health[id]) } : n,
    ]),
  );
  const invariants = new Map(
    [...base.invariants].map(([id, inv]): [string, InvariantDoc] => {
      const fl = failures[inv.node]?.find(
        (f) => f.kinds === "all" || f.kinds.includes(inv.kind),
      );
      return [
        id,
        fl ? { ...inv, lastResult: "fail", lastDetail: fl.detail } : inv,
      ];
    }),
  );
  const violations = new Map(base.violations);
  for (const v of Object.values(p.violations)) violations.set(v.id, v);
  const tasks = new Map(base.tasks);
  for (const t of Object.values(p.tasks)) tasks.set(t.id, t);
  const agents = new Map(base.agents);
  for (const [role, change] of Object.entries(p.agents) as Array<
    [AgentRole, AgentPatch]
  >) {
    const agent = [...agents.values()].find((a) => a.role === role);
    if (!agent) continue;
    agents.set(agent.id, {
      ...agent,
      state: change.state ?? agent.state,
      task: change.task === null ? undefined : (change.task ?? agent.task),
      decisions: agent.decisions + (change.bump ?? 0),
      lastBeat: Date.now(),
    });
  }
  const events = p.events.length
    ? [...p.events, ...base.events].sort((a, b) => b.ts - a.ts).slice(0, 300)
    : base.events;
  return {
    ...base,
    nodes,
    invariants,
    violations,
    tasks,
    agents,
    events,
    flights: p.faults.length
      ? {
          ...base.flights,
          groundStop: base.flights.groundStop || groundStop,
          staleFeed: base.flights.staleFeed || staleFeed,
        }
      : base.flights,
    mission: p.mission ?? base.mission,
  };
}

function severedEdges(board: Board, patch: LocalPatch): Set<string> {
  const out = new Set(patch.faults.flatMap((f) => f.severed));
  // Live inference: a dep_health proof failing while the dependency itself is
  // up means the link (not the dependency) is broken.
  for (const inv of board.invariants.values()) {
    const dep = inv.params.dep;
    if (
      inv.kind === "dep_health" &&
      inv.lastResult === "fail" &&
      dep &&
      board.nodes.get(dep)?.health === "up"
    )
      out.add(`${inv.node}-${dep}`);
  }
  return out;
}

const orderNodes = (nodes: NodeDoc[]) =>
  [...nodes].sort((a, b) => {
    const ia = SYSTEM_ORDER.indexOf(a.id);
    const ib = SYSTEM_ORDER.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id.localeCompare(b.id);
  });

function eventCategory(e: EventDoc): EventFilter {
  if (
    ["violation", "chaos", "distress", "escalate"].includes(e.type) ||
    e.severity === "crit"
  )
    return "VIOLATIONS & CHAOS";
  if (["probe", "recon", "verify", "spec", "invariant"].includes(e.type))
    return "PROBES & PROOFS";
  return "REMEDIATION & TRIAGE";
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------
function ArcGauge({
  label,
  value,
  unit,
  ratio,
  tone,
}: {
  label: string;
  value: string | number;
  unit: string;
  ratio: number;
  tone: "ok" | "warn" | "alert" | "info";
}) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const sweep = circumference * 0.75;
  const color = {
    ok: "#34d399",
    warn: "#fbbf24",
    alert: "#f87171",
    info: "#38bdf8",
  }[tone];
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <div className={`arc-gauge ${tone}`} role="meter" aria-label={label} aria-valuenow={Math.round(clamped * 100)} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="rgba(226,232,240,0.09)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${sweep} ${circumference}`}
          transform="rotate(135 60 60)"
        />
        <circle
          className="arc-gauge-value"
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${sweep * clamped} ${circumference}`}
          transform="rotate(135 60 60)"
          style={{ transition: "stroke-dasharray 600ms ease, stroke 300ms" }}
        />
        <text
          x="60"
          y="62"
          textAnchor="middle"
          fill="#f1f5f9"
          fontSize="22"
          fontWeight="600"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </text>
        <text
          x="60"
          y="80"
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="8.5"
          letterSpacing="1"
        >
          {unit}
        </text>
      </svg>
      <span className="arc-gauge-label">{label}</span>
    </div>
  );
}

// ---- Topology DAG -----------------------------------------------------------
const TOPO_W = 176;
const TOPO_H = 66;
const TIER_Y = [0, 85, 265, 435, 555];
const TIER_LABELS = [
  "",
  "TIER 1 · Core data hubs & external feeds",
  "TIER 2 · Operational processing & radar feeds",
  "TIER 3 · Flight release authority",
  "TIER 4 · Physical airspace & distress tracking",
];
const TOPO: Record<string, { x: number; tier: number; title: string; sub: string }> = {
  unimatic: { x: 320, tier: 1, title: "Unimatic Primary Hub", sub: "KORD CHICAGO" },
  "unimatic-standby": { x: 580, tier: 1, title: "Unimatic Standby Replica", sub: "KDEN DENVER" },
  notam: { x: 820, tier: 1, title: "FAA NOTAM Ingest", sub: "KBOS BOSTON" },
  "ops-radar": { x: 170, tier: 2, title: "Ops Radar ADS-B", sub: "KSFO" },
  "pax-connect": { x: 390, tier: 2, title: "Pax Connect", sub: "CYYZ" },
  "weight-balance": { x: 610, tier: 2, title: "Weight & Balance", sub: "KATL" },
  "crew-sched": { x: 830, tier: 2, title: "Crew Scheduling", sub: "KDFW" },
  dispatch: { x: 610, tier: 3, title: "Flight Dispatch Control", sub: "KJFK" },
  "airspace-fleet": { x: 470, tier: 4, title: "North America Fleet", sub: "" },
  "artex-adt": { x: 790, tier: 4, title: "ARTEX ELT-5000 Beacon", sub: "" },
};
const TIER2_GAPS = [280, 500, 720, 940];
const EDGE_LABELS: Record<string, string> = {
  "dispatch-weight-balance": "LOAD SHEET",
  "dispatch-crew-sched": "CREW LEGALITY",
  "dispatch-notam": "NOTAMS",
};

function TopologyDag({
  board,
  severed,
  selected,
  proofs,
  artexTriggered,
  onInspect,
  onFleet,
  onArtex,
}: {
  board: Board;
  severed: Set<string>;
  selected: string | null;
  proofs: Map<string, { pass: number; total: number }>;
  artexTriggered: boolean;
  onInspect: (id: string) => void;
  onFleet: () => void;
  onArtex: () => void;
}) {
  const HOME_VB = { x: -30, y: -50, w: 1140, h: 700 };
  const [vb, setVb] = useState(HOME_VB);
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const clampW = (w: number) => Math.min(2400, Math.max(260, w));
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setVb((v) => {
      const w = clampW(v.w * factor);
      const h = (w / v.w) * v.h;
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      return { x: v.x + fx * (v.w - w), y: v.y + fy * (v.h - h), w, h };
    });
  };
  const onWheel = (e: ReactWheelEvent) => {
    zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.15 : 1 / 1.15);
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    pan.current = { px: e.clientX, py: e.clientY, x: vb.x, y: vb.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = pan.current;
    const el = svgRef.current;
    if (!p || !el) return;
    const rect = el.getBoundingClientRect();
    const k = vb.w / rect.width;
    setVb((v) => ({ ...v, x: p.x - (e.clientX - p.px) * k, y: p.y - (e.clientY - p.py) * k }));
  };
  const onPointerUp = () => {
    pan.current = null;
  };

  const layout = new Map<string, { x: number; y: number; tier: number; title: string; sub: string }>();
  for (const [id, t] of Object.entries(TOPO))
    if (board.nodes.has(id) || id === "airspace-fleet" || id === "artex-adt")
      layout.set(id, { ...t, y: TIER_Y[t.tier] });
  // Unknown live nodes park on tier 3 away from dispatch.
  let spare = 0;
  for (const n of board.nodes.values())
    if (!layout.has(n.id)) {
      const x = [170, 390, 830, 1000][spare++ % 4];
      layout.set(n.id, { x, y: TIER_Y[3], tier: 3, title: n.name, sub: n.kind.toUpperCase() });
    }

  const flightCount = board.flights.flights.length;
  const fleetLine = `${flightCount} AIRCRAFT · ${board.flights.groundStop ? "GROUND STOP" : "ACTIVE TRACKING"}`;
  const artexLine = `406 MHz DISTRESS · ${artexTriggered ? "TRIGGERED" : "ARMED"}`;

  type E = { id: string; src: string; dst: string; label?: string };
  const edges: E[] = [...board.edges.values()].map((e) => ({
    id: e.id,
    src: e.to,
    dst: e.from,
    label: EDGE_LABELS[e.id],
  }));
  const has = (a: string, b: string) =>
    edges.some((e) => (e.src === a && e.dst === b) || (e.src === b && e.dst === a));
  const virtual: E[] = [
    { id: "v-replication", src: "unimatic", dst: "unimatic-standby", label: "REPLICATION" },
    { id: "v-release", src: "dispatch", dst: "airspace-fleet", label: "FLIGHT RELEASE" },
    { id: "v-positions", src: "ops-radar", dst: "airspace-fleet", label: "ADS-B POSITIONS" },
    { id: "v-distress", src: "airspace-fleet", dst: "artex-adt", label: "406 MHz · GADSS" },
  ];
  for (const v of virtual)
    if (layout.has(v.src) && layout.has(v.dst) && !has(v.src, v.dst)) edges.push(v);
  const drawable = edges.filter((e) => layout.has(e.src) && layout.has(e.dst));

  // Spread anchors so parallel edges never stack on one pixel.
  const outgoing = new Map<string, E[]>();
  const incoming = new Map<string, E[]>();
  for (const e of drawable) {
    const a = layout.get(e.src)!;
    const b = layout.get(e.dst)!;
    if (a.tier === b.tier) continue;
    (outgoing.get(e.src) ?? outgoing.set(e.src, []).get(e.src)!).push(e);
    (incoming.get(e.dst) ?? incoming.set(e.dst, []).get(e.dst)!).push(e);
  }
  const offset = (list: E[] | undefined, e: E, key: "src" | "dst", step: number) => {
    if (!list) return 0;
    const sorted = [...list].sort((p, q) => layout.get(p[key])!.x - layout.get(q[key])!.x);
    const i = sorted.indexOf(e);
    return (i - (sorted.length - 1) / 2) * step;
  };

  const healthOf = (id: string): Health => {
    if (id === "airspace-fleet") return board.flights.groundStop ? "down" : "up";
    if (id === "artex-adt") return artexTriggered ? "down" : "up";
    return board.nodes.get(id)?.health ?? "up";
  };

  const paths = drawable.map((e) => {
    const a = layout.get(e.src)!;
    const b = layout.get(e.dst)!;
    let d: string;
    let lx: number;
    let ly: number;
    if (a.tier === b.tier) {
      const right = a.x < b.x;
      const x1 = a.x + (right ? TOPO_W / 2 : -TOPO_W / 2);
      const x2 = b.x + (right ? -TOPO_W / 2 : TOPO_W / 2);
      d = `M${x1},${a.y} L${x2},${b.y}`;
      lx = (x1 + x2) / 2;
      ly = a.y;
    } else {
      const x1 = a.x + offset(outgoing.get(e.src), e, "dst", 16);
      const x2 = b.x + offset(incoming.get(e.dst), e, "src", 22);
      const y1 = a.y + TOPO_H / 2;
      const y2 = b.y - TOPO_H / 2;
      if (a.tier === 1 && b.tier === 3) {
        const mid = (x1 + x2) / 2;
        const gx = TIER2_GAPS.reduce((p, g) => (Math.abs(g - mid) < Math.abs(p - mid) ? g : p));
        const yw = TIER_Y[2];
        const m1 = (y1 + yw) / 2;
        const m2 = (yw + y2) / 2;
        d = `M${x1},${y1} C${x1},${m1} ${gx},${m1} ${gx},${yw} C${gx},${m2} ${x2},${m2} ${x2},${y2}`;
        lx = (x1 + gx) / 2;
        ly = m1;
      } else {
        const ym = (y1 + y2) / 2;
        d = `M${x1},${y1} C${x1},${ym} ${x2},${ym} ${x2},${y2}`;
        // A label on a link that crosses a whole tier would sit on that tier's
        // title, so it rides the curve further down (cubic at t = 0.62).
        const t = b.tier - a.tier > 1 ? 0.62 : 0.5;
        const near = (1 - t) ** 3 + 3 * (1 - t) ** 2 * t;
        lx = near * x1 + (1 - near) * x2;
        ly = (1 - t) ** 3 * y1 + (3 * (1 - t) ** 2 * t + 3 * (1 - t) * t ** 2) * ym + t ** 3 * y2;
      }
    }
    const cut = severed.has(e.id) || severed.has(`${e.dst}-${e.src}`);
    const affected = !cut && (healthOf(e.src) !== "up" || healthOf(e.dst) !== "up");
    const state = cut ? "severed" : affected ? "affected" : "ok";
    return { e, d, lx, ly, state, label: cut ? "SEVERED" : e.label };
  });
  const stroke = { ok: "rgba(240,240,250,0.30)", affected: "#fbbf24", severed: "#f87171" } as const;

  return (
    <>
    <svg
      ref={svgRef}
      className="topology-dag"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      role="group"
      aria-label="4-tier aviation comms and dependency graph. Scroll to zoom, drag to pan."
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <defs>
        <filter id="dag-glow" x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      {paths.map(({ e, d, state }) => (
        <g key={e.id}>
          <path
            className={`dag-edge ${state}`}
            d={d}
            fill="none"
            stroke={stroke[state as keyof typeof stroke]}
            strokeWidth={state === "ok" ? 1.1 : 1.6}
            strokeDasharray={state === "severed" ? "5 5" : undefined}
            strokeLinecap="round"
          />
          {state !== "severed" && (
            <path
              className="dag-edge-flow"
              d={d}
              fill="none"
              stroke={state === "ok" ? "#f0f0fa" : "#fbbf24"}
              strokeOpacity={state === "ok" ? 0.55 : 0.85}
              strokeWidth="1.6"
              strokeDasharray="2 22"
              strokeLinecap="round"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="24"
                to="0"
                dur={state === "ok" ? "1.6s" : "2.8s"}
                repeatCount="indefinite"
              />
            </path>
          )}
        </g>
      ))}
      {[1, 2, 3, 4].map((tier) => {
        const top = tier === 3 ? 388 : tier === 4 ? 510 : TIER_Y[tier] - 56;
        const [name, detail] = TIER_LABELS[tier].split(" · ");
        return (
          <g key={tier} className="dag-tier">
            <circle cx="26" cy={top + 12} r="3" fill="#f0f0fa" />
            <text x="36" y={top + 16} fontSize="10.5" fontWeight="600">
              {name}
              <tspan className="dag-tier-detail" dx="8">{detail}</tspan>
            </text>
          </g>
        );
      })}
      {paths
        .filter((p) => p.label)
        .map(({ e, lx, ly, state, label }) => {
          const w = label!.length * 5.6 + 16;
          return (
            <g key={`${e.id}-label`} className={`dag-edge-label ${state}`}>
              <rect x={lx - w / 2} y={ly - 8} width={w} height="16" rx="8" />
              <text x={lx} y={ly + 3.4} textAnchor="middle" fontSize="8.5" letterSpacing="0.6" fontWeight="600">
                {label}
              </text>
            </g>
          );
        })}
      {[...layout.entries()].map(([id, p]) => {
        const virtualNode = id === "airspace-fleet" || id === "artex-adt";
        const health = healthOf(id);
        const proof = proofs.get(id);
        const meta = SYSTEMS[id];
        const w = virtualNode ? 200 : TOPO_W;
        const sub = id === "airspace-fleet" ? fleetLine : id === "artex-adt" ? artexLine : `${p.sub}${meta ? ` · ${meta.role}` : ""}`;
        const statusText = id === "airspace-fleet" ? (board.flights.groundStop ? "HOLD" : "TRACKING") : id === "artex-adt" ? (artexTriggered ? "TRIGGERED" : "ARMED") : HEALTH_LABEL[health];
        const aria =
          id === "airspace-fleet"
            ? `North America Fleet (${flightCount} Aircraft) · ${board.flights.groundStop ? "GROUND STOP" : "ACTIVE TRACKING"}`
            : id === "artex-adt"
              ? `ARTEX ELT-5000 Distress Beacon · ${artexTriggered ? "TRIGGERED" : "ARMED"}`
              : `Inspect ${p.title} · ${p.sub} · ${HEALTH_LABEL[health]}`;
        const activate = () => (id === "airspace-fleet" ? onFleet() : id === "artex-adt" ? onArtex() : onInspect(id));
        return (
          <g
            key={id}
            role="button"
            tabIndex={0}
            aria-label={aria}
            className={`dag-node ${health} ${selected === id ? "active" : ""} ${virtualNode ? "virtual" : ""}`}
            transform={`translate(${p.x},${p.y})`}
            onClick={activate}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                activate();
              }
            }}
            style={{ cursor: "pointer" }}
          >
            {(health !== "up" || selected === id) && (
              <rect
                className="dag-node-glow"
                x={-w / 2 + 14}
                y={TOPO_H / 2 - 12}
                width={w - 28}
                height="10"
                rx="5"
                fill={selected === id && health === "up" ? "#f0f0fa" : HEALTH_COLOR[health]}
                opacity={selected === id && health === "up" ? 0.22 : 0.55}
                filter="url(#dag-glow)"
              />
            )}
            <rect
              className="dag-node-card"
              x={-w / 2}
              y={-TOPO_H / 2}
              width={w}
              height={TOPO_H}
              rx="12"
              strokeDasharray={virtualNode ? "4 3" : undefined}
            />
            <rect className="dag-node-well" x={-w / 2 + 7} y="-4" width={w - 14} height="31" rx="8" />
            <circle className="dag-head-dot" cx={-w / 2 + 15} cy="-17" r="3" />
            <text className="dag-node-title" x={-w / 2 + 25} y="-13.4" fontSize="11.5" fontWeight="500">
              {id === "airspace-fleet" ? `North America Fleet` : p.title}
            </text>
            <text className="dag-node-sub" x={-w / 2 + 15} y="8" fontSize="8.4" letterSpacing="0.5">
              {sub}
            </text>
            <circle cx={-w / 2 + 17} cy="17.5" r="2.6" fill={HEALTH_COLOR[health]}>
              {health !== "up" && <animate attributeName="opacity" values="1;0.25;1" dur="1s" repeatCount="indefinite" />}
            </circle>
            <text className="dag-node-status" x={-w / 2 + 25} y="20.6" fill={HEALTH_COLOR[health]} fontSize="8.6" fontWeight="600" letterSpacing="0.9">
              {statusText}
            </text>
            {proof && (
              <g className="dag-proof-badge">
                <text x={w / 2 - 15} y="20.6" textAnchor="end" fontSize="8.6" fontWeight="600" fill={proof.pass === proof.total ? "#f0f0fa" : "#fca5a5"}>
                  {proof.pass}<tspan fill="rgba(240,240,250,0.45)">/{proof.total} proofs</tspan>
                </text>
              </g>
            )}
            <circle className="dag-port dag-port-in" cx="0" cy={-TOPO_H / 2} r="3.2" fill={p.tier === 1 ? "#fbbf24" : "#3080ff"} />
            <circle className="dag-port dag-port-out" cx="0" cy={TOPO_H / 2} r="3.2" fill={HEALTH_COLOR[health]} />
          </g>
        );
      })}
    </svg>
    <div className="topology-readout" aria-hidden="true">
      <span>N: {layout.size}</span>
      <span>E: {drawable.length}</span>
      <span>Z: {Math.round((HOME_VB.w / vb.w) * 100)}%</span>
      <span>S: {paths.filter((p) => p.state !== "ok").length}</span>
    </div>
    <div className="topology-hud">
      <button aria-label="Zoom out" onClick={() => setVb((v) => ({ ...v, w: clampW(v.w * 1.25), h: v.h * 1.25 }))}>−</button>
      <button className="fit" onClick={() => setVb(HOME_VB)}>FIT</button>
      <button aria-label="Zoom in" onClick={() => setVb((v) => ({ ...v, w: clampW(v.w / 1.25), h: v.h / 1.25 }))}>+</button>
    </div>
    </>
  );
}

// ---- 1,000-agent scale matrix -------------------------------------------------
const SECTORS = [
  { id: "NA-EAST", hubs: ["dispatch", "notam", "pax-connect", "weight-balance"], airports: "KJFK · KBOS · CYYZ · KATL" },
  { id: "NA-CENTRAL", hubs: ["unimatic", "unimatic-standby", "crew-sched"], airports: "KORD · KDEN · KDFW" },
  { id: "NA-WEST", hubs: ["ops-radar"], airports: "KSFO · KSEA · KLAX" },
  { id: "NAT-CORRIDOR", hubs: [] as string[], airports: "NAT TRACKS · GANDER · SHANWICK" },
];
const CELL_COLORS = {
  idle: "#18212c",
  probe: "#38bdf8",
  proof: "#2f9e7a",
  lease: "#a78bfa",
  remediate: "#f87171",
  triage: "#fbbf24",
};
function hash(n: number) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function SwarmScale({
  hot,
  tick,
  groundStop,
}: {
  hot: Set<string>;
  tick: number;
  groundStop: boolean;
}) {
  const anyHot = hot.size > 0 || groundStop;
  const totalRemediating = SECTORS.reduce(
    (sum, s) => sum + (s.hubs.some((h) => hot.has(h)) || (s.id === "NAT-CORRIDOR" && groundStop) ? 1 : 0),
    0,
  );
  const probes = 470 + (hash(tick) % 24) + (anyHot ? 60 : 0);
  return (
    <section className="swarm-scale-section">
      <header className="swarm-scale-header">
        <div>
          <span className="eyebrow">SCALE MODEL · SHARDED BY SECTOR · BLACKBOARD CONTRACT</span>
          <h2>1,000 Swarm Workers</h2>
        </div>
        <dl className="swarm-scale-metrics">
          <div><dt>PROBE THROUGHPUT</dt><dd>~{probes} probes/sec</dd></div>
          <div><dt>CAS LEASE CONFLICTS</dt><dd>0 lock collisions</dd></div>
          <div><dt>FANOUT</dt><dd>Firestore onSnapshot fanout</dd></div>
          <div><dt>REMEDIATION WAVES</dt><dd className={anyHot ? "text-alert" : ""}>{anyHot ? `${totalRemediating} sector${totalRemediating === 1 ? "" : "s"} active` : "none — monitoring"}</dd></div>
        </dl>
      </header>
      <div className="swarm-sector-grid">
        {SECTORS.map((sector, si) => {
          const sectorHot = sector.hubs.some((h) => hot.has(h)) || (sector.id === "NAT-CORRIDOR" && groundStop);
          const counts = { idle: 0, probe: 0, proof: 0, lease: 0, remediate: 0, triage: 0 };
          const cells = Array.from({ length: 250 }, (_, i) => {
            const col = i % 25;
            const h = hash(si * 1000 + i);
            let state: keyof typeof CELL_COLORS;
            const wave = (tick * 4) % 34;
            if (sectorHot && Math.abs(col - wave + 4) <= 3) state = h % 3 ? "remediate" : "triage";
            else if (sectorHot && h % 5 === 0) state = "triage";
            else {
              const phase = (h + tick * (1 + (h % 3))) % 12;
              state = phase < 5 ? "proof" : phase < 8 ? "probe" : phase < 9 ? "lease" : "idle";
            }
            counts[state]++;
            return { i, col, row: Math.floor(i / 25), state };
          });
          return (
            <article key={sector.id} className={`swarm-sector ${sectorHot ? "hot" : ""}`}>
              <header>
                <strong>{sector.id} // 250 AGENTS</strong>
                <span>{sector.airports}</span>
              </header>
              <svg className="swarm-cell-matrix" viewBox="0 0 250 100" role="img" aria-label={`${sector.id}: ${counts.proof} proving, ${counts.probe} probing, ${counts.remediate + counts.triage} remediating`}>
                {cells.map((c) => (
                  <rect key={c.i} x={c.col * 10 + 1} y={c.row * 10 + 1} width="8" height="8" rx="1.5" fill={CELL_COLORS[c.state]} opacity={c.state === "idle" ? 0.9 : 0.85} />
                ))}
              </svg>
              <footer>
                <span>PROVING {counts.proof}</span>
                <span>PROBING {counts.probe}</span>
                <span>LEASES {counts.lease}</span>
                <span className={counts.remediate + counts.triage ? "text-alert" : ""}>
                  REMEDIATING {counts.remediate + counts.triage}
                </span>
              </footer>
            </article>
          );
        })}
      </div>
      <div className="swarm-cell-legend">
        {(Object.keys(CELL_COLORS) as Array<keyof typeof CELL_COLORS>).map((k) => (
          <span key={k}>
            <i style={{ background: CELL_COLORS[k], display: "inline-block", width: 9, height: 9, borderRadius: 2, marginRight: 6 }} />
            {k === "proof" ? "Running proofs" : k === "probe" ? "Recon probe" : k === "lease" ? "Claiming lease" : k === "remediate" ? "Executing skill" : k === "triage" ? "Triage" : "Idle"}
          </span>
        ))}
      </div>
    </section>
  );
}

// ---- Inspector mini dependency graph ---------------------------------------
function DepsGraph({
  id,
  deps,
  dependents,
  severed,
  nodes,
  onInspect,
}: {
  id: string;
  deps: string[];
  dependents: string[];
  severed: Set<string>;
  nodes: Map<string, NodeDoc>;
  onInspect: (id: string) => void;
}) {
  const CX = 190;
  const CY = 70;
  const col = (list: string[], x: number) => {
    const gap = Math.min(34, 120 / Math.max(1, list.length - 1 || 1));
    const start = CY - ((list.length - 1) * gap) / 2;
    return list.map((n, i) => ({ n, x, y: start + i * gap }));
  };
  const left = col(deps, 56);
  const right = col(dependents, 324);
  const health = (n: string) => nodes.get(n)?.health ?? "up";
  const centerHealth = health(id);
  return (
    <svg className="deps-graph" viewBox="0 0 380 140" role="img" aria-label={`Dependency graph for ${id}`}>
      {left.map(({ n, x, y }) => (
        <path
          key={`in-${n}`}
          d={`M${x + 34},${y} C${x + 70},${y} ${CX - 70},${CY} ${CX - 34},${CY}`}
          fill="none"
          stroke={severed.has(`${id}-${n}`) ? "#f87171" : health(n) === "up" ? "#3b4b5c" : "#fbbf24"}
          strokeWidth="1.4"
          strokeDasharray={severed.has(`${id}-${n}`) ? "5 4" : undefined}
          markerEnd="url(#deps-arrow)"
        />
      ))}
      {right.map(({ n, x, y }) => (
        <path
          key={`out-${n}`}
          d={`M${CX + 34},${CY} C${CX + 70},${CY} ${x - 70},${y} ${x - 34},${y}`}
          fill="none"
          stroke={severed.has(`${n}-${id}`) ? "#f87171" : health(id) === "up" ? "#3b4b5c" : "#fbbf24"}
          strokeWidth="1.4"
          strokeDasharray={severed.has(`${n}-${id}`) ? "5 4" : undefined}
          markerEnd="url(#deps-arrow)"
        />
      ))}
      <defs>
        <marker id="deps-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#64748b" />
        </marker>
      </defs>
      {[...left, ...right].map(({ n, x, y }) => (
        <g key={n} role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => onInspect(n)} onKeyDown={(e) => { if (e.key === "Enter") onInspect(n); }}>
          <rect x={x - 34} y={y - 13} width="68" height="26" rx="5" fill="#0f151c" stroke={HEALTH_COLOR[health(n)]} strokeOpacity={health(n) === "up" ? 0.45 : 0.95} />
          <text x={x} y={y + 3.5} textAnchor="middle" fill="#cbd5e1" fontSize="8.5" fontFamily="var(--font-mono)">
            {n.length > 11 ? `${n.slice(0, 10)}…` : n}
          </text>
        </g>
      ))}
      <g>
        <rect x={CX - 40} y={CY - 17} width="80" height="34" rx="6" fill="#152230" stroke="#7dd3fc" strokeWidth="1.4" />
        <circle cx={CX - 28} cy={CY - 7} r="3.5" fill={HEALTH_COLOR[centerHealth]} />
        <text x={CX} y={CY + 4} textAnchor="middle" fill="#f1f5f9" fontSize="9.5" fontWeight="700" fontFamily="var(--font-mono)">
          {id.length > 12 ? `${id.slice(0, 11)}…` : id}
        </text>
      </g>
    </svg>
  );
}

// ---- Live response trace ---------------------------------------------------
const TRACE_STAGES: { key: string; types: string[]; label: string }[] = [
  { key: "detection", types: ["violation", "chaos", "distress", "escalate"], label: "DETECTION" },
  { key: "triage", types: ["triage"], label: "TRIAGE" },
  { key: "dispatch", types: ["task", "lease"], label: "DISPATCH" },
  { key: "response", types: ["remediate", "action"], label: "RESPONSE" },
  { key: "resolved", types: ["resolved", "mission"], label: "RESOLVED" },
];
const INCIDENT_TYPES = new Set(TRACE_STAGES.flatMap((s) => s.types));

function ResponseTrace({ events }: { events: EventDoc[] }) {
  const ordered = useMemo(() => [...events].sort((a, b) => a.ts - b.ts), [events]);
  const incident = [...ordered].reverse().find((e) => INCIDENT_TYPES.has(e.type) && e.node);
  if (!incident)
    return (
      <div className="trace-card idle">
        <span className="trace-node">No incident in progress — swarm on patrol</span>
      </div>
    );
  const node = incident.node!;
  let reached = true;
  return (
    <div className="trace-card">
      <span className="trace-node">
        Incident on <strong>{node}</strong>
      </span>
      {TRACE_STAGES.map((s) => {
        const ev = [...ordered].reverse().find((e) => e.node === node && s.types.includes(e.type));
        const active = reached && !ev;
        if (!ev) reached = false;
        return (
          <div key={s.key} className={`trace-row ${ev ? "done" : active ? "active" : "waiting"}`}>
            <span className="trace-dot" />
            <span className="trace-label">{s.label}</span>
            <span className="trace-detail">
              {ev ? (
                <>
                  <span className="trace-msg">{ev.msg}</span>
                  <small>
                    {ev.actor} · {relTime(ev.ts)}
                  </small>
                </>
              ) : (
                <small>{active ? "in progress" : "waiting"}</small>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const live = useBoard();
  const [sample] = useState(showcaseBoard);
  const [example, setExample] = useState(false);
  const [view, setView] = useState<View>("Mission Control");
  const [airspaceExpanded, setAirspaceExpanded] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const [map, setMap] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [flightId, setFlightId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chaos, setChaos] = useState(false);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<RegionId>("regional");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "FAILING" | "PASSING">("ALL");
  const [nodeFilter, setNodeFilter] = useState("ALL");
  const [showSpecs, setShowSpecs] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventFilter>("ALL");
  const [collection, setCollection] = useState<Collection>("nodes");
  const [patch, setPatch] = useState<LocalPatch>(emptyPatch);
  const faultRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const timers = useRef(new Map<string, number[]>());
  const seq = useRef(0);
  const recordingViewOpened = useRef(false);
  const activeNavigationRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 760px)');
    const reveal = () => {
      setAirspaceExpanded(!mobile.matches);
      if (mobile.matches) activeNavigationRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
    };
    reveal();
    mobile.addEventListener('change', reveal);
    return () => mobile.removeEventListener('change', reveal);
  }, [view]);
  useEffect(() => {
    if (live.rehearsal?.recording && !recordingViewOpened.current) {
      recordingViewOpened.current = true;
      setView("Swarm");
    }
  }, [live.rehearsal?.recording]);

  // ---- data source ---------------------------------------------------------
  const coldFallback = !live.connected && live.nodes.size === 0;
  const localMode = example || coldFallback;
  const sourceKind = example ? "example" : coldFallback ? "fallback" : "live";
  const base: Board = localMode
    ? {
        ...sample,
        flights: {
          ...sample.flights,
          flights: sample.flights.flights.map((f) => {
            if (f.status !== "enroute") return f;
            const t =
              (f.t + ((now - (sample.mission.launchedAt ?? now)) / 1000) * f.speed) % 1;
            const [lon, lat] = routePoint(f.from, f.to, t);
            return { ...f, t, position: { lat, lon } };
          }),
        },
      }
    : live;
  const board = applyPatch(base, patch);
  const baseRef = useRef(base);
  baseRef.current = base;
  const localOverride = !localMode && !patchIsEmpty(patch);
  const dataMode = example
    ? "EXAMPLE DATA · LOCAL SIM"
    : coldFallback
      ? "HOST OFFLINE · LOCAL SIM"
      : localOverride
        ? "HOST SIM · LOCAL OVERRIDE"
        : "HOST SIM · LIVE FEED";

  // ---- derived -------------------------------------------------------------
  const nodes = orderNodes([...board.nodes.values()]);
  const checks = [...board.invariants.values()];
  const violations = [...board.violations.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  const open = violations.filter((v) => v.status !== "resolved");
  const passed = checks.filter((i) => i.lastResult === "pass").length;
  const failing = checks.filter((i) => i.lastResult === "fail").length;
  const upNodes = nodes.filter((n) => n.health === "up").length;
  const node = selected ? board.nodes.get(selected) : undefined;
  const flight = board.flights.flights.find((f) => f.id === flightId);
  const stage = missionStage(board);
  const condition = missionCondition(board);
  const percent = checks.length ? Math.round((passed / checks.length) * 100) : 0;
  const enrouteCount = board.flights.flights.filter((f) => f.status === "enroute").length;
  const latency = open.length ? (nodes.find((n) => n.health === "degraded") ? 1500 : 503) : 14;
  const artexTriggered = condition === "DEGRADED" || board.flights.groundStop;
  const severed = severedEdges(board, patch);
  const proofs = new Map<string, { pass: number; total: number }>();
  for (const c of checks) {
    const p = proofs.get(c.node) ?? { pass: 0, total: 0 };
    p.total++;
    if (c.lastResult === "pass") p.pass++;
    proofs.set(c.node, p);
  }
  const edgesList = [...board.edges.values()];
  const depsOf = (id: string) => edgesList.filter((e) => e.from === id).map((e) => e.to);
  const dependentsOf = (id: string) => edgesList.filter((e) => e.to === id).map((e) => e.from);
  const elapsed = board.mission.launchedAt
    ? Math.max(0, Math.floor((now - board.mission.launchedAt) / 1000))
    : 0;
  const clock = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const q = query.toLowerCase();
  const filteredChecks = checks.filter(
    (i) =>
      (statusFilter === "ALL" ||
        (statusFilter === "FAILING" ? i.lastResult === "fail" : i.lastResult === "pass")) &&
      (nodeFilter === "ALL" || i.node === nodeFilter) &&
      `${i.node} ${i.kind} ${KIND_LABELS[i.kind]} ${i.lastDetail ?? ""}`.toLowerCase().includes(q),
  );
  const filteredEvents = board.events.filter(
    (e) =>
      (eventFilter === "ALL" || eventCategory(e) === eventFilter) &&
      `${e.actor} ${e.msg} ${e.type} ${e.node ?? ""}`.toLowerCase().includes(q),
  );
  const hotNodes = new Set(nodes.filter((n) => n.health !== "up").map((n) => n.id));
  const coupled = checks.filter((c) => c.node === "dispatch" || c.node === "ops-radar");
  const coupledPass = coupled.filter((c) => c.lastResult === "pass").length;
  const lockFlight = board.flights.flights.find((f) => f.status === "enroute");
  const pipelineStage = open.length
    ? open.some((v) => v.status === "remediating")
      ? 4
      : 3
    : stage <= 0
      ? 0
      : stage === 1
        ? 1
        : 2;
  const collectionDocs: Record<Collection, Array<{ id: string }>> = {
    nodes,
    edges: edgesList,
    invariants: checks,
    specs: [...board.specs.values()],
    violations,
    tasks: [...board.tasks.values()],
    agents: [...board.agents.values()],
    skills: [...board.skills.values()],
    events: board.events,
  };

  // ---- effects -------------------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setChaos(false);
      setSelected(null);
      setFlightId(null);
      inspectorTrigger.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (faultRef.current && !faultRef.current.contains(event.target as Node)) setChaos(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    const pending = timers.current;
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
      for (const list of pending.values()) list.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (node || flight) inspectorRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, flightId]);

  // Switching data source drops any local overlay built on the old source.
  const lastSource = useRef(sourceKind);
  useEffect(() => {
    if (lastSource.current === sourceKind) return;
    lastSource.current = sourceKind;
    clearAllTimers();
    setPatch(emptyPatch());
  }, [sourceKind]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- helpers -------------------------------------------------------------
  function inspect(id: string) {
    inspectorTrigger.current = document.activeElement as HTMLElement;
    setFlightId(null);
    setSelected(id);
  }
  function closeInspector() {
    setSelected(null);
    setFlightId(null);
    inspectorTrigger.current?.focus();
  }
  function goHome() {
    setView("Mission Control");
    setChaos(false);
    setQuery("");
    setSelected(null);
    setFlightId(null);
  }
  function openView(v: View) {
    setView(v);
    setQuery("");
    setChaos(false);
    setSelected(null);
    setFlightId(null);
  }

  function makeEvent(
    type: string,
    actor: string,
    severity: Severity,
    msg: string,
    extra: { node?: string; data?: unknown; offset?: number } = {},
  ): EventDoc {
    return {
      id: `local-${Date.now().toString(36)}-${++seq.current}`,
      ts: Date.now() + (extra.offset ?? 0),
      type,
      actor,
      severity,
      msg,
      node: extra.node,
      data: extra.data,
    };
  }
  const prepend = (p: LocalPatch, ...events: EventDoc[]) =>
    [...events.sort((a, b) => b.ts - a.ts), ...p.events].slice(0, 200);

  function schedule(faultId: string, ms: number, fn: () => void) {
    const id = window.setTimeout(fn, ms);
    timers.current.set(faultId, [...(timers.current.get(faultId) ?? []), id]);
  }
  function clearFaultTimers(faultId: string) {
    timers.current.get(faultId)?.forEach((t) => clearTimeout(t));
    timers.current.delete(faultId);
  }
  function clearAllTimers() {
    for (const list of timers.current.values()) list.forEach((t) => clearTimeout(t));
    timers.current.clear();
  }

  /** Try the host; on example/cold data or any failure, run `fallback` locally. */
  async function command(label: string, url: string, body: object | undefined, fallback: () => void) {
    setError("");
    if (localMode) {
      fallback();
      return;
    }
    setBusy(true);
    try {
      await post(url, body);
    } catch (e) {
      setNotice(
        `Host unreachable (${e instanceof Error ? e.message : String(e)}) — ${label} executed in the local sim.`,
      );
      fallback();
    } finally {
      setBusy(false);
    }
  }

  function runLocalFault(type: FaultType, target: string, dep?: string) {
    const fault = planFault(baseRef.current, `f${Date.now().toString(36)}${++seq.current}`, type, target, dep);
    const ts = Date.now();
    const affected = Object.keys(fault.failures);
    const invs = [...baseRef.current.invariants.values()];
    const newViolations: Record<string, ViolationDoc> = {};
    for (const n of affected) {
      const fl = fault.failures[n];
      const inv = invs.find((i) => i.node === n && (fl.kinds === "all" || fl.kinds.includes(i.kind)));
      const id = `local-${fault.id}-${n}`;
      newViolations[id] = {
        id,
        invariant: inv?.id ?? `inv-${n}-${fl.kinds === "all" ? "http_status" : fl.kinds[0]}`,
        node: n,
        detail: fl.detail,
        firstSeen: ts,
        lastSeen: ts,
        count: 1,
        status: "open",
      };
    }
    fault.violationIds = Object.keys(newViolations);
    const failingProofs = invs.filter((i) => {
      const fl = fault.failures[i.node];
      return fl && (fl.kinds === "all" || fl.kinds.includes(i.kind));
    }).length;
    const taskId = `task-local-${fault.id}`;
    const distress = type === "kill" || affected.includes("dispatch") || affected.includes("ops-radar");
    const events = [
      makeEvent("chaos", "operator", "crit", `chaos: ${type} ${target}${dep ? ` → ${dep}` : ""} — ${fault.failures[target]?.detail ?? "fault injected"} (local sim)`, { node: target, data: { type, target, dep } }),
      makeEvent("violation", "runner-01", "crit", `${failingProofs || affected.length} proofs failing across ${affected.length} system${affected.length === 1 ? "" : "s"} — violations opened`, { node: target, offset: 1, data: { affected } }),
      ...(distress
        ? [
            makeEvent("distress", "artex-adt", "warn", `ARTEX ELT-5000 ADT TRIGGERED — dispatch/ops-radar proofs failing · 406 MHz burst + GADSS 1-min position lock${lockFlight ? ` (${lockFlight.callsign} ${lockFlight.position.lat.toFixed(2)}, ${lockFlight.position.lon.toFixed(2)})` : ""}`, { node: affected.includes("dispatch") ? "dispatch" : "ops-radar", offset: 2 }),
          ]
        : []),
      makeEvent("triage", "orchestrator-01", "warn", `root cause ${target} (${fault.type}) — ${Math.max(0, affected.length - 1)} dependents suppressed · dispatching skill ${fault.skill}`, { node: target, offset: 3, data: { skill: fault.skill, target, blast: affected } }),
    ];
    setPatch((p) => ({
      ...p,
      faults: [...p.faults, fault],
      violations: { ...p.violations, ...newViolations },
      tasks: {
        ...p.tasks,
        [taskId]: {
          id: taskId,
          kind: "remediate",
          target,
          skill: fault.skill,
          priority: 5,
          status: "pending",
          attempts: 0,
          createdBy: "orchestrator-01",
        },
      },
      agents: patchAgents(p.agents, { orchestrator: { state: "working", bump: 1 }, runner: { bump: 1 } }),
      events: prepend(p, ...events),
    }));
    schedule(fault.id, 1800, () => remediate(fault.id));
    schedule(fault.id, 4500, () => heal(fault.id, false));
  }

  function remediate(faultId: string) {
    setPatch((p) => {
      const fault = p.faults.find((f) => f.id === faultId);
      if (!fault) return p;
      const taskId = `task-local-${fault.id}`;
      const step = SKILL_FIRST_STEP[fault.skill] ?? { action: "repair", steps: 3 };
      const violations = { ...p.violations };
      for (const id of fault.violationIds)
        if (violations[id]) violations[id] = { ...violations[id], status: "remediating", lastSeen: Date.now(), count: violations[id].count + 1 };
      const task = p.tasks[taskId];
      return {
        ...p,
        violations,
        tasks: task ? { ...p.tasks, [taskId]: { ...task, status: "claimed", claimedBy: "response-01", attempts: 1, leaseUntil: Date.now() + 15000 } } : p.tasks,
        agents: patchAgents(p.agents, { response: { state: "working", task: taskId, bump: 1 } }),
        events: prepend(
          p,
          makeEvent("task", "response-01", "info", `claimed ${taskId} (CAS lease 15s) — loading skill ${fault.skill}`, { node: fault.target }),
          makeEvent("remediate", "response-01", "warn", `executing ${fault.skill} step 1/${step.steps}: ${step.action} ${fault.target}`, { node: fault.target, offset: 1, data: { skill: fault.skill } }),
        ),
      };
    });
  }

  function heal(faultId: string, manual: boolean) {
    clearFaultTimers(faultId);
    setPatch((p) => {
      const fault = p.faults.find((f) => f.id === faultId);
      if (!fault) return p;
      const taskId = `task-local-${fault.id}`;
      const step = SKILL_FIRST_STEP[fault.skill] ?? { action: "repair", steps: 3 };
      const resolvedBy = manual ? "operator" : "response-01";
      const violations = { ...p.violations };
      for (const id of fault.violationIds)
        if (violations[id])
          violations[id] = { ...violations[id], status: "resolved", resolvedBy, resolution: fault.resolution, lastSeen: Date.now() };
      const task = p.tasks[taskId];
      const systems = Object.keys(fault.health).length;
      return {
        ...p,
        faults: p.faults.filter((f) => f.id !== faultId),
        violations,
        tasks: task ? { ...p.tasks, [taskId]: { ...task, status: "done", claimedBy: task.claimedBy ?? resolvedBy, result: fault.resolution } } : p.tasks,
        agents: patchAgents(p.agents, {
          response: { state: "idle", task: null, bump: 2 },
          runner: { bump: 1 },
          orchestrator: { state: p.faults.length > 1 ? "working" : "idle" },
        }),
        events: prepend(
          p,
          makeEvent("action", resolvedBy, "info", manual ? `operator resolved ${fault.target} manually` : `${step.action} ${fault.target}${fault.skill === "hub-failover" ? " → unimatic-standby" : ""} — ok`, { node: fault.target }),
          makeEvent("verify", "runner-01", "info", `re-ran proofs on ${systems} system${systems === 1 ? "" : "s"} — all passing`, { node: fault.target, offset: 1 }),
          makeEvent("resolved", resolvedBy, "info", `${fault.violationIds.length} violation${fault.violationIds.length === 1 ? "" : "s"} resolved by ${resolvedBy}`, { node: fault.target, offset: 2 }),
          makeEvent("mission", "orchestrator-01", "info", `mission: resolved — ${fault.resolution}`, { node: fault.target, offset: 3 }),
        ),
      };
    });
  }

  function inject(type: FaultType, target: string, dep?: string) {
    setChaos(false);
    // A fault that matches a stress scenario on a ready estate runs as a tracked
    // rehearsal, so the recovery is verified and lands in the evidence record.
    const scenario = live.rehearsal?.ready
      ? live.rehearsal.scenarios.find((s) => s.fault.type === type && s.fault.target === target && (s.fault.dep ?? undefined) === dep)
      : undefined;
    if (scenario) return void command(`${type} ${target}`, "/api/rehearsal", { scenario: scenario.id }, () => runLocalFault(type, target, dep));
    void command(`${type} ${target}`, "/api/chaos", { type, target, ...(dep ? { dep } : {}) }, () =>
      runLocalFault(type, target, dep),
    );
  }
  function injectOn(id: string) {
    const f = FAULTS.find((x) => x.target === id);
    inject(f?.type ?? "kill", id, f?.dep);
  }
  function reset() {
    setChaos(false);
    const localReset = () => {
      clearAllTimers();
      setPatch({ ...emptyPatch(), events: [makeEvent("mission", "operator", "info", "reset — local estate restored to nominal, all faults cleared")] });
    };
    if (localMode) return void command("reset", "/api/reset", undefined, localReset);
    clearAllTimers();
    setPatch(emptyPatch());
    void command("reset", "/api/reset", undefined, localReset);
  }
  function launch() {
    void command("launch", "/api/launch", undefined, () =>
      setPatch((p) => ({
        ...p,
        mission: { launched: true, launchedAt: Date.now() },
        events: prepend(p, makeEvent("mission", "operator", "info", `mission launched — local sim swarm (${board.agents.size} agents), provider SIM`)),
      })),
    );
  }
  function syncAdsb() {
    void command("ADS-B sync", "/api/flights/live", undefined, () =>
      setPatch((p) => ({
        ...p,
        events: prepend(p, makeEvent("probe", "recon-01", "info", `ADS-B sync: live open-source feed unreachable from local sim — replaying cached North America seed (${board.flights.flights.length} aircraft)`)),
      })),
    );
    if (!localMode) setNotice("Live open-source ADS-B sync requested from host.");
  }
  function resolveViolation(v: ViolationDoc) {
    const fault = patch.faults.find((f) => f.violationIds.includes(v.id));
    if (fault) return heal(fault.id, true);
    void command("resolve", "/api/resolve", { violationId: v.id }, () =>
      setPatch((p) => ({
        ...p,
        violations: { ...p.violations, [v.id]: { ...v, status: "resolved", resolvedBy: "operator", resolution: "manually resolved (local sim)", lastSeen: Date.now() } },
        events: prepend(p, makeEvent("resolved", "operator", "info", `operator resolved ${v.node}: ${v.detail}`, { node: v.node })),
      })),
    );
  }

  // ---- render pieces -------------------------------------------------------
  const healthBadge = (h: Health) => (
    <span className={`health-badge ${h}`}>
      <span className={`health-dot ${h}`} />
      {HEALTH_LABEL[h]}
    </span>
  );

  const eventRow = (e: EventDoc, compact = false) => (
    <article className={`activity-entry ${e.severity}`} key={e.id}>
      <span className={`activity-mark ${e.severity === "crit" ? "alert" : e.severity === "warn" ? "warn" : ""}`}>
        <HugeiconsIcon
          icon={
            e.type === "probe" || e.type === "recon"
              ? Search01Icon
              : e.type === "verify" || e.type === "resolved"
                ? CheckmarkCircle01Icon
                : e.type === "distress"
                  ? Satellite01Icon
                  : e.type === "chaos"
                    ? FlashIcon
                    : e.severity === "crit"
                      ? Alert02Icon
                      : Activity01Icon
          }
          size={15}
        />
      </span>
      <div className="activity-body">
        <div>
          <strong>{e.actor}</strong>
          <span className="event-type">{e.type}</span>
          {e.node && <span className="event-node">{e.node}</span>}
          <time title={new Date(e.ts).toLocaleTimeString()}>{relTime(e.ts)}</time>
        </div>
        <p>{e.msg}</p>
        {!compact && e.data !== undefined && (
          <details>
            <summary>Payload</summary>
            <pre>{JSON.stringify(e.data, null, 2)}</pre>
          </details>
        )}
      </div>
    </article>
  );

  const tasksDone = [...board.tasks.values()].filter((t) => t.status === "done").length;
  const kpis: { label: string; value: number; total: number; unit?: string; tone: "ok" | "info" | "warn" | "bad"; view: View }[] = [
    { label: "Systems online", value: upNodes, total: nodes.length, tone: upNodes === nodes.length ? "ok" : "bad", view: "Topology" },
    { label: "Proofs passing", value: passed, total: checks.length, tone: percent === 100 ? "ok" : percent >= 60 ? "warn" : "bad", view: "Verification" },
    { label: "Open violations", value: open.length, total: Math.max(violations.length, open.length), unit: "raised this mission", tone: open.length ? "bad" : "ok", view: "Blackboard" },
    { label: "Swarm actions", value: tasksDone, total: board.tasks.size, tone: "info", view: "Swarm" },
  ];
  const missionControl = (
    <div className="mission-control">
      <section className="kpi-row" aria-label="Mission impact counters">
        {kpis.map((k) => {
          const ticks = 36;
          const lit = k.total ? Math.round((k.value / k.total) * ticks) : 0;
          return (
            <button key={k.label} className={`kpi-card ${k.tone}`} onClick={() => openView(k.view)}>
              <span className="kpi-label">{k.label}</span>
              <strong className="kpi-value">{k.value}</strong>
              <span className="kpi-foot">
                <span>of {k.total} {k.unit ?? "total"}</span>
                {!k.unit && <span><b>{k.value}</b> /{k.total}</span>}
              </span>
              <span className="kpi-ticks" aria-hidden="true">
                {Array.from({ length: ticks }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)}
              </span>
            </button>
          );
        })}
      </section>
      <div className="mc-grid">
        <section className="mc-panel systems-matrix" aria-label="Aviation estate systems">
          <header className="mc-panel-header">
            <h2>Estate systems</h2>
            <span>
              {upNodes}/{nodes.length} online · {edgesList.length} links
            </span>
          </header>
          <div className="systems-matrix-head" role="row">
            <span>Hub</span>
            <span>System</span>
            <span>Status</span>
            <span>Upstream</span>
            <span>Proofs</span>
            <span />
          </div>
          {nodes.map((n) => {
            const meta = SYSTEMS[n.id];
            const pr = proofs.get(n.id) ?? { pass: 0, total: 0 };
            const deps = depsOf(n.id);
            return (
              <div key={n.id} className={`system-row ${n.health} ${selected === n.id ? "selected" : ""}`} role="row">
                <span className="system-hub">
                  <strong>{meta?.code ?? n.kind.toUpperCase()}</strong>
                  <small>{meta?.city ?? "—"}</small>
                </span>
                <span className="system-name">
                  <strong>{n.name}</strong>
                  <small>{meta?.role ?? n.kind}</small>
                </span>
                <span>{healthBadge(n.health)}</span>
                <span className="system-deps">
                  {deps.length
                    ? deps.map((d) => (
                        <span key={d} className={`dep-chip ${board.nodes.get(d)?.health ?? "up"} ${severed.has(`${n.id}-${d}`) ? "severed" : ""}`}>
                          {severed.has(`${n.id}-${d}`) && <HugeiconsIcon icon={Unlink01Icon} size={11} />}
                          {d}
                        </span>
                      ))
                    : <span className="dep-chip root">ROOT</span>}
                </span>
                <span className={`system-proofs ${pr.pass < pr.total ? "text-alert" : ""}`}>
                  {pr.pass}/{pr.total}
                </span>
                <span className="system-actions">
                  <button className="mini-btn" onClick={() => inspect(n.id)} aria-label={`Inspect ${n.name}`}>
                    Inspect
                  </button>
                </span>
              </div>
            );
          })}
          {!nodes.length && <div className="content-empty">No systems discovered yet — launch the swarm.</div>}
        </section>


        <section className="mc-panel triage-feed-panel" aria-label="Incident triage">
          <div className={`artex-panel ${artexTriggered ? "triggered" : "armed"}`}>
            <header className="mc-panel-header">
              <h2>
                <HugeiconsIcon icon={Satellite01Icon} size={15} /> ARTEX distress & GADSS
              </h2>
              <span className={`status-pill ${artexTriggered ? "alert" : ""}`}>{artexTriggered ? "TRIGGERED" : "ARMED"}</span>
            </header>
            <dl className="artex-telemetry">
              <div><dt>Frequency</dt><dd>406.025 MHz · 121.5 MHz homing</dd></div>
              <div><dt>GADSS mode</dt><dd>{artexTriggered ? "Distress tracking · 1-min position" : "Normal tracking · 15-min position"}</dd></div>
              <div><dt>Coupled proofs</dt><dd className={coupledPass < coupled.length ? "text-alert" : ""}>{coupledPass}/{coupled.length} dispatch + ops-radar</dd></div>
              <div>
                <dt>Position lock</dt>
                <dd>
                  {artexTriggered && lockFlight
                    ? `${lockFlight.callsign} · ${lockFlight.position.lat.toFixed(3)}, ${lockFlight.position.lon.toFixed(3)}`
                    : "Standby — no lock"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="blackboard-summary">
            <header className="mc-panel-header">
              <h2>
                <HugeiconsIcon icon={Database01Icon} size={15} /> Blackboard
              </h2>
              <span>{dataMode}</span>
            </header>
            <div className="blackboard-summary-grid">
              {COLLECTIONS.map((c) => (
                <button
                  key={c}
                  className={`collection-tile ${c === "violations" && open.length ? "alert" : ""}`}
                  onClick={() => {
                    setCollection(c);
                    openView("Blackboard");
                  }}
                >
                  <span>{c}</span>
                  <strong>{collectionDocs[c].length}</strong>
                </button>
              ))}
            </div>
          </div>

          <div className="remediation-feed">
            <header className="mc-panel-header">
              <h2>
                <HugeiconsIcon icon={Activity01Icon} size={15} /> Live remediation
              </h2>
              <span className={open.length ? "text-alert" : ""}>{open.length} open</span>
            </header>
            <OperationalSummary enabled={live.connected && !localMode && !localOverride} />
            <ResponseTrace events={board.events} />
            {open.map((v) => (
              <div key={v.id} className={`violation-row ${v.status}`}>
                <HugeiconsIcon icon={Alert02Icon} size={14} />
                <span>
                  <strong>{v.node}</strong>
                  <small>{v.detail}</small>
                </span>
                <span className="status-pill alert">{v.status}</span>
                <button className="mini-btn" disabled={busy} onClick={() => resolveViolation(v)}>
                  Resolve
                </button>
              </div>
            ))}
            {!open.length && (
              <div className="violation-row clear">
                <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} />
                <span>
                  <strong>No open violations</strong>
                  <small>{violations.length ? `${violations.length} resolved this mission` : "All proofs satisfied"}</small>
                </span>
              </div>
            )}
            {(() => {
              const active = [...board.tasks.values()].filter((t) => t.status !== "done" && t.status !== "failed").sort((a, b) => b.priority - a.priority).slice(0, 4);
              if (!active.length) return null;
              return (
                <div className="response-strip">
                  <span className="response-strip-label">Active response</span>
                  {active.map((t) => (
                    <div key={t.id} className={`response-task ${t.status}`}>
                      <span className={`health-dot ${t.status === "failed" ? "down" : t.status === "claimed" ? "degraded" : "idle"}`} />
                      <span className="response-task-main">
                        <strong>{t.skill ?? t.kind}</strong>
                        <small>{t.target}{t.claimedBy ? ` · ${t.claimedBy}` : " · unclaimed"}</small>
                      </span>
                      <span className="status-pill">{t.status.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="activity-stream compact">{board.events.slice(0, 6).map((e) => eventRow(e, true))}</div>
            <button className="incident-link" onClick={() => openView("Blackboard")}>
              Open full activity stream
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );

  const airspace = (
    <>
      <div className="regional-map">
        {map ? (
          <RadarMap
            flights={board.flights}
            nodes={board.nodes}
            selected={flightId}
            region={region}
            onSelect={(id) => {
              setSelected(null);
              setFlightId(id);
            }}
            onSelectNode={(id) => inspect(id)}
          />
        ) : (
          <Suspense
            fallback={
              <GlobeFallback
                flights={board.flights}
                nodes={board.nodes}
                selected={flightId}
                region={region}
                onSelect={setFlightId}
                onSelectNode={(id) => inspect(id)}
              />
            }
          >
            <AviationGlobe
              flights={board.flights}
              nodes={board.nodes}
              selected={flightId}
              region={region}
              onSelect={(id) => {
                setSelected(null);
                setFlightId(id);
              }}
              onSelectNode={(id) => inspect(id)}
            />
          </Suspense>
        )}
      </div>
      <div className="map-toolbar glass-surface">
        <HugeiconsIcon icon={Location01Icon} size={16} />
        <select aria-label="Map region" value={region} onChange={(e) => setRegion(e.target.value as RegionId)}>
          <option value="regional">North America</option>
          <option value="northeast">Northeast Corridor (ORD-YYZ-JFK-BOS)</option>
          <option value="west">West Coast Corridor</option>
          <option value="atlantic">North Atlantic</option>
          <option value="global">Global</option>
        </select>
        <div className="toolbar-divider" />
        <button className={!map ? "active" : ""} aria-label="3D globe" aria-pressed={!map} onClick={() => setMap(false)}>
          <HugeiconsIcon icon={Globe02Icon} size={16} />
          3D GLOBE
        </button>
        <button className={map ? "active" : ""} aria-label="2D radar" aria-pressed={map} onClick={() => setMap(true)}>
          <HugeiconsIcon icon={Radar01Icon} size={16} />
          2D RADAR
        </button>
        <div className="toolbar-divider" />
        <button disabled={busy} onClick={syncAdsb}>
          <HugeiconsIcon icon={Airplane01Icon} size={16} />
          SYNC LIVE ADS-B
        </button>
      </div>
      {!node && !flight && (
        <details className="overview-card glass-surface" aria-label="North America airspace telemetry" open={airspaceExpanded} onToggle={event => setAirspaceExpanded(event.currentTarget.open)}>
          <summary className="card-heading">
            <span>North America Airspace</span>
            <span className={`status-pill ${condition === "DEGRADED" ? "alert" : ""}`}>
              <span className={`health-dot ${condition === "NOMINAL" ? "up" : condition === "DEGRADED" ? "down" : "idle"}`} />
              {condition}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
          </summary>
          <div className="overview-metrics">
            <div className="stat-card">
              <span>Enroute</span>
              <strong>
                {enrouteCount}
                <small>/ {board.flights.flights.length}</small>
              </strong>
              <div className="stat-meter"><i style={{ width: `${board.flights.flights.length ? Math.round((enrouteCount / board.flights.flights.length) * 100) : 0}%` }} /></div>
            </div>
            <div className="stat-card">
              <span>Systems</span>
              <strong>
                {upNodes}
                <small>/ {nodes.length}</small>
              </strong>
              <div className="stat-meter"><i className={upNodes === nodes.length ? "ok" : upNodes / Math.max(1, nodes.length) > 0.5 ? "warn" : "alert"} style={{ width: `${nodes.length ? Math.round((upNodes / nodes.length) * 100) : 0}%` }} /></div>
            </div>
            <div className="stat-card">
              <span>Proofs</span>
              <strong>
                {passed}
                <small>/ {checks.length}</small>
              </strong>
              <div className="stat-meter"><i className={percent === 100 ? "ok" : percent >= 60 ? "warn" : "alert"} style={{ width: `${percent}%` }} /></div>
            </div>
          </div>
          <div className="overview-flights">
            <HugeiconsIcon icon={Airplane01Icon} size={14} />
            {board.flights.groundStop ? "Ground stop — dispatch unavailable" : "Releases flowing"}
            <span>{board.flights.staleFeed ? "Radar feed STALE" : "Radar feed 1 Hz"}</span>
          </div>
          <details className="airspace-summary"><summary>Operational summary</summary><OperationalSummary enabled={airspaceExpanded && live.connected && !localMode && !localOverride} /></details>
          <div className="overview-actions">
            <button className="mini-btn" onClick={goHome}>
              Mission Control
            </button>
            <button className="mini-btn" onClick={() => openView("Topology")}>
              Topology
            </button>
          </div>
        </details>
      )}
      {board.flights.groundStop && (
        <div className="ground-stop glass-surface">
          <span className="health-dot down" />
          Ground stop<small>Dispatch unavailable</small>
        </div>
      )}
      <div className="map-bottom-label">
        <span className={`health-dot ${localMode ? "idle" : "up"}`} />
        {dataMode}
        <span>·</span>
        {board.flights.staleFeed ? "Stale" : "1 Hz"}
      </div>
    </>
  );

  const topology = (
    <div className="topology-workspace">
      <TopologyDag
        board={board}
        severed={severed}
        selected={selected}
        proofs={proofs}
        artexTriggered={artexTriggered}
        onInspect={inspect}
        onFleet={() => openView("Airspace")}
        onArtex={goHome}
      />
      {!nodes.length && <div className="content-empty">No systems</div>}
      <div className="graph-legend">
        <span><i className="health-dot up" />Online</span>
        <span><i className="health-dot degraded" />Degraded</span>
        <span><i className="health-dot down" />Offline</span>
        <span><i className="legend-wire" />Dependency → dependent</span>
        <span className="text-alert"><i className="legend-wire severed" />Severed</span>
      </div>
    </div>
  );

  const verification = (
    <div className="content-scroll">
      <div className="filter-pill-bar" role="toolbar" aria-label="Proof filters">
        {(
          [
            ["ALL", `ALL (${checks.length})`],
            ["FAILING", `FAILING (${failing})`],
            ["PASSING", `PASSING (${passed})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`filter-pill ${statusFilter === key ? "active" : ""} ${key === "FAILING" && failing ? "alert" : ""}`}
            aria-pressed={statusFilter === key}
            onClick={() => setStatusFilter(key)}
          >
            {label}
          </button>
        ))}
        <span className="toolbar-divider" />
        <select aria-label="Filter by system" className="filter-select" value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)}>
          <option value="ALL">ALL SYSTEMS</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id}
            </option>
          ))}
        </select>
        <button className={`filter-pill ${showSpecs ? "active" : ""}`} aria-pressed={showSpecs} onClick={() => setShowSpecs((s) => !s)}>
          FORMAL BEHAVIORAL SPECS ({board.specs.size})
        </button>
      </div>
      {!showSpecs && (
        <div className="verification-summary" role="toolbar" aria-label="Proof health by system">
          {nodes.map((n) => {
            const p = proofs.get(n.id) ?? { pass: 0, total: 0 };
            const failingNode = p.pass < p.total;
            const ratio = p.total ? p.pass / p.total : 0;
            return (
              <button
                key={n.id}
                className={`vs-node-tile ${nodeFilter === n.id ? "active" : ""} ${failingNode ? "failing" : ""}`}
                aria-pressed={nodeFilter === n.id}
                onClick={() => setNodeFilter(nodeFilter === n.id ? "ALL" : n.id)}
              >
                <span className="vs-name">{n.id}</span>
                <span className="vs-ratio">{p.pass}/{p.total}</span>
                <span className="vs-bar"><span style={{ width: `${ratio * 100}%` }} /></span>
              </button>
            );
          })}
        </div>
      )}
      {showSpecs ? (
        <div className="spec-grid">
          {[...board.specs.values()]
            .filter((s) => nodeFilter === "ALL" || s.node === nodeFilter)
            .map((s) => (
              <article key={s.id} className="spec-card">
                <header>
                  <span className={`health-dot ${board.nodes.get(s.node)?.health ?? "idle"}`} />
                  <h3>{s.title}</h3>
                  <span className="status-pill">v{s.version}</span>
                </header>
                <small>
                  {s.node} · authored by {s.authoredBy}
                </small>
                <div className="spec-plain">
                  {s.invariants.length} executable invariant{s.invariants.length === 1 ? "" : "s"} · {s.invariants.filter((id) => board.invariants.get(id)?.lastResult === "pass").length} passing · {s.invariants.filter((id) => board.invariants.get(id)?.lastResult === "fail").length} failing
                </div>
                <details className="spec-contract">
                  <summary>Contract text · v{s.version}</summary>
                  <pre>{s.body}</pre>
                </details>
                <div className="spec-invariants">
                  {s.invariants.map((id) => {
                    const inv = board.invariants.get(id);
                    return (
                      <span key={id} className={`dep-chip ${inv?.lastResult === "fail" ? "down" : "up"}`}>
                        {inv ? KIND_LABELS[inv.kind] : id}
                      </span>
                    );
                  })}
                </div>
              </article>
            ))}
          {!board.specs.size && <div className="content-empty">No specs authored yet</div>}
        </div>
      ) : (
        <div className="proof-table">
          <div className="proof-table-heading">
            <span>Component</span>
            <span>Proof</span>
            <span>Status</span>
            <span>Receipt</span>
          </div>
          {filteredChecks.map((i) => (
            <button className={`proof-table-row ${i.lastResult === "fail" ? "failing" : ""}`} key={i.id} onClick={() => inspect(i.node)}>
              <span>
                {i.node}
                <small className="text-muted"> {SYSTEMS[i.node]?.code ?? ""}</small>
              </span>
              <span>
                {KIND_LABELS[i.kind]}
                <small className="text-muted"> {i.kind}</small>
              </span>
              <span className={`status-pill ${i.lastResult === "fail" ? "alert" : ""}`}>{i.lastResult ?? "pending"}</span>
              <span className="receipt-text">
                {i.lastDetail ?? "—"}
                <small>
                  {i.runs} runs · every {i.intervalMs / 1000}s · {i.authoredBy}
                </small>
              </span>
            </button>
          ))}
          {!filteredChecks.length && <div className="content-empty">No checks match</div>}
        </div>
      )}
    </div>
  );

  const swarm = (
    <div className="content-scroll">
      <RehearsalConsole board={board} enabled={live.connected && !localMode && !localOverride} onLaunch={launch} onInspect={inspect} />
      <section className="swarm-trace mc-panel" aria-label="Live incident trace">
        <header className="mc-panel-header">
          <h2>LIVE INCIDENT TRACE</h2>
          <span>{board.provider === "gemini" ? "GEMINI" : "SIM"} REASONING</span>
        </header>
        <ResponseTrace events={board.events} />
      </section>
      <div className="agent-cards">
        {[...board.agents.values()].map((a: AgentDoc) => {
          const latest = board.events.find((e) => e.actor === a.id);
          const task = a.task ? board.tasks.get(a.task) : undefined;
          return (
            <section key={a.id} className={`agent-tile ${a.state}`}>
              <div>
                <HugeiconsIcon icon={ROLE_ICONS[a.role] ?? AiNetworkIcon} size={18} />
                <span className={`status-pill ${a.state === "dead" ? "alert" : ""}`}>{a.state}</span>
              </div>
              <h2>{a.id}</h2>
              <span>{a.role}</span>
              <div className="agent-task">
                {task ? `${task.kind} · ${task.target}${task.skill ? ` · ${task.skill}` : ""}` : a.task ?? "No claimed task"}
              </div>
              <small>
                {a.decisions} decisions · beat {Math.max(0, Math.round((now - a.lastBeat) / 1000))}s ago
              </small>
              <p className="agent-receipt">{latest ? latest.msg : "No receipts yet"}</p>
            </section>
          );
        })}
        {!board.agents.size && <div className="content-empty">No agents — launch the swarm</div>}
      </div>
      <SwarmScale hot={hotNodes} tick={Math.floor(now / 1000)} groundStop={board.flights.groundStop} />
    </div>
  );

  const docs = collectionDocs[collection];
  const blackboard = (
    <div className="blackboard-workspace">
      <div className="blackboard-activity content-scroll">
        <div className="filter-pill-bar" role="toolbar" aria-label="Activity filters">
          {EVENT_FILTERS.map((f) => (
            <button key={f} className={`filter-pill ${eventFilter === f ? "active" : ""}`} aria-pressed={eventFilter === f} onClick={() => setEventFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="activity-stream">
          {filteredEvents.slice(0, 150).map((e) => eventRow(e))}
          {!filteredEvents.length && <div className="content-empty">No activity</div>}
        </div>
      </div>
      <section className="firestore-explorer" aria-label="Blackboard collection explorer">
        <header className="mc-panel-header">
          <h2>
            <HugeiconsIcon icon={Database01Icon} size={15} /> FIRESTORE / BLACKBOARD COLLECTIONS
          </h2>
          <span>{dataMode}</span>
        </header>
        <div className="firestore-tabs" role="tablist">
          {COLLECTIONS.map((c) => (
            <button key={c} role="tab" aria-selected={collection === c} className={`firestore-tab ${collection === c ? "active" : ""}`} onClick={() => setCollection(c)}>
              {c}
              <small>{collectionDocs[c].length}</small>
            </button>
          ))}
        </div>
        <div className="firestore-path">
          /arsu/blackboard/<strong>{collection}</strong> · {docs.length} document{docs.length === 1 ? "" : "s"}
        </div>
        <div className="firestore-docs" role="tabpanel">
          {docs.slice(0, 60).map((d, i) => (
            <details key={`${collection}-${d.id}`} className="firestore-doc" open={i === 0}>
              <summary>
                <code>{d.id}</code>
              </summary>
              <pre>{JSON.stringify(d, null, 2)}</pre>
            </details>
          ))}
          {!docs.length && <div className="content-empty">Collection is empty</div>}
        </div>
      </section>
    </div>
  );

  // ---- layout --------------------------------------------------------------
  return (
    <div className="workspace-app">
      <aside className="app-sidebar">
        <button className="workspace-brand breadcrumb-btn" aria-label="ARSU — return to Mission Control" onClick={goHome}>
          <span className="brand-symbol">
            <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 1.5 17.5 5.5v9L10 18.5 2.5 14.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.5 10h2.4l1.2-3.2 1.8 6.4 1.2-3.2h2.4" fill="none" stroke="#38bdf8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>
            ARSU<span className="brand-workspace">Attack Response Swarm Unit</span>
          </span>
          <span className="workspace-shortcut">01</span>
        </button>
        <div className="workspace-switch">
          <span className="workspace-avatar">A</span>
          <span>
            Aviation<small>North America Operations</small>
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} />
        </div>
        <div className="nav-caption">Workspace</div>
        <nav aria-label="Workspace navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              aria-label={item.id}
              aria-current={view === item.id ? "page" : undefined}
              ref={view === item.id ? activeNavigationRef : null}
              className={`nav-item ${view === item.id ? "selected" : ""}`}
              onClick={() => openView(item.id)}
            >
              <HugeiconsIcon icon={item.icon} size={18} />
              <span>{item.id}</span>
              {item.id === "Swarm" && <span className="nav-count">{board.agents.size}</span>}
              {item.id === "Verification" && open.length > 0 && <span className="nav-count alert">{open.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-title">
          <span>Systems</span>
          <span>
            {upNodes}/{nodes.length}
          </span>
        </div>
        <div className="sidebar-systems">
          {nodes.map((n) => (
            <button key={n.id} onClick={() => inspect(n.id)} className={selected === n.id ? "selected" : ""}>
              <span className={`health-dot ${n.health}`} />
              <span>{n.name}</span>
              <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
            </button>
          ))}
          {!nodes.length && <span className="quiet-empty">No systems</span>}
        </div>
        <div className="sidebar-bottom">
          <button
            className={`launch-button ${board.mission.launched ? "running" : ""}`}
            aria-label={board.mission.launched ? "Swarm running" : "Launch swarm"}
            disabled={busy}
            onClick={launch}
          >
            <HugeiconsIcon icon={board.mission.launched ? Activity01Icon : PlayIcon} size={16} />
            {board.mission.launched ? "Swarm running" : "Launch swarm"}
          </button>
          <button
            className="source-switch"
            aria-label={example ? "Switch to host telemetry" : "Switch to example data"}
            onClick={() => {
              setExample((p) => !p);
              closeInspector();
              setChaos(false);
            }}
          >
            <HugeiconsIcon icon={Database01Icon} size={15} />
            <span>{example ? "Example data" : "Host sim feed"}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
          </button>
          <div className="sidebar-connection">
            <span className={`health-dot ${live.connected && !localMode ? "up" : "idle"}`} />
            {localMode ? "Local sim" : live.connected ? "Connected" : "Reconnecting"}
            <span>{board.provider === "gemini" ? "Gemini" : "SIM"}</span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="workspace-topbar">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <button className="breadcrumb-btn" onClick={goHome}>
              Workspace
            </button>
            <span>/</span>
            <button className="breadcrumb-btn" onClick={goHome}>
              Aviation
            </button>
            <span>/</span>
            <strong>{view}</strong>
          </nav>
          <div className="topbar-actions">
            <span className={`data-mode-pill ${localMode ? "local" : localOverride ? "override" : "live"}`}>
              <span className={`health-dot ${localMode ? "idle" : "up"}`} />
              <span className="data-mode-label">{dataMode}</span>
            </span>
            <span className="mission-elapsed">T+ {clock}</span>
            <button className="icon-button" aria-label="Reset estate" title="Reset estate" disabled={busy} onClick={reset}>
              <HugeiconsIcon icon={RefreshIcon} size={15} />
            </button>
            <div className="fault-control" ref={faultRef}>
              <button
                className={`subtle-button ${chaos ? "pressed" : ""}`}
                disabled={busy}
                aria-expanded={chaos}
                onClick={() => setChaos((p) => !p)}
              >
                <HugeiconsIcon icon={Alert02Icon} size={15} />
                Inject fault
              </button>
              {chaos && (
                <div className="fault-popover glass-surface">
                  <div className="popover-label">
                    Fault injection
                    <button className="icon-button" aria-label="Close" onClick={() => setChaos(false)}>
                      <HugeiconsIcon icon={Cancel01Icon} size={13} />
                    </button>
                  </div>
                  {FAULTS.map((f) => (
                    <button key={f.type} disabled={busy} onClick={() => inject(f.type, f.target, f.dep)}>
                      <HugeiconsIcon icon={Alert02Icon} size={15} />
                      <span>
                        {f.label}
                        <small>{f.hint}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        {error && (
          <div className="workspace-error" role="alert">
            <HugeiconsIcon icon={Alert02Icon} size={16} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          </div>
        )}
        {notice && (
          <div className="workspace-notice" role="status">
            <HugeiconsIcon icon={Database01Icon} size={16} />
            <span>{notice}</span>
            <button aria-label="Dismiss notice" onClick={() => setNotice("")}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          </div>
        )}

        <main
          className={`workspace-content view-${view.toLowerCase().replace(/\s+/g, "-")} ${view === "Airspace" ? "is-map" : ""}`}
        >
          {view === "Mission Control" && missionControl}
          {view === "Airspace" && airspace}
          {view !== "Mission Control" && view !== "Airspace" && (
            <>
              <div className="content-toolbar">
                <h1>{view}</h1>
                <span className="view-count">
                  {view === "Topology"
                    ? `${nodes.length} systems · ${edgesList.length} comms links · 4 tiers`
                    : view === "Verification"
                      ? `${passed}/${checks.length} passing · ${board.specs.size} specs`
                      : view === "Pipeline"
                        ? "7 stages · live Blackboard records"
                      : view === "Swarm"
                        ? `${board.agents.size} live agents · 1,000-agent scale model`
                        : `${board.events.length} events · ${COLLECTIONS.length} collections`}
                </span>
                {(view === "Verification" || view === "Blackboard") && (
                  <label className="workspace-search">
                    <HugeiconsIcon icon={Search01Icon} size={15} />
                    <input
                      aria-label={`Search ${view.toLowerCase()}`}
                      placeholder="Search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
              </div>
              {view === "Topology" && topology}
              {view === "Verification" && verification}
              {view === "Pipeline" && <PipelineWalkthrough board={board} liveStage={pipelineStage} hostEnabled={live.connected && !localMode && !localOverride} onInspect={inspect} onLaunch={launch} />}
              {view === "Swarm" && swarm}
              {view === "Blackboard" && blackboard}
            </>
          )}
          {(node || flight) && (
            <section
              ref={inspectorRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="false"
              aria-label={node ? `${node.name} details` : `${flight?.callsign} details`}
              className="object-inspector glass-surface"
            >
              <div className="card-heading">
                <span>{node ? "Component" : "Flight"}</span>
                <button className="icon-button" aria-label="Close inspector" onClick={closeInspector}>
                  <HugeiconsIcon icon={Cancel01Icon} size={16} />
                </button>
              </div>
              {node ? (
                <>
                  <div className="inspector-title">
                    <HugeiconsIcon icon={node.kind === "hub" ? Database01Icon : Layers01Icon} size={23} />
                    <h2>{node.name}</h2>
                    {healthBadge(node.health)}
                  </div>
                  <button className="chaos-action-btn danger inspector-fault-btn" disabled={busy} onClick={() => injectOn(node.id)}>
                    <HugeiconsIcon icon={FlashIcon} size={14} />
                    Inject Fault on This Node
                  </button>
                  <dl className="object-properties">
                    <div>
                      <dt>Location</dt>
                      <dd>{SYSTEMS[node.id] ? `${SYSTEMS[node.id].code} · ${SYSTEMS[node.id].city}` : "—"}</dd>
                    </div>
                    <div>
                      <dt>Role</dt>
                      <dd>{SYSTEMS[node.id]?.role ?? node.kind}</dd>
                    </div>
                    <div>
                      <dt>ID</dt>
                      <dd>{node.id}</dd>
                    </div>
                    <div>
                      <dt>Ontology</dt>
                      <dd>{node.kind} block · blackboard node</dd>
                    </div>
                    {node.layer && <div><dt>System layer</dt><dd>{node.layer}</dd></div>}
                    {node.provenance && <>
                      <div><dt>Evidence basis</dt><dd>{node.provenance.basis} · public-reference practice</dd></div>
                      <div><dt>Manifest</dt><dd>{node.provenance.manifestPath}</dd></div>
                      <div><dt>References</dt><dd>{node.provenance.sourceIds.join(', ')}</dd></div>
                    </>}
                    <div>
                      <dt>Discovered by</dt>
                      <dd>{node.discoveredBy}</dd>
                    </div>
                    <div>
                      <dt>Mapped</dt>
                      <dd>{relTime(node.firstSeen)}</dd>
                    </div>
                    <div>
                      <dt>Last probe</dt>
                      <dd>{relTime(node.lastProbe)}</dd>
                    </div>
                  </dl>
                  <div className="inspector-section">
                    <h3>Connections</h3>
                    <DepsGraph
                      id={node.id}
                      deps={depsOf(node.id)}
                      dependents={dependentsOf(node.id)}
                      severed={severed}
                      nodes={board.nodes}
                      onInspect={inspect}
                    />
                  </div>
                  <p className="inspector-description">{SYSTEMS[node.id]?.fn ?? node.description}</p>
                  <div className="inspector-section">
                    <h3>
                      Verification
                      <span>
                        {proofs.get(node.id)?.pass ?? 0}/{proofs.get(node.id)?.total ?? 0}
                        <button
                          className="mini-btn"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            setNodeFilter(node.id);
                            setView("Verification");
                          }}
                        >
                          Open proofs
                        </button>
                      </span>
                    </h3>
                    {checks
                      .filter((i) => i.node === node.id)
                      .map((i) => (
                        <details className="inspector-proof" key={i.id}>
                          <summary>
                            <HugeiconsIcon icon={i.lastResult === "fail" ? Alert02Icon : Shield01Icon} size={14} />
                            <span>{KIND_LABELS[i.kind]}</span>
                            <span className={i.lastResult === "fail" ? "text-alert" : "text-muted"}>{i.lastResult ?? "pending"}</span>
                          </summary>
                          <p>{i.lastDetail ?? "—"}</p>
                          <pre>{JSON.stringify(i.params, null, 2)}</pre>
                          <small>
                            {i.authoredBy} · {i.runs} runs
                          </small>
                        </details>
                      ))}
                  </div>
                  {[...board.specs.values()]
                    .filter((s) => s.node === node.id)
                    .map((s) => (
                      <details className="inspector-section" key={s.id}>
                        <summary>
                          {s.title} · v{s.version}
                        </summary>
                        <pre>{s.body}</pre>
                      </details>
                    ))}
                  <div className="inspector-section">
                    <h3>Evidence</h3>
                    {node.evidence.map((e, i) => (
                      <p className="evidence-receipt" key={i}>
                        {e}
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                flight && (
                  <>
                    <div className="inspector-title">
                      <HugeiconsIcon icon={Airplane01Icon} size={23} />
                      <h2>{flight.callsign}</h2>
                      <span className="status-pill">{flight.status}</span>
                    </div>
                    <div className="flight-route">
                      <span>{flight.from.code}</span>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={20} />
                      <span>{flight.to.code}</span>
                    </div>
                    <dl className="object-properties">
                      <div>
                        <dt>Route progress</dt>
                        <dd>{Math.round(flight.t * 100)}%</dd>
                      </div>
                      <div>
                        <dt>Heading</dt>
                        <dd>{Math.round(flight.heading)}°</dd>
                      </div>
                      <div>
                        <dt>Latitude</dt>
                        <dd>{flight.position.lat.toFixed(3)}</dd>
                      </div>
                      <div>
                        <dt>Longitude</dt>
                        <dd>{flight.position.lon.toFixed(3)}</dd>
                      </div>
                      <div>
                        <dt>Dispatch</dt>
                        <dd>{board.flights.groundStop ? "Hold" : "Normal"}</dd>
                      </div>
                      <div>
                        <dt>ARTEX</dt>
                        <dd>{artexTriggered ? "Distress tracking" : "Armed"}</dd>
                      </div>
                    </dl>
                  </>
                )
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
