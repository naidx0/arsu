---
block: worker
failure: severed_dep
title: Dependency reconnect
steps:
  - { action: reroute, target: . }
  - { action: verify_only, target: . }
  - { action: escalate, target: . }
---
# Dependency reconnect

A dep_health proof failed while the dependency itself is green — the
edge is severed, not the service. Reroute the dependency: repoint to the
dep's standby when one exists, otherwise reconnect the original edge.
Re-run proofs to confirm the block is satisfied again.
