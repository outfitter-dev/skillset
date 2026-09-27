---
"skillset": patch
---

Run discovered runtime-hook CLI runners and `SKILLSET_HOOK_COMMAND` overrides as argv, or through `/bin/sh` / `%ComSpec%`, including Windows `.cmd` and `.bat` shims in paths with spaces. Overrides that rely on shell expansion (`~`, globs, `NAME=value` prefixes) still run through the shell, and a missing override executable exits 127 instead of failing the hook.
