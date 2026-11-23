# ARSU next: two map layers, a learning swarm, a winning theme

**End state (Nov 27):** One screen shows a global map with two layers: the
**World** layer (things that move, such as flights) and the **Network** layer
(systems and the communication links between them). Every practice attack is saved to
Firestore, and the swarm uses those saved runs to triage better. A chart
shows recovery getting faster over repeated practice. The story is framed for
one kickoff theme.

## The layers, in plain words

| Layer | What it is | Aviation example | What can break |
|---|---|---|---|
| World | Physical things doing the job | Aircraft on routes | Grounded, delayed, lost position |
| Network: systems | Endpoints that hold or process data (servers, services, databases) | Dispatch, crew scheduling, Unimatic hub | Down, slow, wrong data |
| Network: comms | Links and messages between systems, and between systems and the world | Hub to dispatch feed, ADS-B positions, 406 MHz beacon | Cut, stale, replayed, corrupted, spoofed |

On the map, systems are points and comms are the lines between them, so the
Network layer shows both. The swarm maps the Network layer, writes checks for
every system and link, attacks it in practice, and repairs it.

ARSU is domain-agnostic. Any operation with systems talking over links fits:
air ambulance, hospitals, power grids, payments (the fraud case), or event logistics.
The engine (map, prove, attack, respond, verify, record) does not change.
Only the estate definition and the World layer change.

## The learning loop (the bank-fraud pattern)

1. **Practice:** a red swarm runs attacks (outage, cut link, stale feed,
   replayed or corrupted message). A blue swarm detects and responds.
2. **Record:** each run is saved to Firestore as `runs/{id}`, holding the
   topology snapshot, the attack, violations, the triage plan, actions,
   outcome, and time to recover.
3. **Learn now:** before triage, the orchestrator retrieves past runs with the
   same failure signature from Firestore. The verified outcomes go into the
   Gemini prompt as worked examples. Failed plans are labelled as failures.
4. **Learn later:** fine-tune on the accumulated verified runs (Gemini tuning
   on Vertex AI). The reward is objective: did every proof go green?
5. **Show it:** a chart of time to recover and wrong-skill rate across
   practice rounds.

Honesty rule: improvement is only claimed from real Gemini runs. SIM triage
is deterministic and cannot learn, so it is shown only as the baseline.

## Theme fit (names known; detailed theme notes still needed)

Recommended: **North / Place → "Northern lifelines".** Point the same engine
at remote Northern Ontario: air-ambulance and supply flights on the World
layer, and on the Network layer the dispatch servers, satellite and microwave
links, airport radio and weather feeds that remote communities rely on.
Secondary: Health & Care (medevac dispatch). Alternative: Work & Economy
(payments and fraud resilience). Use generic names, not real organizations.

## Slices, in order (each gated on its own)

1. **Two-layer map** (no dependency). Turn Airspace into the home map, with a
   World / Network switch, a side panel for health and swarm activity, and
   one plain-language status line. Gate: test:layout plus test:stage updated
   for the switch.
2. **Runs in Firestore** (needs a Firebase project and a service account
   from Max). Write `runs/{id}` on every finished practice run, and read
   history back on boot. Gate: a run survives a host restart.
3. **Practice autopilot**: N attacks back to back from a scenario mix, all
   recorded. Gate: test:mission variant with 3 rounds.
4. **Experience-backed triage** (needs a Gemini key). Retrieve similar
   verified runs, show them in the triage event, and chart the trend. Gate:
   one recorded live Gemini session with the provider labelled per call.
5. **Theme estate**: northern-lifelines estate and World data, behind the
   existing estate switch. Gate: test:demo on the new estate.
6. Video, pitch PDF refresh, submit by end of day Nov 27.

## Out of scope for Nov 27

Real fine-tuning, live external networks, real organizations' data, Firebase
Auth beyond gating the attack controls.
