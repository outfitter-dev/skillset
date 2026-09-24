---
"@skillset/core": patch
---

Propagate operational filesystem errors from existence checks so permission, I/O, and symlink-loop failures cannot look like missing tests, lock provenance, eval inputs, retained runs, or watch roots.
