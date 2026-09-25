---
"skillset": patch
---

Reject provider skill root overrides and non-slug plugin selectors during shared schema validation, so `skillset build` and `skillset check` fail on input the JSON Schema already rejected. Root `skillset.yaml`, split `.skillset/config.yaml`, and plugin `skillset.yaml` now reject `<target>.skills.path` and malformed `<target>.skills` selections. `skillset.outputs.skills.<target>` (and a non-object `skillset.outputs.skills`) is now rejected in root and plugin config, the split-layout `.skillset/skillset.yaml` root manifest, and skill, agent, and instruction frontmatter. Root `drafts` selectors accept only slug plugin ids (`plugin.<slug>.skill:<name>`), matching the plugin ids Core loads. Validation-tightening.
