---
"@skillset/transforms": patch
---

Preserve ambiguous agent mentions, provider paths, and instruction filenames instead of rewriting them into another provider's spelling. These references remain visible in transform previews with an explanation, and no longer automatically opt imported files into dialect translation. This prevents literal prose and code examples from changing meaning or failing shared-output planning.
