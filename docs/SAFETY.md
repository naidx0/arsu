# Kin: safety design

Kin is a demonstration built for a hackathon. It is not a medical device and
has not been clinically reviewed. This document says how it is built so that a
failure is boring instead of harmful, and what must happen before real use.

## The rule

**The AI assists, the protocol decides, a human is in charge.**

| Decision | Who makes it | Where it lives |
|---|---|---|
| How urgent is this? | A fixed written protocol | `src/core/protocol.ts`, `src/core/triage.ts` |
| What first-aid step comes next? | A fixed script | `src/core/scripts.ts` |
| Is the pace right? What is the pulse? | A measurement | `src/core/cpr.ts`, `src/core/pulse.ts` |
| Which drug is this? What is in it? | Health Canada's Drug Product Database | `src/core/meds.ts`, `src/data/drugs.json` |
| Are two drugs risky together? | A fixed, sourced list | `src/data/interactions.ts` |
| What happens to the patient? | The patient, the nurse, the 911 dispatcher | People |

Gemini is used for understanding and writing: turning free speech into items
from a fixed symptom list, reading the text on a label, describing a photo,
and wording the nurse's note. Every AI output passes a guard
(`src/ai/guard.ts`) before it is used.

## What the guards enforce

1. **Symptoms.** The AI may only return ids from the protocol's symptom list.
   Anything else is dropped. It cannot return an urgency level.
2. **Labels.** A label read by the AI is only a search term. The medicine that
   gets added is the Health Canada record the person confirms on screen.
3. **Notes.** The nurse's note always contains the structured facts written by
   code. Gemini adds a plain summary. If that summary contains diagnostic
   wording, or Gemini is unavailable, the note goes out without it.
4. **Fallback.** If the AI is offline, slow or wrong, the keyword matcher, the
   protocol and the scripts on the phone still work. The symptom chips can
   always be tapped by hand.

## What Kin never does

- It never gives a diagnosis or names a condition as the cause.
- It never says someone is fine. The lowest result is "no emergency signs in
  what you told me", with how to reach a nurse.
- It never tells anyone to stop CPR, and never gives a dose beyond what is
  printed on a kit.
- It never says two medicines are safe together. No flag means "nothing on our
  short list", and the screen says so.
- It never places a call by itself. Dialling 911 is always the person's tap.

## Built to over-warn

- The result is the highest level any single sign reaches.
- A pulse outside the resting range raises a routine result.
- Age under 1 or 75 and over raises a routine result.
- Unknown or missing information never lowers a result.

## Emergencies

Practice is the main use. In a real emergency Kin does three plain things:
offers the 911 call, shows the location to read to the dispatcher, and shows
the same fixed script the person practised, with a beat to follow. The
dispatcher's instructions come first, and the screen says so.

## Privacy

- Medicines, profile and check history stay on the phone.
- A note leaves the phone only when the person sends it.
- Community signals carry an area, a symptom group and a day. They carry no
  name, no note and no device id. A weekly rotating random key lets the clinic
  count households without following anyone across weeks.
- Firestore rules allow a person to create and read only their own notes.
  Only accounts listed under `clinicians` can read notes and signals.

## Before real use

- A clinical lead reviews and signs every line of the protocol and scripts.
  The scripts here are adapted from public first-aid guidance and must be
  replaced with licensed text (Canadian Red Cross, Heart & Stroke).
- The interaction list is a short set of well-known risks. A real product
  needs a licensed, complete interaction database.
- The camera pulse reading needs validation on real phones across skin tones
  and lighting. It follows the published fingertip method but is unvalidated
  here.
- Cough recordings are counted and passed to the nurse. Screening from cough
  sound (Google's HeAR model) is future work and would need its own study.
- Privacy and health-information law review (PHIPA in Ontario), and
  agreement with each community on who owns its data.
