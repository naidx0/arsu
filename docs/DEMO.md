# DEMO.md — demo narrative + runbook

## The 90-second story

> "In August, one internal system — United's Unimatic — failed and the FAA
> ground-stopped four hub airports. In October, Alaska lost a datacenter and
> cancelled 400 flights. These aren't software bugs; they're *knowledge*
> failures — nobody had a verified map of what depends on what.
>
> ARSU is an attack response swarm unit. Its agents map your system into an
> ontology, author executable invariants — pre-computed proofs of how every
> block should behave — and when a proof breaks, a response unit carrying
> that block's skill brings it back. Watch."

## Demo director (presenter mode)

`npm run demo` builds the UI and starts a fresh recording host. Open
http://localhost:4780/?demo (or press **Demo** in the top bar). A broadcast
band docks under the view and walks ten beats: cold open, airspace, launch,
topology, proof, mission control, fault, response, evidence, close. Each beat
opens its view, shows the line to say, runs its action (launch, take Unimatic
offline, download evidence) and waits on live evidence before it turns green.

- **Next / →  / PageDown / Space**: run the beat's action, or advance once it lands.
- **Back / ← / PageUp**: previous beat. Click the rail to jump.
- **A**: autopilot (runs actions and advances on its own). **H**: hide to a pill. **Esc**: close.

The fault beat waits for a green baseline, so it can never fire mid-recovery.
For a fresh take, stop the host and run `npm run demo` again.

## Beats (live, on the control board)

Run the stage host with `npm run dev:recording` (empty board, SIM unless
`GEMINI_API_KEY` is set) and open http://localhost:4780. Left nav names are
the views below.

1. **Cold open — Swarm view** (opens by default in recording mode): 0/8
   systems, "Discover. Stress. Prove recovery." Switch to **Airspace** for
   the planes on real routes. "This is our simulated airline — same
   topology United runs on."
2. **LAUNCH ENVIRONMENT** (Swarm view) → agents register; recon writes nodes
   and the dependency graph fills in live. ~12 s to fully mapped.
3. **Verification** → 33/33 proofs passing, grouped by system; open a row
   for the receipt. "Every block now has machine-checkable proofs."
4. **Airspace → 2D radar → Inject fault → Take Unimatic hub offline.**
   Cascade: hubs go red, comms links dash, single GROUND STOP banner,
   tiles drop to 2/8 systems. "This is August 6th."
5. **Topology** → SEVERED links out of Unimatic, ARTEX beacon triggers.
   Proofs fail → orchestrator triage → response runs `hub-failover` →
   `unimatic-standby` takes over (~10 s).
6. **Swarm** → "Verified stress tests: 1" and a *VERIFIED* hub-outage
   record with violations and actions counted. Click **Download evidence
   JSON** — every decision receipted. Close: "Imagine this pointed at a
   real estate."

The menu fault runs as a tracked stress test only when the estate is
ready (all proofs fresh and passing, no open work). Mid-recovery it falls
back to a plain chaos injection that is not counted — wait for green.

Rehearse the exact path headlessly: start a second recording host with
`ARSU_PORT=4783 ARSU_PROVIDER=sim`, then `npm run test:stage -w dashboard`.

## Judge handles (what to say when asked)

- *Gemini core?* — every node description, invariant set, spec, and triage
  plan is model output; we show the call sites in `packages/swarm`.
- *Firebase?* — the blackboard IS Firestore in prod (Local adapter in dev);
  hosting on Firebase, Functions for the proof-runner.
- *Skills?* — `/skills/*.md` are agent skills loaded at response time;
  Gemini CLI agents authored/refine them.
- *Antigravity?* — the whole repo is developed in it; swarm lanes run as
  Antigravity agents (true for the demo narrative — we did build with
  agents).

## Failure fallbacks (hack demo insurance)

- No Wi-Fi / no Gemini key → `ARSU_PROVIDER=sim`, same runbook, say "dev
  provider — the reasoning surface is identical."
- WS dies → `/api/reset` then re-launch; LocalBlackboard persists anyway.
- Leaflet tiles blocked → map still renders markers on blank bg (bundle a
  low-zoom fallback tile set in lane F if time).

## Pre-flight checklist (booth)

- [ ] `.env`: `GEMINI_API_KEY` set OR deliberately `ARSU_PROVIDER=sim`
- [ ] `npm run seed` fresh
- [ ] server + dashboard running, hard refresh, WS LIVE badge on
- [ ] demo account-less URL ready (firebase hosting if shipped, else LAN)
- [ ] video recorded backup of the full beat run

## Video shot list (60–90s, submission requirement)

| # | Shot | Src |
|---|------|-----|
| 1 | Cold open on MAP — planes moving, "this is the estate" | live board |
| 2 | LAUNCH SWARM click — agents register, ontology blooms | live board |
| 3 | INVARIANTS filling green; expand one spec | live board |
| 4 | **Kill unimatic** — cascade red, GROUND STOP banner, planes hold | live board |
| 5 | Violations → triage event → response agent runs `hub-failover` | live board |
| 6 | Board greens, planes resume, "mission: resolved" in FEED | live board |
| 7 | Code flash: `ModelProvider` call sites + a `skills/*.md` file | VS Code |
| 8 | Title card: ARSU · stack (Gemini API, Firestore, GCP) · repo URL | post |

## Submission checklist (due Fri Nov 27, Google Form)

- [ ] GitHub repo link — commit history tells the scratch-built story
- [ ] Demo video (60–90s) uploaded + linked
- [ ] README quickstart verified cold on a second machine
- [ ] `.env.example` covers everything; no secrets committed
- [ ] Theme confirmed with organizers (see HACKATHON.md open item)
- [ ] Devpost/MLH fields filled if the form asks
