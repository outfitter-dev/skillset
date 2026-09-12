---
description: Records immutable candidate evidence for the Agent Instructions, Agent Skills, and Agent Plugins portability profiles.
---

# Standard Profiles

The independent @skillset/registry standard-profile registry records the portable floor. Provider destination snapshots and Core capability tables stay separate: standards define portable structure while providers define native deltas and runtime evidence.

The initial Agent Instructions, Agent Skills, and Agent Plugins 1.0 profiles are all candidate. Agent Plugins stores the complete pinned plugin.json and mcp.json JSON Schema bodies for offline validation. Each profile also owns its expected feature envelopes for later adapter conformance.

Every snapshot stores the byte-for-byte body fetched from an immutable raw source revision. The registry records both that revision URL and the matching current raw URL for the same repository path. The current URL is used only by explicit maintenance commands, so a comparison is between the same source format and never an extracted or normalized website response. Normal builds remain offline.

| Profile | Immutable revision | Current comparison source |
| --- | --- | --- |
| Agent Instructions | [`agentsmd/agents.md@d001185` README.md](https://raw.githubusercontent.com/agentsmd/agents.md/d001185d792eb6402a58e4cbef1c228b309ec25d/README.md) | [`main` README.md](https://raw.githubusercontent.com/agentsmd/agents.md/main/README.md) |
| Agent Skills | [`agentskills/agentskills@69ef37e` specification](https://raw.githubusercontent.com/agentskills/agentskills/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx) | [`main` specification](https://raw.githubusercontent.com/agentskills/agentskills/main/docs/specification.mdx) |
| Agent Plugins 1.0 | [`agentplugins/agent-plugins-spec@1fc1b62` published specification](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/spec/1.0.0.md) and its `schemas/1.0.0/*.schema.json` files | The same specification and schema paths on [`main`](https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/spec/1.0.0.md) |

The standard-profile maintenance operation compares an explicitly fetched current raw source with the immutable snapshot. Its update mode is report-only: source drift never changes a snapshot or a lifecycle state without a reviewed registry edit. Reports name the current source URL for every changed or failed snapshot and include the captured request error for failures.
