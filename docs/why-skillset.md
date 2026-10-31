---
description: Explains why Skillset uses adaptive source to render honest provider-native agent loadouts.
---

# Why Skillset

Claude, Codex, and Cursor can all consume reusable agent guidance, but they do not share one file model or one capability set. Hand-maintaining a tree for each provider duplicates common intent, lets copies drift, and makes unsupported behavior easy to overlook.

Skillset gives a repository one authored source tree. It derives predictable details, validates the source contract, and renders each enabled target in that provider's native shape. Authors can share a meaning when the providers genuinely share it and keep explicit provider-native configuration when they do not.

## Standards provide the portable floor

Applicable adopted Agent standards give source a portable baseline. Provider renderers can add native refinements or emit independent files when the provider has a different model. Standards are the floor, not the capability ceiling: authors can retain genuine provider-specific intent, while unsupported or lossy mappings remain visible in build results.

One package can therefore share portable skills while carrying supported native manifest formats and extensions. The [projection chart](start/how-rendering-works.md) shows how those outputs relate; the [multi-provider distribution example](../examples/distribution/README.md) builds a concrete shared package. Neither shared packaging nor successful compilation proves that a runtime has installed or activated it.

## What Skillset optimizes for

- **A smaller happy path.** Authors describe information only they know; names, destinations, and compatible metadata are derived where possible.
- **Honest portability.** Near matches are modeled by intent. Missing or lossy destinations stay visible instead of becoming fake equivalence.
- **Reviewable output.** Generated files and lock provenance are deterministic, local to the repository, and suitable for ordinary code review.
- **Early feedback.** Schema errors, unsupported features, unsafe mappings, collisions, and drift appear before they become runtime surprises.
- **Native results.** Claude output looks like Claude, Codex output looks like Codex, and Cursor output looks like Cursor.

## What Skillset does not do

Skillset is not a runtime manager or a universal agent-file format. It does not make every provider feature portable, hide target-specific tradeoffs, or treat generated output as source truth.

Build commands render files without installing, trusting, activating, symlinking, or mutating user-level provider configuration. The [build-versus-activation boundary](start/build-versus-activation.md) keeps compilation reviewable and leaves runtime authority with the user and provider.

## When it fits

Use Skillset when a repository needs reusable agent material across one or more providers, wants generated output committed or checked for drift, or needs a safe route for adopting existing provider-native work.

For a one-off file used by one provider, direct native authoring may be simpler. Skillset earns its place when derivation, validation, portability, or reproducibility removes more maintenance than the source layer adds.

Continue with the [first-author journey](start/README.md) or consult the [feature support matrix](reference/support-matrix.md) for current provider evidence.
