---
block: feed
failure: stale
title: Feed resync
steps:
  - { action: restart, target: . }
  - { action: verify_only, target: . }
  - { action: escalate, target: . }
---
# Feed resync

A feed gone stale or silent leaves downstream blocks reading old truth.
Restart the feed, then verify — the consistency proof between the feed
and its source is the check that matters. Escalate if the feed won't
come back into agreement.
