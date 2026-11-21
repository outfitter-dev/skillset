# @skillset/provider-evidence

`@skillset/provider-evidence` is Skillset's private provider evidence package. It stores deterministic, versioned facts that the compiler and CLI use to reason about provider support without reaching out to live provider docs during normal builds.

External consumers use the versioned [hook catalog](../../docs/reference/registry/README.md) instead of importing this package.

## Owns

- Provider destination-format snapshots.
- Provider schema snapshots and manual overlays.
- Hook evidence and provider capability facts.
- Known provider migration classifications.
- Candidate-standard compatibility evidence and bounded consumer profiles.
- Candidate, adopted, and retired open-standard profiles with immutable instruction, skill, and plugin-schema evidence.
- Shared registry types and validation helpers.

## Does Not Own

- Compiler graph construction.
- Rendering behavior.
- Import/adopt execution.
- Dynamic loading of third-party registry packages.

Registry packages should make provider knowledge inspectable and deterministic. Compiler behavior still belongs in `@skillset/core`, where registry facts can be consumed through explicit interfaces.
