---
bump: patch
evidence:
  - scope: claude.settingsjson:settings.json
    sourceHash: sha256:3a0f18f5cdc0e1a544c32cc59d88e93d7fe16e5e7401389735f6d4eaf95708c7
  - scope: codex.hooks:hooks/hooks.json
    sourceHash: sha256:6ca86c5ba32c2d51e8b4abd3ed930a8fadeee76482ef9ba66067d4e5aae7f416
  - scope: config:root
    sourceHash: sha256:de21482cecafbeea2bb243a43c74d5532c9df62b1985473c68c977423254cbdb
  - scope: instruction:fixtures
    sourceHash: sha256:247809b60e25cb5a3948a439f60464505af61894e883652b4c3fc01a073b5f2e
  - scope: plugin.skillset.companion:README.md
    sourceHash: sha256:3ed6f484c676905f2f9f31728684c6b833e94923cea07d06627a7f63a1caa6e6
  - scope: plugin.skillset.skill:use-skillset
    sourceHash: sha256:f8abc4997ef47ef03f92e202990fe3bf52350cfa06c48f99e407a02e69282d34
  - scope: plugin:skillset
    sourceHash: sha256:4cca19146b3c7e456ba9fafeb20432389ea2fdb1bcdbb98615bac52c7ceee4e0
  - scope: skill:skillset-claude-development
    sourceHash: sha256:3de9fb4e07ec08c785d5d708d016a8956dbc566597829591902353b0d2b71fab
  - scope: skill:skillset-repo-test-fixtures
    sourceHash: sha256:573bec4cff9b134886976020be7e954bc9f913e8bb07c4266996fcb5952b6715
group: workspace-layout-cutover
id: ac040af5db5e
scopes:
  - claude.settingsjson:settings.json
  - codex.hooks:hooks/hooks.json
  - config:root
  - instruction:fixtures
  - plugin.skillset.companion:README.md
  - plugin.skillset.skill:use-skillset
  - plugin:skillset
  - skill:skillset-claude-development
  - skill:skillset-repo-test-fixtures
---

Move workspace-owned source, plugin guidance, provider islands, and release metadata into the canonical .skillset authoring layout.
