# Kin

**A health companion for people far from care.** It knows your medicines,
checks you when something feels off, and gets you ready for an emergency,
with or without signal.

Built for Hack @ DevFest Sudbury (MLH), November 2026. Themes: Health & Care,
North / Place, Language & Culture, Community & People.

> Kin is a demonstration. It is not a medical device and has not been
> clinically reviewed. See [docs/SAFETY.md](docs/SAFETY.md).

## Demo video

[Watch the 85-second demo](docs/kin-demo.mp4). A real screen recording of the app,
driven by `scripts/record-demo.ts` against the built app, including the
offline steps.

## What it does

| Mode | What happens |
|---|---|
| **Medicine** | Add what is in your cabinet by name, DIN or a photo of the label. Kin matches each one to Health Canada's Drug Product Database and flags the same drug twice and well-known risky pairs |
| **Check** | Say what is wrong. Take your pulse with a fingertip on the camera, let Kin count your coughs, add a photo. Kin tells you how urgent it is and what to do. It never diagnoses |
| **Ready** | Practise CPR on a pillow. The phone's motion sensor measures your pace and Kin coaches you to 100 to 120 pushes a minute |
| **Emergency** | One button: the 911 call, your location to read out, the first-aid steps you practised, and your medical summary |
| **Clinic** | The nurse's screen. Notes arrive sorted by urgency. The community view shows clusters of illness and how many households have practised CPR |

It runs in airplane mode. A note written with no signal is delivered when the
signal returns.

## The safety rule

**The AI assists, the protocol decides, a human is in charge.**

Gemini listens, reads labels and words the nurse's note. Urgency comes from a
written protocol (`src/data/protocol.ts`), first-aid steps from fixed scripts,
and measurements from sensors. Every AI output passes `src/ai/guard.ts`.

## Google stack

| Piece | Use |
|---|---|
| Gemini API (Firebase AI Logic) | Signs from free speech in any language, label reading, photo description, the nurse's summary. JSON against a schema every time |
| Gemini Nano (Chrome Prompt API) | The same understanding on the device when there is no signal |
| Cloud Firestore | Notes and anonymous community counts, with its offline queue |
| Firebase Auth, Rules, Hosting | Anonymous by default; only listed clinicians read notes |
| Material 3, Google Sans Flex, Material Symbols | The interface, with colour from Google's Material colour library |

## Run it

```bash
npm install
npm run dev            # http://localhost:4790
```

Nothing else is required. With no configuration Kin runs in demo mode: shared
data stays in this browser, and the clinic view is the same browser at
`#/clinic`. Add `?demo` to the address so the 911 button never dials.

To turn on Gemini and Cloud Firestore, create a Firebase project, enable
Firebase AI Logic (Gemini Developer API), Firestore and Anonymous sign-in,
then copy `.env.example` to `.env.local` and fill it in.

```bash
npm run typecheck
npm test               # protocol, sensors, medicines, clusters, guards, translations
npm run build
npm run preview        # serves the build on http://127.0.0.1:4790
npm run test:e2e       # the demo journey in Chrome, including offline
npm run seed:drugs     # refresh the Health Canada snapshot
```

## Read next

- [docs/PITCH.md](docs/PITCH.md): the one-sentence pitch and the 90-second demo
- [docs/SAFETY.md](docs/SAFETY.md): what the AI may and may not do
- [docs/SPEC.md](docs/SPEC.md): architecture and contracts
- [docs/DEMO.md](docs/DEMO.md): the booth script, click by click

## Credits

Medicine records: Health Canada Drug Product Database. First-aid text and the
triage protocol are demonstration content adapted from public guidance, and
are not endorsed by any organization named in the source comments.
