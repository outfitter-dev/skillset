---
"@skillset/core": patch
---

Fence remote-cache directory locks with an owner token and heartbeat, and share that owner-fenced lock machinery with the known-index and change-ledger callers.

During a mixed-version rollout, current processes wait rather than reclaiming a legacy or incomplete lock root because older processes cannot observe the new ownership fence. A timeout now names the lock directory and directs the operator to stop every Skillset process that can access it, confirm no owner is active, remove the directory, and retry. Stale current-protocol claims continue to recover automatically.
