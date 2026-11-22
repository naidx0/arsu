# PITCH.md — ARSU judge deck

Markdown slide deck, one `## Slide N` section per slide. Speaker notes in
*italics*. Timed for ~3 minutes + 90-second live demo.

---

## Slide 1 — Title

# ARSU — Attack Response Swarm Unit

**Agents that map your system into proofs — and fix it when a proof breaks.**

Hack @ DevFest Sudbury · built from scratch in the window · TypeScript monorepo
· Gemini API + Firebase + Google Cloud.

*One line for the room: "Unimatic took down four hub airports in August. This is
a swarm that would have seen it coming, and would have brought it back."*

---

## Slide 2 — The problem: systems fail silently

- **Aug 6, 2025 — United's Unimatic.** One internal flight-info system went
  down and the FAA ground-stopped Chicago, Denver, Houston, Newark, and San
  Francisco. The failure itself was small; the *blast radius* was invisible.
- **Oct 2025 — Alaska.** A datacenter failure cancelled 400+ flights.
- **Jul 2024 — CrowdStrike, Jan 2023 — FAA NOTAM.** Same story every time: a
  hidden dependency broke, and nobody had a *verified map* of what depended on
  it.

Modern outages aren't software bugs. They're **knowledge failures** — the
ontology lives in people's heads, and when the cascade starts, ops is learning
the dependency graph in real time, in the dark.

---

## Slide 3 — The reframe: an outage is a distress call

When an aircraft is in trouble, it doesn't file a ticket. An **ARTEX ELT fires
on 406 MHz**, GADSS drops from 15-minute to 1-minute position tracking, and
search-and-rescue moves on a known protocol.

ARSU treats a cascading system failure the same way:

- the system has a **distress beacon** — the moment its proofs break, the
  beacon triggers;
- a **swarm is the response unit** — already on station, already carrying the
  right skill.

*That reframe is the product. Everything else is mechanics.*

---

## Slide 4 — What ARSU does

One mission loop, five agent roles, all communicating through one blackboard:

| Phase | Agents | What lands on the board |
|---|---|---|
| **MAP** | recon | probes every service → `nodes` + `edges` with evidence receipts |
| **SPEC** | verify | executable `invariants` + a human-readable `specs` doc per node |
| **PROVE** | proof-runner | re-runs every invariant on its interval; a failure mints a `violations` doc |
| **TRIAGE** | orchestrator | groups violations by node, suppresses collateral (a broken node whose dep is down gets no task — its proofs re-green when the root heals), picks root cause + skill + priority |
| **RESPOND** | response | claims `remediate` tasks, executes the block's skill against the action plane, re-runs proofs, resolves or escalates |

Chaos plane (`/sim/chaos`) and action plane (`/sim/action`) are **separate
surfaces** — the operator breaks things; only agents may fix them.

---

## Slide 5 — Architecture: one blackboard, nothing else

```
          CONTROL BOARD (React — map · ontology · invariants · swarm · feed)
                                │ WS / REST
   ┌────────────────────────────▼────────────────────────────┐
   │                      BLACKBOARD                          │
   │ nodes · edges · invariants · specs · violations ·        │
   │ tasks · agents · events · skills   (Firestore seam)      │
   └──┬────────┬─────────┬──────────┬───────────┬────────────┘
      │        │         │          │           │
   recon    verify   proof-     response   orchestrator
                     runner
      └────────┴─────────┴──────────┴───────────┘
                        │
              SIMULATION (airline ops estate)
              + MODEL PROVIDER (Gemini | SIM)
```

**No agent-to-agent calls. No shared memory outside the board.** Every agent
decision lands as a document; every document is a receipt a judge can click.

---

## Slide 6 — Why Gemini is core, not a wrapper

`packages/swarm/src/provider.ts` defines `ModelProvider` —
`complete()` + `planJSON(prompt, shape)`. **Every reasoning step in the swarm
goes through it.** The real call sites:

| Call site | Shape | What the model authors |
|---|---|---|
| `doRecon` (`roles.ts`) | `'node'` | ontology description + confirmed dependency edges from probe output |
| `doVerify` (`roles.ts`) | `'invariants'` | the executable check set for a node — kind, params, interval |
| `doVerify` (`roles.ts`) | `'spec'` | the human-readable behavioral spec |
| `Orchestrator.triage` (`orchestrator.ts`) | `'triage'` | root cause, skill selection, priority, rationale — written into the `triage` event |

Implementation: `GeminiProvider` calls `generateContent` on
`gemini-2.5-flash` with `responseMimeType: 'application/json'` for all
`planJSON` shapes. `ResilientProvider` wraps it and falls back to the
deterministic `SimulatedProvider` on any failure — demo insurance, clearly
labeled SIM in the header badge.

**Free-tier fit:** verify is one call per node, batched — the full mission
runs in well under the free-tier rate limits.

---

## Slide 7 — Why Firebase is the nervous system

The `Blackboard` interface (`packages/core/src/blackboard.ts`) is literally
the Firestore surface: `get / put / add / patch / query / watch / emit`.
It's implemented twice:

- `LocalBlackboard` — in-memory + debounced JSON persistence, synchronous
  watchers. Default; zero credentials.
- `FirestoreBlackboard` — the same interface on `@google-cloud/firestore`,
  `watch()` = `onSnapshot`. Activated by `FIREBASE_*` env. **Config, not
  code** — nothing outside `firestore.ts` imports Firestore.

What that buys in production:

- The **dashboard reads collections directly** — `onSnapshot` fanout replaces
  the WS bridge; the message shapes already match.
- `violations`/`tasks`/`events` are **durable, queryable incident history**
  for free.
- Hosting serves the control board; Functions host the proof-runner loop;
  Auth gates the chaos plane (see `INTEGRATION-AUTH.md`).

The collections *are* the product's nervous system — swapping the transport
swaps nothing about how the swarm thinks.

---

## Slide 8 — The ARTEX layer: distress as a first-class signal

The control board mounts a virtual **`artex-adt` node** — an ARTEX ELT-5000
autonomous distress beacon, wired to the fleet on 406 MHz / GADSS.

- **Armed** while mission condition is NOMINAL.
- **Triggered** the instant condition flips DEGRADED or a ground stop lands —
  the beacon pill fires, the ARTEX panel switches to *distress tracking:
  1-minute position lock* (vs. 15-minute normal), and the telemetry locks onto
  the last enroute aircraft.

Why it matters to the story: GADSS exists because MH370 proved that *an
aircraft that stops reporting is the worst kind of failure*. A system that
stops passing its proofs is the same failure. ARSU is the search-and-rescue
that answers the beacon.

---

## Slide 9 — The live map

- ~40 flights on real airport-pair great-circle routes, positions ticking
  1 Hz over WS. `npm run seed` regenerates `data/flights.seed.json`.
- **Optional live ADS-B**: `ARSU_FLIGHT_SOURCE=live` or `POST /api/flights/live`
  pulls real aircraft from `airplanes.live` around 9 North America /
  transatlantic hubs (up to 45 tracks), snaps each onto its nearest
  airport-pair route. Any failure → seed. Offline-safe by default.
- Behavioral coupling is real: kill `dispatch` → departures hold →
  `GROUND STOP` banner and planes pile at gates; kill `ops-radar` → positions
  freeze → `FEED STALE`. The map *feels* the outage before the board turns red.

---

## Slide 10 — The demo (90 seconds, live)

| T+ | Beat | What the room sees |
|---|---|---|
| 0:00 | Cold open on MAP | planes moving on real routes. *"This is a simulated airline — same topology as the outages."* |
| 0:10 | **LAUNCH SWARM** | agents register in SWARM; recon probes → ONTOLOGY graph blooms; FEED scrolls probe receipts |
| 0:25 | Verify lands | INVARIANTS fills green (~30 checks); expand one `specs` doc — *"authored by Gemini, stored on the board"* |
| 0:35 | **CHAOS: kill `unimatic`** | cascade red across w&b / dispatch / crew / pax / radar · `GROUND STOP` · planes hold at gates · ARTEX beacon TRIGGERED |
| 0:50 | Proofs fail | violations mint · orchestrator triage event: *root cause `unimatic`, dependents suppressed, `hub-failover` p5* |
| 1:05 | Response | agent claims task → `failover` → `unimatic-standby` active → cascade re-greens bottom-up |
| 1:20 | Resolved | `mission: resolved — board is green` in FEED · planes resume · every decision receipted |

Fallbacks: no Gemini key → `ARSU_PROVIDER=sim`, same runbook, header badge says
SIM. Full runbook: `docs/DEMO.md`.

---

## Slide 11 — What's real, what's next

Real today:

- The full loop runs end-to-end on real code — no mock feed required.
- All four chaos types verified: `kill`, `degrade`, `cut_dep`, `corrupt`.
- `cut_dep` is the sleeper demo: sever an edge while the dep stays healthy —
  the `dep_health` proof still fails, triage picks `dep-reconnect`, and the
  response agent reroutes the edge. *That's the hidden-dependency outage.*

Deliberately not claimed:

- Executable invariants, not formal verification (TLA+/Coq). It's the honest,
  demoable core of the same idea — and the roadmap line.
- The swarm targets generic probe/action surfaces — a real-estate adapter is a
  lane, not a rewrite. Auth + Firestore swap are designed seams
  (`INTEGRATION-AUTH.md`), not production code yet.

---

## Slide 12 — Close

**ARSU: a swarm that maps systems into proofs, treats a broken proof like a
distress call, and answers it.**

- Repo: `github.com/…/arsu` — commit history is the scratch-built story.
- Stack: Gemini API (`gemini-2.5-flash`, free tier) · Firestore-shaped
  blackboard · React control board · Node host · live ADS-B.
- Theme fit — **Build, Secure, Scale**: the swarm *builds* the ontology,
  invariants *secure* it, response units *scale* recovery.

*Ask for judges: "Want to see `cut_dep` — the outage nobody's runbook covers?"*
