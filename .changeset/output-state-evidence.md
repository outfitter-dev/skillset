---
"skillset": minor
---

Expose one typed five-state generated-output evidence classifier across build, diff, check, and status results, with deterministic lock provenance that distinguishes intact source-driven refreshes from edited generated metadata.

Three operations that previously continued on a degraded projection now refuse:

- **Source rename** aborts during planning when the projected build is blocked, listing the blocker codes and paths, so no write and no backup occurs. Previously the planner consumed a shadow build that had returned `ok: false`, and with no ownership baseline could emit an `update` targeting an unmanaged file.
- **Test evaluation** rejects a returned build `Result` with `ok: false` instead of letting a build-only experiment pass.
- **Release finalization** aborts rather than proceeding from an unusable projection.

When a soft `unsupportedDestination` policy (`warn`, `skip`, `force`) leaves no usable non-lock output, the specific diagnostic codes and source paths now reach status, readiness, and CLI evidence instead of collapsing into a generic `output-derivation-failed` blocker. The ordinary soft-policy case is unchanged: individually softened results stay non-blocking when usable output exists.
