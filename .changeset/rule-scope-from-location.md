---
"skillset": minor
---

A rule's directory under `.skillset/rules/` is now its scope: `rules/<dir>/<topic>.md` renders `<dir>/AGENTS.md`, `rules/<topic>.md` is unscoped, and `paths:` narrows files within the scope relative to it. Claude and Cursor globs are derived from the scope, with the literal scope escaped for Claude. Destinations no longer depend on which files exist in the working tree.

Wildcard scopes (`[.]`, `[...]`) render nothing and record an `unsupported` result until wildcard expansion lands. Codex `paths:` narrowing and unescaped Cursor punctuation are reported as `degraded` render results. Builds warn on an unmanaged `AGENTS.override.md` beside a generated `AGENTS.md`, on a `paths:` entry that repeats its scope directory, and on a scope directory that does not exist yet. Rule filenames may no longer contain `[` or `]`.

Migration: a top-level rule that relied on `paths:` to reach a nested `AGENTS.md` now lands in the root `AGENTS.md`; move it under `rules/<dir>/` and make its `paths:` relative to that directory.
