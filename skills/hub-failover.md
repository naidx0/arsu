---
block: hub
failure: down
title: Hub failover
steps:
  - { action: failover, target: . }
  - { action: verify_only, target: . }
  - { action: escalate, target: . }
---
# Hub failover

The hub is the single point of failure — when it drops, every dependent
block cascades red. The estate keeps a cold standby replica for exactly
this. Fail traffic over to the standby, then re-run the block's proofs.
Only page a human if the standby can't hold the contract either.
