# HACKATHON.md — Hack @ DevFest Sudbury facts

Source: <https://www.mlh.com/events/hack-devfest-sudbury> +
GDG Sudbury LinkedIn announcement (Nov 13, 2026).

## Schedule

| What | When |
|---|---|
| Kickoff (online) + theme reveal | Sat **Nov 21**, 11:00 AM EST |
| Build window | Nov 21 → 27 |
| Submission due | **Fri Nov 27** (Google Form: GitHub repo + short demo video) |
| MLH submissions close | Sat Nov 28, 3:30 PM EST |
| Demo booth @ DevFest | Sat **Nov 28**, Collège Boréal, Sudbury |
| Judging | GDEs Wesley Chun (Cloud/Workspace) + Arcadio Quintero (Angular) at lunch; attendees = people's choice |

Prize: **$500**, one winner ("Best Use of the Google Gemini API") + MLH swag
kit. Winner demos live to the full DevFest audience.

## Qualification rules

- **Gemini must be a core feature — not just a wrapper.** Our answer: every
  agent decision (ontology authoring, invariant generation, spec writing,
  response planning) is a Gemini call through `ModelProvider`. The SIM
  provider exists for offline dev only and is clearly labeled.
- **Everything from scratch** — "your commits count." This repo was created
  Nov 22 inside the window; keep the commit trail honest.
- Required stack to build around: **Gemini API (free tier) · Gemini CLI +
  agents + skills · Google Antigravity · Firebase (Auth, Firestore, Hosting,
  Cloud Functions) · Google Cloud**.

## ⚠️ Open item: kickoff theme

The theme was revealed only at the Nov 21 kickoff and is not published
online. **Action: ask the organizers / GDG Discord what it was.** The
conference tagline is *"Build, Secure, Scale — developers and builders in
the agentic era"*, which ARSU maps onto directly (swarm **builds** the
ontology, invariants **secure** it, response units **scale** recovery) — but
if the hack theme differs, re-frame the pitch before submission.

## Why ARSU wins the room

- Judges are Cloud + Angular GDEs: a live control board (Firestore
  listeners → real-time UI) is exactly their aesthetic.
- The outage story is real and recent — Unimatic, Alaska, CrowdStrike,
  NOTAM. We demo against a simulation of the actual failure topology.
- "Swarm + blackboard + proofs" is a legible architecture that survives a
  90-second booth pitch: *watch the map, press chaos, watch it heal*.
