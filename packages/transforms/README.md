---
description: Contributor contract and safety checks for Skillset's source-text transform registry.
---

# Source-text transforms

This package recognizes provider-shaped text and reports or transforms it under an explicit entry contract. It applies the repository [tenets](../../docs/project/tenets.md) and [adoption decision](../../docs/adrs/0024-one-action-repo-adoption.md); it does not own provider rendering, adoption reports, or the source schema.

## Adding or widening an entry

A hard-coded transform infers portable meaning solely from a raw token, filename, directory prefix, provider name, or lexical pattern that can mean something else, or emits a destination without an equivalent provider contract. Do not add one. Recognizing syntax is useful for review; it is not permission to rewrite it.

For example, `@alice` can be a social handle, `@media` can be CSS, and `@scope/package` can be a package. `.claude/plugins/marketplaces` does not establish a corresponding `.codex/plugins/marketplaces` directory. A sentence comparing `CLAUDE.md` with `AGENTS.md` must retain both names. Code fences and inline examples do not establish invocation intent.

Prefer an exact typed intent or an explicitly selected provider boundary. The test-only `source-intent:demo` to `target-intent:demo` protocol in the engine and integration tests is a positive control: both sides have a defined meaning and the source explicitly requests it. It is not evidence for a real provider capability.

Before proposing a real rewrite, include all of the following in the entry's evidence notes and review:

1. The recognized source meaning, with current primary evidence supporting the full accepted shape, including capture groups and surrounding-context assumptions.
2. The destination meaning, with current primary evidence for every declared direction. Name the exact fields, files, or behavior that implement it. One source can establish both sides only when its cited section actually does so.
3. An explanation of why behavior is preserved. If evidence is missing, stale, or narrower than the recognizer, preserve and report the input or leave it provider-native. Do not promote unknown meaning to portability.
4. A supported example and nearby negative cases: handles, CSS, decorators, package scopes, fences, inline literals, mixed-provider prose, filename suffixes, and provider cache/marketplace paths where relevant. Test the actual recognizer and rendered bytes, not only a reversible replacement.
5. Explicit loss or unsupported behavior using the owning compiler/report contract. This package's `none` and reason do not constitute a complete adoption-report taxonomy.
6. Any exception's rationale, responsible owner, exact provider scope, evidence date, limitations, and regression cases. A compatibility exception cannot silently broaden into a general mapping.

A recognized span must not opt unrelated text in the same document into translation. Ambiguous detectors stay report-only. If the required behavior needs context or an author decision unavailable to this package, implement it at the owning typed boundary rather than guessing inside a regex.

## Mechanical checks and their limits

`registerTransformEntry` requires evidence, a reason for report-only entries, supported regex flags, and the recognizer/renderers for each declared direction. Report-only entries cannot carry renderers. These are structural checks; a URL and date in metadata do not prove semantic equivalence or freshness.

The [safety corpus](src/__tests__/safety-policy.test.ts) covers every built-in detector with recognition and collision cases. A new built-in entry fails until it receives deliberate corpus coverage. Current built-ins are report-only; enabling a rewrite requires replacing that disposition with reviewed source-and-destination semantic fixtures. The corpus exercises both directions and includes a reversible path substitution that still invents an unsupported destination.

The corpus is finite. Reviewers must inspect the recognizer's entire breadth, provider evidence and context assumptions; passing the corpus does not prove an arbitrary regex safe. The tests deliberately use the public recognition and transformation APIs rather than declaring evidence metadata sufficient.

Run the focused checks while editing:

```bash
bun run test:focused -- packages/transforms/src/__tests__
```

The repository's full test gate discovers these tests automatically. Also verify affected adoption and rendering integration tests, release records, and the normal aggregate gates. Preserve original external trees when comparing pinned fixtures. String reversibility alone is never an acceptance criterion for provider correctness.

Canonical policy and generated contributor guidance remain owned by the repository documentation and `.skillset/` sources. Update those owners when the contract changes; do not edit generated guidance or treat this package note as a replacement for the canonical policy.
