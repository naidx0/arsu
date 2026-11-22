# ARSU — Attack Response Swarm Unit

An agent-swarm resilience platform. ARSU launches **agent swarms** that map a
running system into a machine-readable **ontology**, generate **executable
invariants** (pre-computed verification) for every architecture block, and —
when real-world outages strike — dispatch **response units** carrying
per-block **skills** to bring the system back inside its proofs.

Built for **Hack @ DevFest Sudbury** (MLH, Nov 21–28 2026). See
[docs/HACKATHON.md](docs/HACKATHON.md) for rules and submission details.

## The idea

Modern outages are ontology failures: nobody has a live, verified map of how
the system actually behaves. United's Unimatic outage (Aug 2025), Alaska's
datacenter failure (Oct 2025), CrowdStrike (Jul 2024), the FAA NOTAM outage
(Jan 2023) — each cascaded because a hidden dependency broke and nobody could
see it.

ARSU fixes that with three phases:

| Phase | What the swarm does |
|---|---|
| **MAP** | Recon agents probe the target environment and write a living ontology — components, dependencies, protocols — onto the blackboard. |
| **PROVE** | Verify agents emit executable invariants per block (health, latency, dependency, consistency checks) plus human-readable specs. A proof runner re-checks them continuously. |
| **RESPOND** | When an invariant breaks, the orchestrator triages the violation and dispatches response agents carrying the skill authored for that block: restart, fail over, reroute, escalate. |

Everything agents know — the ontology, the invariants, the tasks, the event
feed — flows through **one blackboard database** (Firestore in production; a
local adapter with the same API in dev). The **control board** renders all of
it live: ontology graph, invariant board, swarm status, event feed, and a map
view of the simulated airline the swarm protects.

## The demo world

ARSU ships with a simulated airline-operations environment modeled on the
real failure stories — a central flight-info hub (`unimatic`), weight &
balance, dispatch, crew scheduling, passenger systems, a NOTAM feed — plus a
live flight map built from real airport-pair routes. A **chaos panel** injects
faults (kill a service, degrade it, cut a dependency). You watch the swarm
detect the broken proofs, respond, and heal the system.

## Where Gemini lives (qualification)

- **Gemini API** is the agent brain: recon agents reason over probe output,
  verify agents author invariants + specs, the orchestrator plans response
  strategies. Not a wrapper — the swarm's decisions are model output.
- **Gemini skills**: each architecture block gets a skill file the response
  agents load and execute.
- **Firebase**: Firestore is the blackboard; Hosting serves the control
  board; Auth + Functions are the production deployment path.
- **Google Cloud**: agent runners / artifact storage path.

Dev mode runs fully offline on `SimulatedProvider` (deterministic heuristics,
labeled SIM) so the platform is testable without keys; set `GEMINI_API_KEY`
and the same swarm runs on Gemini.

## Repo layout

```
arsu/
  docs/            ← specs — read these first
  packages/
    core/          shared types + Blackboard interface + LocalBlackboard
    sim/           the airline-ops simulation target + chaos plane
    swarm/         agent runtime, providers, agent roles, orchestrator
    server/        HTTP + WS host tying sim/blackboard/swarm/dashboard
  apps/
    dashboard/     the control board (React)
  skills/          per-block remediation skills (loaded by response agents)
  data/            flight seed + blackboard persistence
```

## Status

Documentation + spec complete. Implementation is decomposed into parallel
lanes in [docs/LANES.md](docs/LANES.md).
