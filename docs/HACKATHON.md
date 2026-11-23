# Hack @ DevFest Sudbury: rules and ARSU readiness

Research checked November 22, 2026. This is the GDG Sudbury / MLH event,
not a separate global Google competition. Confirmed facts and our assessment
are separated below. No public weighted judging rubric was found.

## Primary sources

- [MLH event listing](https://www.mlh.com/events/hack-devfest-sudbury)
- [MLH registration event](https://events.mlh.com/events/15656-hack-devfest-sudbury)
- [GDG hackathon page](https://gdg.community.dev/events/details/google-gdg-sudbury-presents-hack-devfest-sudbury-mlh-hack-day/)
- [GDG organizer announcement, November 13](https://www.linkedin.com/posts/gdg-sudbury_devfest-devfestsudbury-gdg-activity-7526839295735681024-9xde)
- [MLH Gemini prize category](https://www.mlh.com/events/hack-devfest-sudbury/challenges/019d43c3-bed0-523b-a04f-80bd5fcc8276)
- [DevFest conference and agenda](https://gdg.community.dev/events/details/google-gdg-sudbury-presents-devfest-sudbury-2026-build-secure-scale-developers-and-builders-in-the-agentic-era/)

The prize category is listed by MLH and appears in search results. Direct
fetches of that route returned the parent event page, so its detailed text
couldn't be independently read through that route.

## Confirmed requirements and event facts

- Gemini must do substantive work in a core product function. A cosmetic
  chatbot or summary alone doesn't establish that requirement.
- Work starts from scratch at the kickoff. The organizer explicitly says
  commits count. Keep the actual history and credit external references.
- Solo entries and teams are allowed. The public pages don't state a team-size
  cap or a precise video duration.
- Submission requires a GitHub repository and a short demo video through a
  submission form. The inspected pages don't provide a verified form URL.
- Publicly listed prize category: **Best Use of the Google Gemini API**.
  The event advertises one $500 winner. No separate aviation, cybersecurity,
  infrastructure, or social-impact track was found in the inspected sources.
- Judges named on the GDG event: Wesley Chun and Arcadio Quintero. The organizer
  announcement says judging happens at lunch and attendees also vote.
  The weighting between judges and attendees isn't published.
- Kickoff: Saturday, November 21, 11:00 AM EST, online. In-person demos:
  Saturday, November 28 at College Boreal, Sudbury.
- Kickoff themes, shared with participants (eight, all framed around Gemini):
  Make DevFest Easy · **North / Place angle** · Health & Care ·
  Nature & Environment · Community & People · Students & Youth ·
  Work & Economy · Language & Culture.
- Submission deadline confirmed by the organizer: **end of day Friday,
  November 27**. Submitting by then gets booth space in the DevFest
  networking area on Saturday, November 28.

The event lists Gemini API, Gemini CLI with agents and skills, Google
Antigravity, Firebase, and Google Cloud under what to build with. The public
qualification sentence explicitly requires core Gemini use. It doesn't say
that every listed product or every Firebase service is mandatory. Confirm
that point with the organizer before treating the list as a checklist.

## Conflicts and missing information

### Submission deadline

Resolved. The MLH/GDG copy ("Friday, November 21st") was wrong — November 21
is the Saturday kickoff. The organizer's kickoff material now confirms
**end of day Friday, November 27**, tied to booth space on November 28.

### Kickoff theme and tracks

Resolved. Eight themes were shared at kickoff (list above). **ARSU's primary
match is North / Place angle**: northern aviation runs on thin redundancy,
and a swarm that maps, proves, and repairs critical communication paths is
a north-connectivity story, not just an aviation one. Secondary fit is
Work & Economy (critical-infrastructure reliability).

The MLH registration page links an organizer WhatsApp group and Contact Host.
Use those channels to confirm the theme, deadline, submission form, rubric,
video limit, team rules, and any required tools. This research didn't join a
group or send a message.

### Booths

The organizer post says every team gets a booth. The event listings describe
a dedicated booth for the winner. Confirm logistics; don't promise a booth
based on one version of the copy.

## ARSU assessment

This is our engineering assessment, not an official score or eligibility ruling.

### Strongest evidence

- Both actual swarm rehearsal profiles pass isolated HTTP-based integration
  tests. The airline profile discovers 8 systems and 8 links, authors 33 checks,
  and recovers from 4 faults. Communications practice discovers 8 components
  across 3 layers and 7 links, authors 34 checks, and recovers from 4 message faults.
- Readiness and recovery depend on stored records and fresh passing results.
  Triage isn't treated as resolution. Before/after evidence can be downloaded.
- Public aviation references, our modeled topology and messages, and observed
  ARSU-process telemetry are labeled separately. This avoids claiming private
  FAA access or a protocol implementation we haven't built.
- Git author timestamps start November 22, inside the advertised build window.
  History supports the timeline; timestamps alone can't prove originality.

### Biggest qualification risk: proving Gemini's contribution

`packages/swarm/src/provider.ts` contains the actual Gemini API integration.
Recon descriptions, invariant authoring, specs, and response planning call
`ModelProvider`; the summary endpoint uses the same boundary.

The automated mission runs force SIM. They prove orchestration and recovery,
not live Gemini generation, reasoning quality, or model availability. Record
at least one real Gemini run with bounded source input, structured output,
the selected response skill, and the resulting verification evidence.

The graph's declared dependencies come from the local registry. Don't describe
that as Gemini discovering an unknown real network. Explain where source
observations end and generated descriptions, contracts, and plans begin.

`ResilientProvider.name` retains the primary provider's name after an agent-call
fallback; the fallback is logged on the server. A configured Gemini label alone
therefore doesn't prove a particular agent result came from Gemini. Summary
fallback attribution has its own validation. Per-call attribution is a high
priority before filming any claim of live Gemini reasoning.

### Google stack and remote product gaps

A Firestore Blackboard adapter exists. Live Firestore persistence hasn't been
verified in this work. No Firebase Auth implementation or Firebase deployment
configuration was found in the inspected source/config paths. Hosting,
Functions, and Google Cloud deployment aren't demonstrated by local tests.

These are product/demo gaps. The published wording doesn't establish them as
separate disqualifiers. Don't add services solely to collect platform badges.
If we show Firebase, demonstrate actual persisted evidence and authorized access.

### Demo and pitch gaps

The new screens haven't had a real-browser visual review. The submission video
hasn't been produced in this work. The PDF is a learning aid, not the required
demo video. A local working server isn't a verified remote deployment.

Lead with one operator problem: a host looks healthy while communication data
is corrupted, replayed, missing, or stale. Follow one failure from its receipt
through a contract, response task, skill action, and post-response verification.
Keep the three-layer explanation short enough to follow without ontology jargon.

## Recommended order before submission

1. Confirm the kickoff theme, actual deadline/form, and judging rubric through
   the organizer channel. Check whether all named Google tools are required.
2. Capture a real Gemini-backed contract/planning run and label every fallback
   accurately. Prove what Gemini contributes beyond a deterministic playbook.
3. Visually check the recording flow. Produce the short video and verify a clean
   checkout can run the same scenario. Include a failed/escalated outcome too.
4. If remote access is part of the pitch, finish and test authentication and
   deployment. Demonstrate Firestore persistence only when it's actually active.
5. Package the repo, recording, source credits, and limits. Keep simulation,
   local observation, and live external data distinct throughout.

Conference fit looks good: its agenda includes agent-fleet orchestration and
reliable Gemini API use. That's useful context for the pitch, not evidence of
private judging preferences. Without a published rubric, numeric readiness
scores or invented judging weights would be misleading.
