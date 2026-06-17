---
"skillset": patch
---

Add a `destination` dimension to render-result data so `target` always means the provider/runtime adapter (`claude`/`codex`) and `destination` names the concrete output artifact/scope under it (e.g. `skill`, `plugin-manifest`, `instruction`, `agent`, `target-native-island`, `skill-frontmatter`, plugin feature artifacts). The field flows through `.skillset.lock`, `skillset explain`/`doctor` JSON, and the explain/doctor text lines (`featureId -> destination`).
