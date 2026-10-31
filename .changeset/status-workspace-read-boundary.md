---
"skillset": patch
---

Guard status's workspace file reads before following symbolic links, including source/config, release entries, licenses, and generated outputs. A symlink may select the workspace root; links beneath it are not followed during status inspection. Preserve ordinary reader behavior for other commands and retain a rejected read as command failure even when an intermediate optional reader catches it.
