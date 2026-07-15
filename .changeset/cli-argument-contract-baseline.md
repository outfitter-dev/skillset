---
"skillset": patch
---

Reconcile CLI help and maintained argument contracts, including explicit reference flags, required lifecycle operands, and test status/tail grammar; reject previously ignored `lookup --root` and `hooks print --root` flags; constrain the hidden test worker to its internal protocol grammar; and make invalid grammar and undeclared-option diagnostics command-owned usage errors instead of leaking handler or global option-family behavior.
