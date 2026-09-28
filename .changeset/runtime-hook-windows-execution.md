---
"skillset": patch
---

Run discovered runtime-hook CLI runners and `SKILLSET_HOOK_COMMAND` overrides as argv, or through `/bin/sh` / `%ComSpec%`, including Windows `.cmd` and `.bat` shims in paths with spaces. Overrides that rely on shell expansion (`~`, globs, `NAME=value` prefixes) or start with a POSIX reserved word or shell built-in (`exec`, `exit`, `command`, `.`, `if`) still run through the shell, explicitly empty quoted arguments are kept, and a missing override executable exits 127 and one that cannot execute exits 126 instead of failing the hook.
