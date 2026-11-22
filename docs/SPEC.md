# SPEC.md — ARSU contracts

Field-level contracts every lane builds against. If reality must diverge
from this file, change this file first.

## 0. Conventions

- IDs: lowercase kebab (`unimatic`, `inv-weight-balance-01`). Timestamps:
  epoch ms (`number`). Money: none. All JSON.
- `ServiceState = 'up' | 'degraded' | 'down'`
- `Health` (effective, computed) = same enum; computed via dependency
  recursion — down if self down OR any required dep down; degraded if self
  degraded OR any required dep degraded.
- Every write to the blackboard that a human should notice ALSO appends an
  `events` doc. Events are the feed; collections are the state.

## 1. Blackboard API (`packages/core`)

```ts
interface Doc<T> { id: string; data: T }
interface Blackboard {
  get<T>(col: string, id: string): Promise<Doc<T> | null>
  put<T>(col: string, id: string, data: T): Promise<void>          // upsert
  add<T>(col: string, data: T): Promise<Doc<T>>                     // auto-id
  patch<T>(col: string, id: string, p: Partial<T>): Promise<void>
  query<T>(col: string, where?: Where<T>): Promise<Doc<T>[]>
  watch<T>(col: string, cb: (docs: Doc<T>[]) => void, where?: Where<T>): () => void
  emit(type: string, payload: object): Promise<void>                // → events
}
type Where<T> = Partial<{ [K in keyof T]: T[K] }>
```

`LocalBlackboard` persists to `data/blackboard.json` (debounced) and notifies
watchers synchronously on write. `FirestoreBlackboard` implements the same
surface with `onSnapshot` — no other code may import firestore.

### Collections

```ts
// nodes — one per discovered component
NodeDoc {
  id, name, kind: 'hub'|'worker'|'feed'|'store',
  health: Health, discoveredBy: agentId, firstSeen, lastProbe,
  evidence: string[],               // what probes saw (for judges: receipts)
  description: string               // authored by verify/gemini
}
// edges — directed dependency  from → to
EdgeDoc { id, from: nodeId, to: nodeId, required: boolean, discoveredBy, evidence }
// invariants — executable checks authored pre-incident ("the proofs")
InvariantDoc {
  id, node: nodeId, kind: 'http_status'|'latency_lt'|'dep_health'|'data_field'|'consistency',
  params: { url?, ms?, dep?, field?, equals?, via? },   // per kind, below
  intervalMs, authoredBy, runs: number,
  lastRun?, lastResult?: 'pass'|'fail', lastDetail?: string
}
// specs — the human-readable "formal spec" per node (Gemini-authored)
SpecDoc { id, node, title, body, invariants: invariantId[], authoredBy, version }
// violations — minted when an invariant fails
ViolationDoc {
  id, invariant, node, detail, firstSeen, lastSeen, count,
  status: 'open'|'triaged'|'remediating'|'resolved'|'escalated',
  resolvedBy?, resolution?: string
}
// tasks — work items agents claim
TaskDoc {
  id, kind: 'recon'|'verify'|'remediate', target: nodeId|'registry',
  skill?: string, priority: 1..5, status: 'pending'|'claimed'|'done'|'failed',
  claimedBy?, leaseUntil?, attempts: number, result?, createdBy
}
// agents — swarm roster (heartbeat = presence)
AgentDoc { id, role: 'recon'|'verify'|'runner'|'response'|'orchestrator',
  state: 'idle'|'working'|'done'|'dead', task?: taskId, lastBeat, decisions: number }
// skills — loaded by response agents; content also mirrored from /skills/*.md
SkillDoc { id, block: nodeKind, title, steps: Step[], authoredBy }
Step { action: 'restart'|'failover'|'reroute'|'repair'|'verify_only'|'escalate',
       target: string, params?: object, expectInvariant?: invariantId }
// events — append-only feed
EventDoc { id, ts, type: string, actor: agentId|'operator'|'system',
           node?, severity: 'info'|'warn'|'crit', msg: string, data? }
```

### Invariant kinds (proof-runner semantics)

| kind | params | pass when |
|---|---|---|
| `http_status` | `url` | GET returns 200 |
| `latency_lt` | `url`, `ms` | GET responds < ms |
| `dep_health` | `dep` | dep is in the node's *active* deps AND effectively `up` — catches dead deps **and** severed edges |
| `data_field` | `url`, `field`, `equals?` | JSON body has field (and equals match) |
| `consistency` | `url`, `field`, `via`, `viaField` | two endpoints agree on field — the Unimatic check |

Runner: `setInterval` per invariant at `intervalMs` (default 2s); on
fail→fail, update `runs/lastResult`, mint-or-increment `violations`, emit
`events` (`severity:'crit'`). On fail→pass, close violation
(`status:'resolved'` + event).

## 2. Simulation (`packages/sim`)

Single express app (mounted by server at `/sim`). Logical services share one
port; each exposes the same op surface.

### Endpoints

```
GET  /sim/registry                      → { services: [{id,name,kind,deps,description,standby}] }
                                          (service discovery — what recon crawls)
GET  /sim/health/:id                    → { id, state, effective, deps: {id→effective} }
GET  /sim/op/:id                        → service-specific business payload; 503 when
                                          effective≠up (consistency checks read these)
GET  /sim/flights                       → { flights: Flight[], groundStop: bool, staleFeed: bool }
POST /sim/chaos   {type,target,dep?}    → inject fault   [OPERATOR ONLY]
POST /sim/action  {type,target,params?} → remediation    [AGENTS ONLY]
POST /sim/reset                         → all up, standby off, flights resynced
```

`type` for chaos: `kill | degrade | cut_dep | corrupt`.
`type` for action: `restart | failover | reroute | repair`.

- `kill` → state=down. `degrade` → state=degraded (+latency above the
  800ms `latency_lt` budget, op returns partial). `cut_dep{target,dep}` →
  removes required edge in sim truth.
- `restart` → up (clears kill/degrade). `failover` → activates `standby`,
  flips dependents' traffic to replica (sim: swaps dep target). `reroute` →
  repoint a `cut_dep` edge to standby. `repair` → clears `corrupt`.
- Invariants see effective health — a fixed service only greens when the
  cascade it feeds recovers.

### Flight model

`Flight { id, callsign, from: Airport, to: Airport, t: 0..1, speed,
status: 'scheduled'|'boarding'|'departed'|'enroute'|'arrived',
position: {lat,lon}, heading }`

- Route: great-circle interpolation between real airport coords (seed has
  ~24 airports: CYYZ..KJFK..EGLL). `npm run seed` → `data/flights.seed.json`
  (~40 flights, real airport pairs).
- Tick 1s: enroute advances `t`; `departed` requires `dispatch`
  effective=up; when dispatch down, scheduled/boarding flights hold →
  `groundStop: true` (visual: planes pile at origin).
- `ops-radar` down → positions freeze server-side, `staleFeed: true` —
  the map visibly stalls. `unimatic` down cascades into both.

## 3. Swarm (`packages/swarm`)

```ts
interface ModelProvider {
  name: 'gemini' | 'sim'
  complete(prompt: string): Promise<string>
  planJSON<T>(prompt: string, shape: 'node'|'invariants'|'triage'|'spec'): Promise<T>
}
// selected by env: ARSU_PROVIDER, else gemini if GEMINI_API_KEY, else sim.
```

Agent lifecycle: register in `agents` → heartbeat 1s → claim loop polls
`tasks` (`status:pending`, role match, CAS claim with `leaseUntil`) →
work → write results → `tasks.status=done` (+`result`) → idle.

- `recon` task `{target:'registry'}` → probe all services → upsert `nodes`
  (id=service id, evidence=probe receipts) + `edges` per dep → emit event.
  SIM provider: direct mapping. Gemini: probe JSON → `planJSON('node')`
  authors `description` + confirms edges.
- `verify` task `{target:nodeId}` → author invariants (kind table below) +
  `specs` doc. Gemini `planJSON('invariants')` generates the set from the
  service description — free-tier-friendly: one call per node, batched.
- `runner` — interval executor (§1 semantics). Not a claimable role; spawned
  once at launch.
- `response` — claim `remediate` → `skills.get(block)` → execute steps
  sequentially via `/sim/action` → re-run affected invariants → close or
  escalate violation. Every step + result → `events` + `agents.decisions++`.
- `orchestrator` — watches `violations` (status `open`) → group by node →
  root-cause filter: a violated node with a required dep effectively
  ≠`up` is *collateral* and gets no task (its proofs re-green when the
  root is remediated) → create `remediate` tasks for roots only
  (priority: hub>feed>worker), `skill` = lookup by `node.kind` + failure
  mode → mark violation `triaged`. Escalates after 2 failed attempts
  (`status:'escalated'`, crit event).

### Built-in skills (`/skills/*.md`, mirrored into `skills` col)

`hub-failover` (kind hub, down): failover → standby; verify `dep_health`
pass; escalate if none.
`degraded-restore`: restart target; re-probe; escalate on repeat.
`dep-reconnect`: reroute cut edge → restart if no standby.
`feed-resync`: restart feed; consistency check green.
`escalate`: no steps — emit escalation + page event.

Skill file format — markdown with frontmatter:

```md
---
block: hub
failure: down
steps:
  - { action: failover, target: unimatic, expectInvariant: inv-unimatic-dep }
  - { action: escalate, target: unimatic }
---
# Hub failover
Human-readable rationale shown in SWARM panel while the agent works.
```

## Three-layer communications practice

`npm run dev:practice` runs an ephemeral, manually launched practice profile.
Its checked-in service manifest is `packages/sim/src/practice.ts`. Exactly three
layers are exposed: infrastructure, communications, operations. Public references
support architectural concepts, not claims about actual FAA server addresses,
private links, or live NOTAM content. Node provenance distinguishes modeled
services from the separate observed ARSU-process telemetry.

The communication harness replays educational JSON envelopes in-process. HTTP
exposes observations; it is not a JMS transport, ASTERIX decoder, RF capture, or
real aviation control link. Receipts retain payloads, timestamps, sequence,
stream epoch, checksum, and validation outcomes. Payload hashes detect accidental
corruption, not sender authenticity. Four allowlisted packet faults affect only
this harness: corruption, omitted delivery, replay, and stale timestamp.
Message-consumer contracts check integrity, continuity, and freshness flags.
Repairs reset the stream epoch and require newly passing checks before recovery.
Practice snapshots and receipt history are included in rehearsal evidence.

## Recording rehearsal

`npm run dev:recording` starts the host with `--recording`: an empty, ephemeral
LocalBlackboard, manual launch, seeded aviation flights, and paced agent stages.
It never clears or overwrites the persisted board. Normal startup is unchanged.
`GET /api/rehearsal` exposes registry-derived readiness and scenario history;
`POST /api/rehearsal` with `{scenario}` injects one allowlisted fault only after
complete discovery, required dependency contracts, fresh passing checks, and
no unresolved violations or active tasks. One scenario runs at a time.
Rehearsal records live in `rehearsals`; `/api/rehearsal/:id/evidence` exports
frozen outcome records. Verified recovery requires an observed failure, a
successful response action, and all covered checks passing after that action.
Escalations, timeouts, missing coverage, and stale checks cannot count as verified.
Readiness and scenario progress stream over WS as `rehearsal` messages.
These are executable simulation checks, not a guarantee about external aviation.

## Operational summaries

`POST /api/summary` accepts no user prompt. The server derives bounded context
from its current Blackboard snapshot and calls `ModelProvider.planJSON` with
shape `summary`. The response is `OperationalSummary`: generatedAt, provider
(actual `gemini|sim`, including fallback), headline, risks, nextAction, and
evidence record paths. Summaries are advisory, never execute actions, and are
cached for 20 seconds with one shared in-flight generation. Unknown evidence
paths or malformed output trigger deterministic SIM fallback. Simulation health
is not external aviation telemetry. The Pipeline view reads existing board
records; selecting a stage does not execute or fabricate agent work.

## 4. Server (`packages/server`)

```
GET  /api/state       → { nodes, edges, invariants, specs, violations,
                          agents, tasks, flights, provider, mission }
POST /api/launch      → seed recon tasks + spawn agents + runner (idempotent)
POST /api/chaos       → proxy to /sim/chaos + emit operator event
POST /api/reset       → /sim/reset + wipe board (except skills) + event
WS   /ws              → pushes: {type:'event'|'invariant'|'flight'|'agent'|'node', data}
```

Flight ticks broadcast 1×/s (throttled); invariant + event docs push on
write. Server is the only process touching the blackboard in demo mode —
dashboard never imports `core` directly. (Prod: dashboard reads Firestore
directly; keep message shapes identical.)

## 5. Dashboard (`apps/dashboard`)

- Stack: React 18 + Vite + react-leaflet + d3-force. Dark ops-console
  aesthetic (near-black bg, phosphor green/amber/red status, mono accents).
- Surfaces: MAP / ONTOLOGY / INVARIANTS / SWARM / FEED (§ARCH) + CHAOS BAR.
- Data: initial `GET /api/state`, then WS diffs only.
- Map: CartoDB dark tiles; planes = rotated markers by heading; service
  badges along top of map; `groundStop` → red banner + planes held at gates;
  `staleFeed` → amber "FEED STALE".
- Chaos bar: buttons wired to `/api/chaos` — `Kill unimatic`,
  `Degrade weight-balance`, `Cut dispatch→notam`, `Corrupt pax-connect`,
  `RESET`. LAUNCH SWARM + provider badge (SIM/GEMINI) in header.

## 6. Env / config

See `.env.example`. `ARSU_PROVIDER` ∈ `sim|gemini` (auto if unset). All
provider/key reads happen in `packages/swarm/provider.ts` and
`packages/core/blackboard.ts` — nowhere else.

## 7. Non-goals for the hack

- No real auth on sim/action in demo (prod note in README only).
- No persistence guarantee beyond `data/blackboard.json`.
- Live ADS-B is an opt-in plug (`ARSU_FLIGHT_SOURCE=live`, airplanes.live,
  graceful fallback) — seed flights are the baseline.
