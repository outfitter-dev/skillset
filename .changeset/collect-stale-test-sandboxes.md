---
"skillset": patch
---

Share the test-sandbox descriptor parser with cleanup of stale retained test sandboxes. New sandboxes carry repository and runner-process leases so cleanup fails closed for unverified roots and only collects old sandboxes after the lease owner has exited.
