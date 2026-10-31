---
description: Defines the public plugin closure guard's scope and bounded shell interpretation.
---

# Public Plugin Closure

`bun run public-closure:guard` checks generated public plugin content for routes into contributor-only skills, repository internals, fixtures, scripts and development documentation. Its owner is `scripts/public-closure-guard.ts`, with parser and operand helpers under `scripts/public-closure/`. It does not execute guidance, prove provider behavior or establish complete shell data flow.

## Literal here-string programs

Tree-sitter identifies here-string operands separately from file redirections. Ordinary consumers such as `cat` receive data; their literal payloads are not treated as commands. Actual outer command and process substitutions remain independently scanned.

Direct `bash`, `sh` and `dash` invocations, including executable paths such as `/bin/bash`, support one single- or double-quoted literal stdin program with no arguments or only `-s`. The scanner decodes the outer quote layer, then scans the resulting program through the existing Bash or POSIX-subset nesting parser. It preserves source ranges through removed escapes and UTF-8 position reporting. Explicit `-c` and script-file arguments do not select the here-string as the interpreter program.

The guard reports a bounded `shell-analysis` finding for recognized interpreter cases it cannot model: wrappers and their environment/cwd effects, other flags, dynamic or concatenated payloads, explicit descriptors, multiple/enclosing redirects, and recognized non-shell or unsupported shell interpreters. Node, Bun, Python, Perl, Ruby, Ksh and Zsh are not silently interpreted as Bash here-string programs. Existing heredoc handling remains a separate, finite contract.

Unknown consumers, arbitrary variable-based data flow, script-file contents and runtime environment changes remain outside this analysis. A clean result is not a general shell-safety claim. Resolve an analysis finding by making the public guidance directly inspectable or by adding a separately justified parser case with positive, negative and source-position tests; do not suppress it by assuming an interpreter's semantics.

Focused coverage lives in `scripts/__tests__/public-closure-herestring.test.ts` and the neighboring nesting, polarity, structure and operand suites.
