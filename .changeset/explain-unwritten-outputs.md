---
"skillset": patch
---

`skillset explain` no longer reports never-written outputs as `target state: sync`: it marks them `planned (not written)`, lists the render results blocking the build, prefers the writer of the exact path asked about (naming bundle files and their source), and limits feature support rows to targets enabled in `compile.targets`.
