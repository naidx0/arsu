# AGENTS.md — working in the ARSU repo

ARSU = Attack Response Swarm Unit. Hackathon project for Hack @ DevFest
Sudbury (MLH). Agents map systems into ontologies, generate executable
invariants, and respond when invariants break.

## Read first

1. `docs/HACKATHON.md` — rules + constraints that decide what counts as done.
2. `docs/ARCHITECTURE.md` — the system shape.
3. `docs/SPEC.md` — field-level contracts. **The spec is the source of truth.**
4. `docs/LANES.md` — pick a lane; work only inside your lane's file ownership.

## Hard rules

- **Gemini is core, not a wrapper.** All agent reasoning goes through the
  `ModelProvider` interface (`packages/swarm`). Never hardcode provider calls
  outside it.
- Agents communicate **only through the Blackboard** (`packages/core`). No
  direct agent-to-agent calls, no shared memory outside the board.
- **Respect lane ownership** in `docs/LANES.md`. If you must touch another
  lane's file, change its interface in `packages/core` types first and say so
  in your commit.
- Everything builds from scratch here — commit early, commit often, clear
  messages. The judges look at commit history.
- TypeScript everywhere. Run `npm run typecheck` before committing.

## Commands

```bash
npm install          # install workspace deps
npm run dev          # ARSU host: sim + blackboard + swarm + API on :4780
npm run dev:ui       # dashboard dev server on :5173 (proxies /api + /ws)
npm run typecheck    # all workspaces
npm run seed         # regenerate data/flights.seed.json
npm run dev:recording
npm run dev:practice
npm run test:mission
```

Recording mode builds and serves the dashboard on :4780 with an empty,
in-memory Blackboard and explicit swarm launch. It never overwrites saved
mission data. Download rehearsal evidence before stopping the host.
`test:mission` starts its own ephemeral host on an available port, forces SIM,
and verifies discovery plus recovery from all four stress scenarios.

`npm run test:layout -w dashboard` checks all seven views at 320, 390, 768,
and 1440px using installed Google Chrome, then records a communications fault,
verified recovery, evidence download, and inspector navigation. First build the
UI and start a separate `--practice` host with `ARSU_PORT=4782` and
`ARSU_PROVIDER=sim`. The browser test requires this ephemeral SIM profile;
it can launch the swarm and inject a local fault. `ARSU_UI_URL` overrides the
loopback URL. Screenshots, video, and evidence go to the temporary artifact
directory printed by the test, or `ARSU_UI_ARTIFACTS` when set.

`npm run test:stage -w dashboard` drives the presenter's path on the aviation
estate: launch, Inject fault (hub outage), verified recovery. It needs a
separate `--recording` host with `ARSU_PORT=4783` and `ARSU_PROVIDER=sim`.

## Env

Copy `.env.example` → `.env`. Nothing is required to run — the default
provider is deterministic SIM mode. `GEMINI_API_KEY` flips the swarm to
Gemini. Firebase vars switch the blackboard from Local to Firestore.
