# @skillset/registry

`@skillset/registry` is Skillset's built-in registry package. It stores deterministic, versioned facts that the compiler and CLI use to reason about provider support without reaching out to live provider docs during normal builds.

The package is also the reference contract for future provider registry packages. Those packages should describe provider facts in the same shapes used here so Skillset can eventually merge built-in and external compatibility evidence deliberately.

## Owns

- Provider destination-format snapshots.
- Provider schema snapshots and manual overlays.
- Hook evidence and provider capability facts.
- Known provider migration classifications.
- Shared registry types and validation helpers.

## Does Not Own

- Compiler graph construction.
- Rendering behavior.
- Import/adopt execution.
- Dynamic loading of third-party registry packages.

Registry packages should make provider knowledge inspectable and deterministic. Compiler behavior still belongs in `@skillset/core`, where registry facts can be consumed through explicit interfaces.
