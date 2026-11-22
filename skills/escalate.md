---
block: worker
failure: unknown
title: Escalate
steps:
  - { action: escalate, target: . }
---
# Escalate

No remediation path matches, or automated response already failed twice.
Emit the page event and hand the violation to a human — the worst
outcome is a swarm that silently retries forever.
