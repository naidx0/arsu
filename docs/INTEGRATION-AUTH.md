# INTEGRATION-AUTH.md — operators, scoped access, and the deeper Gemini surface

Notes toward the production identity path. **Nothing here is implemented** —
SPEC §7 keeps demo mode auth-free on purpose. This doc is what we'd build,
where it would land in this codebase, and what's worth the hours.

---

## A. Onboarding operators to a live ARSU mission

### Recommended model

Three tiers, all standard Firebase Auth — no custom auth code:

| Tier | Who | Sign-in | Access |
|---|---|---|---|
| **Operator** | incident commander, on-call | Google sign-in → invite link upgrades to `operator` claim | read everything; chaos/launch/reset via server REST |
| **Responder** | an agent's human backstop (per-mission temp) | email-link or Google via invite | read everything + `/api/resolve` only |
| **Guest viewer** | judges, observers, status-page | `signInAnonymously()` on page load | read-only board |

### The mechanics

**Claims, not databases.** Roles live in ID-token custom claims —
`{ role: 'operator'|'responder'|'viewer', mission: 'ops-2026-11' }`. The
blackboard already keyspaces cleanly by collection; scoping by `mission` is
one rules clause per collection. Custom claims are the only way to get
role-based checks inside both Firestore rules *and* a Node middleware without
duplicating a roles table.

**Expiring invite links.** One callable Cloud Function pair:

- `mintInvite(mission, role, ttlMinutes, maxUses)` — operator-only; writes
  `invites/{code}` = `{ mission, role, expiresAt, usesLeft }`, returns a
  URL (`/?invite=<code>`).
- `redeemInvite(code)` — callable, any signed-in user (incl. anonymous→link
  upgrade); validates expiry/uses → `admin.auth().setCustomUserClaims(uid, …)`
  → client calls `getIdToken(true)` to refresh.

Expiry comes free: the invite doc's `expiresAt` + ID tokens already
re-mint hourly, and `revokeRefreshTokens` + `validAfter` covers "kick this
contractor out now." For tighter TTL, store `claimsExpiresAt` in the invite
and re-check it in rules against `request.time`.

**Rules sketch** (the honest shape — *all writes go through the server*,
which uses the Admin SDK and bypasses rules entirely):

```js
match /{collection}/{doc} {
  allow read: if request.auth != null;                      // guests read
  allow write: if false;                                     // clients never write
}
match /invites/{id} {
  allow read: if request.auth.token.role == 'operator';
  allow write: if false;                                     // functions only
}
```

That's the whole ruleset for the current architecture. It gets more
interesting only if the dashboard reads Firestore directly in prod (it can —
the WS message shapes already match `onSnapshot` payloads): then viewer reads
get per-collection scoping (`events` + `specs` public, `tasks`/`violations`
operator-visible, `skills` restricted), and the server's WS fanout becomes a
fallback path.

**Why this and not the alternatives:**

- *Anonymous-auth-only + IP allowlist* — fine for a demo, zero story.
- *Full custom session service* — rebuilds what `setCustomUserClaims` already
  is; not hackathon-shaped.
- *Per-user docs in a `users` collection* — needed eventually for audit
  (`EventDoc.actor` could become a real uid), but claims carry the
  authorization decision today.

### Demo-facing caveat

Real auth is a **booth liability**: a sign-in wall between a judge and the
map is friction we don't want. The right demo posture is *anonymous guest
viewer on load* (invisible) + an "Operator sign-in" affordance that only
gates the chaos bar and launch button. Judge flow never hits auth at all;
the auth story is told in one slide, not experienced.

---

## B. What it would take in this codebase

Roughly half a day for the seam; a day+ for invites. Named files:

**Server (`packages/server/src/index.ts`)** — the only file that needs real
work:

- `firebase-admin` init next to `createBlackboard` (same `FIREBASE_*` env
  contract, already in `.env.example`).
- `verifyIdToken` middleware on the **mutating** routes:
  `POST /api/launch`, `/api/chaos`, `/api/reset`, `/api/resolve`,
  `/api/flights/live`. `GET /api/state` stays open for guests.
- WS `/ws` upgrade: accept `?token=` and verify, or leave read-only —
  guests watching the board is *desirable*.
- Thread `request.auth.uid` into chaos/resolve events (`actor` field exists
  on `EventDoc` — a one-line enrich).

**Core (`packages/core/src/firestore.ts`)** — already written; the gap is the
dependency. It dynamic-imports `@google-cloud/firestore` and throws a clear
error until the package + credentials exist. For an auth/ deploy push:
`npm i -w @arsu/core @google-cloud/firestore` and the existing env vars do
the rest. No interface change — `watch()` is already `onSnapshot`.

**Dashboard (`apps/dashboard/`)**:

- `package.json` + `src/api.ts` — add `firebase`, `initializeApp`,
  `signInAnonymously()` on boot, `GoogleAuthProvider` for the operator
  button; attach `Authorization: Bearer ${await getIdToken()}` in `post()`.
- `src/components/ChaosBar.tsx` — chaos + launch buttons render
  disabled/tooltipped until an operator token exists.
- `src/App.tsx` — `?invite=` redeem flow on load; auth state badge next to
  the existing SIM/GEMINI + WS badges.

**New files**: `firestore.rules`, `firebase.json` (Hosting →
`apps/dashboard/dist`, rules path), `functions/` for `mintInvite` /
`redeemInvite` callables (TypeScript, Admin SDK — the only net-new backend
surface).

**Types (`packages/core/src/types.ts`)** — optional: `OperatorDoc` /
`InviteDoc` if invites live on the board; `actor: string` already absorbs
uids with no change.

**Unchanged**: `packages/swarm/*`, `packages/sim/*`. Agents and the sim run
server-side under the service account — they never see end-user auth, which
is exactly the boundary you want.

**Docs**: `.env.example` gains `ARSU_AUTH=off|firebase`; SPEC §7 non-goal
flips to "implemented"; `docs/LANES.md` gains an auth lane.

**Effort read**: middleware + dashboard gate ≈ 2–4 h. Rules + hosting deploy
≈ 2 h + Firebase project provisioning. Invites + functions ≈ 4–6 h. Only the
first two are defensible inside the remaining window.

---

## C. Gemini beyond the current generate-and-parse

Current usage (`packages/swarm/src/provider.ts`): `generateContent` with
`responseMimeType: 'application/json'` for all `planJSON` shapes, plus
fence-stripping `JSON.parse`. Ranked by **demo value ÷ effort**:

### 1. Structured output — `responseSchema` · HIGH value / LOW effort

Every `planJSON` shape (`node`, `invariants`, `triage`, `spec`) already has a
known schema — pass it as `generationConfig.responseSchema` and delete the
prompt boilerplate + `stripFences` entirely. One-file change to
`GeminiProvider`. Kills the "Gemini returned prose mid-demo" failure class
that `ResilientProvider` currently papers over, and the schema itself is a
great thing to show a judge next to SPEC §1. **Do this first.**

### 2. Function calling / tool use · HIGH value / MED effort

Turn `planJSON` shapes into real `functionDeclarations`:
`record_node`, `author_invariant`, `mint_remediate_task`, `escalate`. The
agent loop then matches the actual agentic pattern judges expect from
"agents, not a wrapper" — model emits `functionCall`, host executes,
`functionResponse` goes back. Effort is real: `roles.ts` handlers become
multi-turn loops, and the `SimulatedProvider` needs parallel tool-stub logic.
Worth it only if there's a spare day; cite it as roadmap otherwise.

### 3. Embeddings for evidence search · MED value / MED effort

`node.evidence`, `events`, and `specs.body` are already receipt-shaped text.
`text-embedding` on write → cosine-match in triage gives "this violation
signature looks like the earlier `dispatch→notam` incident" — a real
dedup/memory story the orchestrator currently fakes with in-degree ranking.
Effort: embedding calls in provider + a small vector store in `core`.
Judge-visible only if we surface a "similar incidents" line in the triage
event — cheap UI, real feature.

### 4. Grounding with Google Search · MED value / LOW-MED effort

Verify agents could ground authored specs against real post-mortems
("this service pattern resembles the Aug 6 Unimatic SPOF"). Great
judge-adjacent narrative, thin product value, and it makes spec generation
slower + less deterministic. Nice-to-have flag on `doVerify`.

### 5. Model tiering · LOW value / TRIVIAL effort

`GEMINI_MODEL` is already env-driven. Route verify/triage to a heavier model
and keep recon descriptions on flash — costs nothing to wire, hard to *show*.

### 6. Gemini Live / streaming narration · LOW value / HIGH effort

Voice-narrating the `events` feed is flashy and fragile. Skip.

### Recommendation for the window

Do **(1) structured output** now — it hardens the demo and is one file.
Keep **(2) function calling** as the talk track for "what the agent loop
becomes with more time." Everything else below that line stays a doc.

---

## Bottom line

- **Auth**: anonymous viewers now, Google sign-in + custom claims for
  operators, expiring invites via callables, all client writes denied —
  the server stays the only writer. ~4 files + rules + one functions dir.
- **Gemini**: `responseSchema` is a same-day hardening win; function calling
  is the honest next-agent-loop story; embeddings are the dark-horse feature
  if triage needs a memory.
