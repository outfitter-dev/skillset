---
"@skillset/schema": patch
---

Tighten the exported structural validators to match the JSON Schema: `validateSingleFileRootConfig`, `validateWorkspaceConfig`, `validateSplitWorkspaceConfig`, and `validatePluginConfig` now reject `<target>.skills.path` and malformed `<target>.skills` selections, and `validateSourceMetadata` rejects `outputs.skills.<target>`, because provider skill roots are fixed. `SOURCE_UNIT_SELECTOR_PATTERN` and `ROOT_DRAFT_SELECTOR_PATTERN` now admit only slug plugin ids (`^[a-z0-9][a-z0-9-]*$`), matching the ids Core accepts. Validation-tightening.
