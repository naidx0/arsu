# LANES.md — parallel work decomposition

Each lane is dispatchable to its own agent/session. Lanes own files;
contracts live in `docs/SPEC.md` + `packages/core` types. Build order:
**Lane 0 first** (contracts), then A/B/C/E in parallel, then D, then F/G.

Gate for every lane: `npm run typecheck` green + the lane's done-when.

---

## Lane 0 — Core contracts *(do this first, ~small)*

**Owns:** `packages/core/**`, `tsconfig` files, `data/` scaffolding.

Deliver:
- `src/types.ts` — every doc/interface in SPEC §1 (NodeDoc…Step, Flight,
  ServiceState, Health, WS message types).
- `src/blackboard.ts` — `Blackboard` interface + `LocalBlackboard`
  (in-memory + JSON persist + `watch` via emitters).
- `src/firestore.ts` — `FirestoreBlackboard` stub behind env flag (same
  interface; may throw unimplemented until credentials exist — ship the
  seam).
- `packages/core/package.json` (`name:"@arsu/core"`).

**Done when:** a scratch script can put/get/watch/persist across restart.

## Lane A — Sim (`packages/sim/**`, `data/flights.seed.json`, `scripts`/seed)

Deliver: express app per SPEC §2 — registry, health with effective-health
recursion, op payloads, flights ticker (great-circle interp over seed),
chaos + action + reset endpoints, standby/failover semantics.

**Done when:** `kill unimatic` → cascade downs dependents + `groundStop`;
`failover unimatic` → greens return. Verify with curl — no UI needed.
**Depends on:** Lane 0 types only.

## Lane B — Swarm (`packages/swarm/**`, `skills/*.md`)

Deliver: `ModelProvider` (+ Simulated, + Gemini fetch impl), `AgentRuntime`
(register/heartbeat/claim-CAS), `recon`, `verify`, `runner`, `response`,
`orchestrator` per SPEC §3, and the five built-in skill files.

**Done when:** against Lane A's sim: launch → nodes/edges/invariants
authored → `kill` → violations → response executes `hub-failover` →
resolved. Headless log line `mission: resolved` is the gate.
**Depends on:** Lane 0; sim can be mocked by HTTP until Lane A lands.

## Lane C — Server (`packages/server/**`)

Deliver: single process mounting `/sim` (Lane A app), owning blackboard +
runtime (Lane B), `/api/*` + `/ws` per SPEC §4, serving dashboard `dist/`
when built.

**Done when:** `/api/state` returns the full board; `/ws` streams events +
flights; `/api/launch` runs the mission end-to-end.
**Depends on:** Lanes 0, A, B (code against their interfaces early with
stubs).

## Lane E — Dashboard (`apps/dashboard/**`)

Deliver: Vite+React control board per SPEC §5 — map, ontology force graph,
invariant board, swarm panel, feed, chaos bar, launch button, provider
badge. WS-first updates.

**Done when:** full mission visible without touching curl — chaos → red →
response → green, planes stop and restart.
**Depends on:** Lane C message shapes (buildable against a mock WS feed
checked in as `apps/dashboard/src/mockFeed.ts`).

## Lane F — Flight data + polish (`data/`, sim adapter seam)

Deliver: `npm run seed` generator (real airport table → great-circle
routes → `data/flights.seed.json`); optional live-ADS-B adapter behind
`ARSU_FLIGHT_SOURCE=live|seed` (airplanes.live/OpenSky — graceful fallback
to seed, offline-safe default).

**Done when:** seed regen deterministic-ish; demo map looks real.
**Depends on:** Lane A flight types.

## Lane G — Docs/demo assets (`docs/DEMO.md` upkeep, `README` polish, video script)

Deliver: final demo script, screenshots, 60–90s video shot list, booth
pitch (30s + 90s versions), submission checklist per HACKATHON.md.

**Done when:** someone cold can run the demo from the doc.

---

## Wave plan

| Wave | Lanes | Why |
|---|---|---|
| 1 | 0 | contracts — everything keys off types |
| 2 | A, B, E(mock feed) | parallel heavy build |
| 3 | C, F | integration + data |
| 4 | E-real, G | wire dashboard to server, demo assets |

File-ownership conflicts = talk before merge. `packages/core/src/types.ts`
changes need a heads-up to all lanes — it's the shared contract.
