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

## Beats (live, on the control board)

1. **Cold open** — map view: planes moving on real routes. "This is our
   simulated airline — same topology United runs on."
2. **LAUNCH SWARM** → agents register in SWARM panel; recon probes →
   ONTOLOGY graph blooms live; FEED scrolls probe receipts.
3. Verify agents author invariants → INVARIANTS board fills green, one spec
   expandable. "Every block now has machine-checkable proofs — authored by
   Gemini, stored on Firestore."
4. **CHAOS → Kill `unimatic`.** Cascade: W&B, dispatch, crew, pax, radar go
   red; `GROUND STOP` banner; planes hold at gates. "This is August 6th."
5. Proofs fail → violations → orchestrator triage event ("SPOF: unimatic,
   in-degree 5") → response agents load `hub-failover` skill →
   `unimatic-standby` activates → board greens → planes resume.
6. Close on SWARM panel: every decision receipted to the feed. "Imagine
   this pointed at a real estate — a million-dollar swarm mapping a company
   into proofs, and proofs into response."

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
- [ ] server + dashboard running, hard refresh, WS connected badge
- [ ] demo account-less URL ready (firebase hosting if shipped, else LAN)
- [ ] video recorded backup of the full beat run
