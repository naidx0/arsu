// SPEC.md §0-§1 — every doc/interface on the blackboard lives here.
// This file is the shared contract; changes need a heads-up to all lanes.

export type ServiceState = 'up' | 'degraded' | 'down';
export type Health = ServiceState;
export type Severity = 'info' | 'warn' | 'crit';

export type NodeKind = 'hub' | 'worker' | 'feed' | 'store';

export interface NodeDoc {
  id: string;
  name: string;
  kind: NodeKind;
  health: Health;
  discoveredBy: string;
  firstSeen: number;
  lastProbe: number;
  evidence: string[];
  description: string;
}

export interface EdgeDoc {
  id: string;
  from: string; // dependent
  to: string; // dependency
  required: boolean;
  discoveredBy: string;
  evidence: string[];
}

export type InvariantKind =
  | 'http_status'
  | 'latency_lt'
  | 'dep_health'
  | 'data_field'
  | 'consistency';

export interface InvariantParams {
  url?: string;
  ms?: number;
  dep?: string;
  field?: string;
  equals?: unknown;
  via?: string;
  viaField?: string; // consistency: field name on the `via` endpoint
}

export interface InvariantDoc {
  id: string;
  node: string;
  kind: InvariantKind;
  params: InvariantParams;
  intervalMs: number;
  authoredBy: string;
  runs: number;
  lastRun?: number;
  lastResult?: 'pass' | 'fail';
  lastDetail?: string;
}

export interface SpecDoc {
  id: string;
  node: string;
  title: string;
  body: string;
  invariants: string[];
  authoredBy: string;
  version: number;
}

export type ViolationStatus =
  | 'open'
  | 'triaged'
  | 'remediating'
  | 'resolved'
  | 'escalated';

export interface ViolationDoc {
  id: string;
  invariant: string;
  node: string;
  detail: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  status: ViolationStatus;
  resolvedBy?: string;
  resolution?: string;
}

export type TaskKind = 'recon' | 'verify' | 'remediate';
export type TaskStatus = 'pending' | 'claimed' | 'done' | 'failed';

export interface TaskDoc {
  id: string;
  kind: TaskKind;
  target: string; // nodeId | 'registry'
  skill?: string;
  priority: number; // 1..5, 5 most urgent
  status: TaskStatus;
  claimedBy?: string;
  leaseUntil?: number;
  attempts: number;
  result?: string;
  createdBy: string;
}

export type AgentRole =
  | 'recon'
  | 'verify'
  | 'runner'
  | 'response'
  | 'orchestrator';
export type AgentState = 'idle' | 'working' | 'done' | 'dead';

export interface AgentDoc {
  id: string;
  role: AgentRole;
  state: AgentState;
  task?: string;
  lastBeat: number;
  decisions: number;
}

export type StepAction =
  | 'restart'
  | 'failover'
  | 'reroute'
  | 'repair'
  | 'verify_only'
  | 'escalate';

export interface Step {
  action: StepAction;
  target: string;
  params?: Record<string, unknown>;
  expectInvariant?: string;
}

export interface SkillDoc {
  id: string;
  block: NodeKind;
  failure?: string;
  title: string;
  steps: Step[];
  authoredBy: string;
}

export interface EventDoc {
  id: string;
  ts: number;
  type: string;
  actor: string; // agentId | 'operator' | 'system'
  node?: string;
  severity: Severity;
  msg: string;
  data?: unknown;
}

// ---- sim-side shapes ----

export interface Airport {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export type FlightStatus =
  | 'scheduled'
  | 'boarding'
  | 'departed'
  | 'enroute'
  | 'arrived';

export interface Flight {
  id: string;
  callsign: string;
  from: Airport;
  to: Airport;
  t: number; // 0..1 progress along route
  speed: number; // t per second
  status: FlightStatus;
  position: { lat: number; lon: number };
  heading: number;
}

export interface FlightsPayload {
  flights: Flight[];
  groundStop: boolean;
  staleFeed: boolean;
}

export interface ServiceInfo {
  id: string;
  name: string;
  kind: NodeKind;
  deps: string[];
  description: string;
  standby?: string;
}

export type ChaosType = 'kill' | 'degrade' | 'cut_dep' | 'corrupt';
export type ActionType = 'restart' | 'failover' | 'reroute' | 'repair';

export interface ChaosRequest {
  type: ChaosType;
  target: string;
  dep?: string;
}

export interface ActionRequest {
  type: ActionType;
  target: string;
  params?: Record<string, unknown>;
}

// ---- API / WS shapes ----

export type WsMessage =
  | { type: 'event'; data: EventDoc }
  | { type: 'invariant'; data: InvariantDoc }
  | { type: 'flight'; data: FlightsPayload }
  | { type: 'agent'; data: AgentDoc }
  | { type: 'node'; data: NodeDoc }
  | { type: 'edge'; data: EdgeDoc }
  | { type: 'violation'; data: ViolationDoc }
  | { type: 'task'; data: TaskDoc }
  | { type: 'spec'; data: SpecDoc }
  | { type: 'skill'; data: SkillDoc }
  | { type: 'snapshot'; data: StateSnapshot };

export interface MissionState {
  launched: boolean;
  launchedAt?: number;
}

export interface OperationalSummary {
  generatedAt: number;
  provider: 'gemini' | 'sim';
  headline: string;
  risks: string[];
  nextAction: string;
  evidence: string[];
}

export interface StateSnapshot {
  events?: EventDoc[];
  nodes: NodeDoc[];
  edges: EdgeDoc[];
  invariants: InvariantDoc[];
  specs: SpecDoc[];
  violations: ViolationDoc[];
  agents: AgentDoc[];
  tasks: TaskDoc[];
  skills: SkillDoc[];
  flights: FlightsPayload;
  provider: string;
  mission: MissionState;
}
