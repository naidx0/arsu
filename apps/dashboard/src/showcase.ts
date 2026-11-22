// Showcase board — a fully populated, deterministic snapshot of a launched
// mission. Used for the "Example data" toggle and as the cold-start fallback
// when the host socket has not connected yet, so every view always has
// complete, realistic data (nodes, edges, proofs, specs, skills, tasks,
// agents, events, flights). Shapes mirror packages/core types exactly.

import type { Board } from "./api";
import type {
  AgentDoc,
  EdgeDoc,
  EventDoc,
  InvariantDoc,
  InvariantKind,
  NodeDoc,
  NodeKind,
  SkillDoc,
  SpecDoc,
  TaskDoc,
} from "@arsu/core";
import seed from "../../../data/flights.seed.json";

type Definition = {
  id: string;
  name: string;
  kind: NodeKind;
  deps: string[];
  hub: string;
  purpose: string;
};

const DEFINITIONS: Definition[] = [
  {
    id: "unimatic",
    name: "Unimatic flight information hub",
    kind: "hub",
    deps: [],
    hub: "KORD · Chicago",
    purpose:
      "Single source of truth for flight plans, tail assignments and schedule revisions.",
  },
  {
    id: "unimatic-standby",
    name: "Unimatic standby replica",
    kind: "store",
    deps: [],
    hub: "KDEN · Denver",
    purpose:
      "Warm replica of the hub dataset; promoted to primary by hub-failover.",
  },
  {
    id: "weight-balance",
    name: "Weight & balance",
    kind: "worker",
    deps: ["unimatic"],
    hub: "KATL · Atlanta",
    purpose:
      "Computes load sheets, centre of gravity and take-off weight for each departure.",
  },
  {
    id: "crew-sched",
    name: "Crew scheduling",
    kind: "worker",
    deps: ["unimatic"],
    hub: "KDFW · Dallas",
    purpose: "Assigns crews and checks duty-time legality before release.",
  },
  {
    id: "pax-connect",
    name: "Passenger services",
    kind: "worker",
    deps: ["unimatic"],
    hub: "CYYZ · Toronto",
    purpose: "Passenger manifests, rebooking and connection protection.",
  },
  {
    id: "dispatch",
    name: "Flight dispatch",
    kind: "worker",
    deps: ["unimatic", "weight-balance", "crew-sched", "notam"],
    hub: "KJFK · New York",
    purpose:
      "Release authority — no aircraft departs without a dispatch release.",
  },
  {
    id: "notam",
    name: "NOTAM feed",
    kind: "feed",
    deps: [],
    hub: "KBOS · Boston",
    purpose: "FAA NOTAM ingest — runway, airspace and navaid restrictions.",
  },
  {
    id: "ops-radar",
    name: "Position telemetry",
    kind: "feed",
    deps: ["unimatic"],
    hub: "KSFO · San Francisco",
    purpose: "ADS-B aircraft positions for the ops floor and airspace map.",
  },
];

const DETAILS: Record<InvariantKind, (d: Definition) => string> = {
  http_status: () => "HTTP 200",
  latency_lt: (d) => `${12 + d.id.length}ms / 800ms budget`,
  dep_health: (d) => `dependency ${dependencyFor(d)} up`,
  data_field: () => "rev field present · schema v3",
  consistency: () => "rev matches unimatic hub",
};

function dependencyFor(d: Definition): string {
  // Dispatch's most fragile link is the external NOTAM feed.
  return d.id === "dispatch" ? "notam" : (d.deps[0] ?? "");
}

function kindsFor(d: Definition): InvariantKind[] {
  const kinds: InvariantKind[] = ["http_status", "latency_lt", "data_field"];
  if (d.deps.length) kinds.push("dep_health");
  if (d.id === "ops-radar" || d.id === "unimatic-standby")
    kinds.push("consistency");
  return kinds;
}

function specBody(d: Definition, invariants: InvariantDoc[]): string {
  const lines = [
    `SYSTEM ${d.id} (${d.kind}) @ ${d.hub}`,
    `PURPOSE  ${d.purpose}`,
    "",
    "BEHAVIOUR",
    `  G( GET /sim/op/${d.id} → status = 200 )`,
    `  G( latency(/sim/op/${d.id}) < 800ms )`,
    `  G( payload.rev ≠ ∅ )`,
  ];
  if (d.deps.length)
    lines.push(
      ...d.deps.map((dep) => `  G( health(${dep}) = up ⇒ ${d.id} may serve )`),
    );
  if (d.id === "dispatch")
    lines.push(
      "  G( release(flight) ⇒ notam.ok ∧ crew.legal ∧ wb.loadsheet )",
    );
  if (d.id === "ops-radar")
    lines.push("  G( radar.rev = unimatic.rev )   // cross-hub consistency");
  if (d.id === "unimatic-standby")
    lines.push("  G( replica.rev = unimatic.rev )  // replication lag 0");
  lines.push(
    "",
    "FAILURE MODES",
    d.kind === "hub"
      ? "  down → every dependent cascades; remediate with hub-failover"
      : d.kind === "feed"
        ? "  stale → resync feed; remediate with feed-resync"
        : "  degraded/severed → degraded-restore or dep-reconnect",
    "",
    `PROOFS  ${invariants.map((i) => i.id).join(", ")}`,
  );
  return lines.join("\n");
}

const SKILLS: SkillDoc[] = [
  {
    id: "hub-failover",
    block: "hub",
    failure: "down",
    title: "Hub failover",
    steps: [
      { action: "failover", target: "." },
      { action: "verify_only", target: "." },
      { action: "escalate", target: "." },
    ],
    authoredBy: "arsu/skills",
  },
  {
    id: "degraded-restore",
    block: "worker",
    failure: "degraded",
    title: "Degraded restore",
    steps: [
      { action: "repair", target: "." },
      { action: "restart", target: "." },
      { action: "verify_only", target: "." },
      { action: "escalate", target: "." },
    ],
    authoredBy: "arsu/skills",
  },
  {
    id: "dep-reconnect",
    block: "worker",
    failure: "severed_dep",
    title: "Dependency reconnect",
    steps: [
      { action: "reroute", target: "." },
      { action: "verify_only", target: "." },
      { action: "escalate", target: "." },
    ],
    authoredBy: "arsu/skills",
  },
  {
    id: "feed-resync",
    block: "feed",
    failure: "stale",
    title: "Feed resync",
    steps: [
      { action: "restart", target: "." },
      { action: "verify_only", target: "." },
      { action: "escalate", target: "." },
    ],
    authoredBy: "arsu/skills",
  },
  {
    id: "escalate",
    block: "worker",
    failure: "unknown",
    title: "Escalate",
    steps: [{ action: "escalate", target: "." }],
    authoredBy: "arsu/skills",
  },
];

export function showcaseBoard(): Board {
  const now = Date.now();
  const launchedAt = now - 142_000;
  const nodes = new Map<string, NodeDoc>();
  const edges = new Map<string, EdgeDoc>();
  const invariants = new Map<string, InvariantDoc>();
  const specs = new Map<string, SpecDoc>();
  const tasks = new Map<string, TaskDoc>();

  tasks.set("task-recon-registry", {
    id: "task-recon-registry",
    kind: "recon",
    target: "registry",
    priority: 5,
    status: "done",
    claimedBy: "recon-01",
    attempts: 1,
    result: `GET /sim/registry → ${DEFINITIONS.length} components`,
    createdBy: "orchestrator-01",
  });

  DEFINITIONS.forEach((d, index) => {
    const discoveredBy = index % 2 ? "recon-02" : "recon-01";
    nodes.set(d.id, {
      id: d.id,
      name: d.name,
      kind: d.kind,
      health: "up",
      discoveredBy,
      firstSeen: launchedAt + 4_000 + index * 600,
      lastProbe: now - (index % 3) * 400,
      evidence: [
        `GET /sim/health/${d.id} → 200 (${14 + index}ms)`,
        `GET /sim/registry → ${d.id} declares ${d.deps.length} required dependencies`,
        `Hub location ${d.hub}`,
      ],
      description: `${d.purpose} ${
        d.deps.length
          ? `Requires ${d.deps.join(", ")}.`
          : "Independent root component."
      }`,
    });

    d.deps.forEach((to) =>
      edges.set(`${d.id}-${to}`, {
        id: `${d.id}-${to}`,
        from: d.id,
        to,
        required: true,
        discoveredBy,
        evidence: [
          `registry: ${d.id}.deps includes ${to}`,
          `GET /sim/op/${d.id} → upstream ${to} referenced in trace`,
        ],
      }),
    );

    const docs = kindsFor(d).map((kind): InvariantDoc => {
      const id = `inv-${d.id}-${kind}`;
      return {
        id,
        node: d.id,
        kind,
        params:
          kind === "http_status"
            ? { url: `/sim/op/${d.id}`, equals: 200 }
            : kind === "latency_lt"
              ? { url: `/sim/op/${d.id}`, ms: 800 }
              : kind === "dep_health"
                ? { dep: dependencyFor(d) }
                : kind === "data_field"
                  ? { url: `/sim/op/${d.id}`, field: "rev" }
                  : {
                      url: `/sim/op/${d.id}`,
                      field: "rev",
                      via: "/sim/op/unimatic",
                      viaField: "rev",
                    },
        intervalMs: 2000,
        authoredBy: "verify-01",
        runs: 58 + index * 3,
        lastResult: "pass",
        lastDetail: DETAILS[kind](d),
        lastRun: now - (index % 4) * 300,
      };
    });
    docs.forEach((doc) => invariants.set(doc.id, doc));

    specs.set(`spec-${d.id}`, {
      id: `spec-${d.id}`,
      node: d.id,
      title: `${d.name} — behavioural contract`,
      body: specBody(d, docs),
      invariants: docs.map((doc) => doc.id),
      authoredBy: "verify-01 · ModelProvider",
      version: d.kind === "hub" ? 2 : 1,
    });

    tasks.set(`task-verify-${d.id}`, {
      id: `task-verify-${d.id}`,
      kind: "verify",
      target: d.id,
      priority: d.kind === "hub" ? 5 : 3,
      status: "done",
      claimedBy: "verify-01",
      attempts: 1,
      result: `authored spec v${d.kind === "hub" ? 2 : 1} + ${docs.length} executable proofs`,
      createdBy: "recon-01",
    });
  });

  const agentDefs: Array<[string, AgentDoc["role"], AgentDoc["state"], number, string?]> = [
    ["orchestrator-01", "orchestrator", "working", 41],
    ["recon-01", "recon", "idle", 18],
    ["recon-02", "recon", "idle", 14],
    ["verify-01", "verify", "idle", 26],
    ["runner-01", "runner", "working", 212],
    ["response-01", "response", "idle", 6],
    ["response-02", "response", "idle", 3],
  ];
  const agents = new Map<string, AgentDoc>(
    agentDefs.map(([id, role, state, decisions, task], i) => [
      id,
      { id, role, state, task, lastBeat: now - i * 350, decisions },
    ]),
  );

  const skills = new Map<string, SkillDoc>(
    SKILLS.map((s) => [s.id, structuredClone(s)]),
  );

  const checkCount = invariants.size;
  const timeline: Array<Omit<EventDoc, "id" | "ts"> & { at: number }> = [
    {
      at: 0,
      type: "mission",
      actor: "operator",
      severity: "info",
      msg: "mission launched — 7 agents on the blackboard, provider SIM",
    },
    {
      at: 1_200,
      type: "agent",
      actor: "orchestrator-01",
      severity: "info",
      msg: `loaded ${SKILLS.length} skills: ${SKILLS.map((s) => s.id).join(", ")}`,
    },
    {
      at: 2_100,
      type: "task",
      actor: "orchestrator-01",
      severity: "info",
      msg: "created recon task for registry (priority 5)",
    },
    {
      at: 3_000,
      type: "probe",
      actor: "recon-01",
      severity: "info",
      node: "unimatic",
      msg: `GET /sim/registry → ${DEFINITIONS.length} components, ${edges.size} dependency edges`,
    },
    {
      at: 9_000,
      type: "recon",
      actor: "recon-02",
      severity: "info",
      msg: `ontology written: ${nodes.size} nodes, ${edges.size} edges → blackboard`,
    },
    {
      at: 14_000,
      type: "verify",
      actor: "verify-01",
      severity: "info",
      node: "unimatic",
      msg: "ModelProvider authored spec v2 for unimatic (hub, SPOF)",
    },
    {
      at: 22_000,
      type: "verify",
      actor: "verify-01",
      severity: "info",
      node: "dispatch",
      msg: `published ${checkCount} executable proofs across ${nodes.size} systems`,
    },
    {
      at: 30_000,
      type: "verify",
      actor: "runner-01",
      severity: "info",
      msg: `first proof cycle: ${checkCount}/${checkCount} satisfied (2s loop)`,
    },
    {
      at: 64_000,
      type: "probe",
      actor: "recon-01",
      severity: "info",
      node: "ops-radar",
      msg: "GET /sim/health/ops-radar → 200 · ADS-B feed fresh (1 Hz)",
    },
    {
      at: 96_000,
      type: "verify",
      actor: "runner-01",
      severity: "info",
      node: "unimatic-standby",
      msg: "consistency: replica rev matches unimatic hub",
    },
    {
      at: 128_000,
      type: "agent",
      actor: "orchestrator-01",
      severity: "info",
      msg: "no open violations — response units on standby",
    },
    {
      at: 140_000,
      type: "verify",
      actor: "runner-01",
      severity: "info",
      node: "unimatic",
      msg: `proof cycle complete — all ${checkCount} checks satisfied`,
    },
  ];
  const events: EventDoc[] = timeline
    .map(({ at, ...e }, i) => ({ ...e, id: `example-${i + 1}`, ts: launchedAt + at }))
    .reverse();

  return {
    nodes,
    edges,
    invariants,
    specs,
    violations: new Map(),
    agents,
    tasks,
    skills,
    events,
    flights: {
      flights: structuredClone(seed.flights) as Board["flights"]["flights"],
      groundStop: false,
      staleFeed: false,
    },
    provider: "sim",
    mission: { launched: true, launchedAt },
    connected: false,
  };
}
