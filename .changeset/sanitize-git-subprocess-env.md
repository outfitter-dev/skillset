---
"skillset": patch
---

Sanitize hook-exported Git repository variables for every compiler, toolkit, and test-sandbox git subprocess so `GIT_DIR` cannot retarget `git -C` or cwd discovery.
