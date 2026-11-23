# Kin: booth demo script

About 90 seconds. Use a laptop for the clinic view and a phone (or a second
browser window at phone size) for the companion. Open the companion with
`?demo` in the address so the 911 button never dials.

In demo mode both views must be in the same browser. With Firebase configured
they can be on different devices.

## Before you start

1. `npm run build && npm run preview`, or open the hosted link.
2. Companion: `http://127.0.0.1:4790/?demo`. Clinic: `http://127.0.0.1:4790/#/clinic`.
3. In the clinic view, press **Load a sample month**.
4. Have a firm pillow on the table.

## The script

| # | Do | Say |
|---|---|---|
| 1 | Medicine. Search "tylenol", add it. Search "nyquil", add it | "Two different boxes. Kin checked Health Canada's database: both contain acetaminophen." |
| 2 | Turn on airplane mode (or DevTools, Network, Offline). Reload | "No signal. This is most of the day in a lot of the north. Kin still opens." |
| 3 | Check. Say or type "my chest hurts and I can't catch my breath" | "It did not wait for a server. A written protocol on the phone made that call, not an AI." |
| 4 | Back to Today, Check again. "I have had a cough and a sore throat since Tuesday." Next. Pulse: fingertip on the camera | "The phone is the instrument. It only shows a number when the signal clearly repeats." |
| 5 | See what to do, then Send to nurse | "Saved. It is waiting for signal." |
| 6 | Ready, CPR, go to step 4, Start. A judge pushes on the pillow | "Too slow and it says push faster. It is measuring, not guessing." |
| 7 | Airplane mode off. Look at the clinic screen | "The note just arrived, sorted by urgency, with the medicine warning attached. And on the right: a dozen households with the same cough on the East Side this week. Nobody has called yet." |

## If something goes wrong

- No camera permission: type the pulse by hand in the same sheet.
- No motion sensor (laptop): tap the pad or press the space bar on each push.
- Speech not available: type instead. The chips can always be tapped.

## What to say about the AI

- Gemini reads what people say in their own words and language, reads
  medicine labels from a photo, and words the nurse's summary.
- With no signal, Gemini Nano on the device takes over where Chrome provides
  it, and Kin's own rules are always underneath.
- No model sets the urgency. If a summary diagnoses or reassures, a guard
  drops it and the note goes out with facts only.
