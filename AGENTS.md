# AGENTS.md: working in the Kin repo

Kin is a health companion for people far from care. Hackathon project for
Hack @ DevFest Sudbury (MLH). Prize category: Best Use of the Google Gemini API.

## Read first

1. `docs/SAFETY.md`: the rule every change must keep.
2. `docs/SPEC.md`: layers and contracts. The spec is the source of truth.
3. `docs/PITCH.md` and `docs/DEMO.md`: what gets shown.

## Hard rules

- **The AI assists, the protocol decides, a human is in charge.** No model
  output may set an urgency level, add a first-aid step, or diagnose. Every
  model output goes through `src/ai/guard.ts`.
- `src/core` is pure: no browser APIs, no network. Anything that decides goes
  there and gets a unit test.
- Personal data (profile, medicines, history) stays on the device. Only
  `notes`, `signals` and `training` are shared, and signals carry no identity.
- Kin never says a person is fine or that medicines are safe together.
- Every string is in `src/i18n.ts` in English and French. `tests/words.test.ts`
  fails on a missing, unused or mismatched entry.
- Medical content (`src/data/protocol.ts`, `scripts.ts`, `interactions.ts`) is
  demonstration text. Do not present it as reviewed or endorsed.

## Commands

```bash
npm run dev          # dev server on :4790
npm run typecheck
npm test             # unit tests
npm run build
npm run preview      # built app on 127.0.0.1:4790
npm run test:e2e     # needs the preview running; drives Chrome, includes offline
npm run seed:drugs   # rebuild src/data/drugs.json from Health Canada (about 8 minutes)
```

The journey test uses `?demo`, which stops the 911 button from dialling. Never
remove that from a test.

## Env

Nothing is required. `.env.local` with the `VITE_FIREBASE_*` values turns on
Gemini (Firebase AI Logic) and Cloud Firestore. Never commit it.
