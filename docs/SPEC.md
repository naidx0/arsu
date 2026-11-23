# Kin: specification

The spec is the source of truth. Pitch: [PITCH.md](PITCH.md). Safety:
[SAFETY.md](SAFETY.md).

## Shape

Kin is an installable web app (PWA). One build serves two surfaces:

- **The companion** (`#/`), phone-first: Today, Check, Medicine, Ready, and
  an Emergency screen reachable from everywhere.
- **The clinic** (`#/clinic`), desktop-first: incoming notes and the
  community view.

Everything the companion needs is cached on the phone by a service worker, so
it opens and works with no signal.

```
            phone                                   cloud
 ┌───────────────────────────┐          ┌──────────────────────────┐
 │ sensors  camera mic motion│          │ Gemini API               │
 │ core     protocol scripts │◄────────►│ (Firebase AI Logic)      │
 │          pulse cpr meds   │  online  │                          │
 │ ai       cloud │ on-device│          │ Cloud Firestore          │
 │          │ rules (always) │─────────►│ notes signals training   │
 │ store    on-device + sync │  queued  │                          │
 └───────────────────────────┘  offline └────────────┬─────────────┘
                                                     ▼
                                              clinic dashboard
```

## Layers

| Layer | Path | Rule |
|---|---|---|
| Core | `src/core` | Pure functions. No browser APIs, no network. Unit tested. Decides everything that matters |
| Data | `src/data` | The protocol's symptom list, first-aid scripts, drug snapshot, interaction list |
| Sensors | `src/sensors` | Thin wrappers over camera, microphone, motion, speech, location |
| AI | `src/ai` | One `Brain` interface with three tiers. Every output passes `guard.ts` |
| Store | `src/store` | One `Store` interface. Personal data on the device; shared data local or Firestore |
| UI | `src/ui`, `src/screens` | Material 3. English and French |

## AI tiers

`Brain` picks the best tier available for each call and reports which one ran.

| Tier | When | Used for |
|---|---|---|
| `cloud` | Online and Firebase configured | Symptoms from speech, label reading, photo description, note summary |
| `device` | Chrome's built-in Gemini Nano is available | Symptoms from speech, note summary |
| `rules` | Always | Symptoms by keyword match in English and French; note from a template |

Cloud calls go through Firebase AI Logic (`firebase/ai`, Gemini Developer API
backend). Device calls go straight to Chrome's built-in Prompt API
(`LanguageModel`), so they need no project and no network. Every request asks
for JSON against a schema, and the keyword matches are always merged in: a
model can add a sign from the protocol but cannot remove one.

## Triage contract

```ts
triage(input: { symptoms: SymptomId[]; pulse?: number; ageYears?: number; days?: number }): {
  level: 'emergency' | 'urgent' | 'soon' | 'routine';
  call: '911' | '811' | 'clinic';
  reasons: { symptom?: SymptomId; rule: string; basis: string }[];
  actions: string[];   // i18n keys
}
```

- `emergency`: call 911 now. `urgent`: speak to a nurse today (Health811 or
  the clinic). `soon`: book a visit in the next few days. `routine`: care at
  home, and what should make you check again.
- The level is the maximum over all signs. Modifiers only raise it.

## Data

Personal, on the device only:

- `profile` `{ name, birthYear, area, allergies[], conditions[], contact, lang }`
- `medicines[]` `{ id, din?, brand, ingredients[{ name, strength }], times[] }`
- `doses` `{ 'YYYY-MM-DD': { '<medId>@<time>': true } }`
- `checks[]`, `practice[]`

Shared (local in demo mode, Firestore when configured):

- `notes/{id}` `{ ownerId, area, createdAt, level, call, lang, symptoms[],
  words?, vitals{ pulse?, coughs? }, medicines[], flags[], facts, summary?,
  aiTier, status: 'sent' | 'seen' }`
- `signals/{id}` `{ area, group, day, key }` (anonymous)
- `training/{id}` `{ area, skill, day, key }` (anonymous)

A note written offline shows "Waiting for signal" and is delivered when the
connection returns (Firestore's offline queue, or the local outbox).

## Community view

- **Clusters.** For each area and symptom group: households this week against
  the mean of the three weeks before. A cluster is flagged at 5 or more
  households and at least 3 times the earlier mean.
- **Readiness.** Households with a CPR practice in the last 12 months, by area.

## Gates

| Gate | Command | Proves |
|---|---|---|
| Types | `npm run typecheck` | Contracts hold |
| Logic | `npm test` | Protocol, pulse, pace, medicines, clusters, guards |
| Build | `npm run build` | Production bundle and service worker |
| Journey | `npm run test:e2e` | The demo path in Chrome at phone size, including offline |

## Out of scope for this version

Live wearable data (Google Health API scopes need Google's review), cough
screening with HeAR, Indigenous languages (these need the communities), and a
direct link to 911 dispatch systems.
