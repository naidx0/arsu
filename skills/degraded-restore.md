---
block: worker
failure: degraded
title: Degraded restore
steps:
  - { action: repair, target: . }
  - { action: restart, target: . }
  - { action: verify_only, target: . }
  - { action: escalate, target: . }
---
# Degraded restore

A worker that's degraded or serving corrupt output gets the standard
restore: repair any data corruption first (harmless if clean), restart
the service, re-run its proofs. Escalate on repeat failure — a worker
that won't hold a restart is a deeper problem.
