---
description: Routes authors to the public capability-design guide shipped with the Skillset plugin.
---

# Design an Agent Capability

Choose the smallest artifact that creates the behavior you need. A reusable procedure may need a skill; durable directory guidance may need a rule; a one-off task or existing setting may need no new artifact.

Read the [public capability-design guide](../../plugins/skillset/skills/skillset/references/capability-design.md) for:

- choosing among skills, agents, rules, hooks, configuration, scripts, plugins, MCP, and direct native work;
- writing a description with concrete positive, negative and ambiguous selection cues;
- keeping a short entrypoint with focused supporting references;
- checking what survives provider projection, including combined `AGENTS.md` guidance and tool-policy limits;
- separating deterministic checks, provider execution, and assessed model trials.

The guide ships inside the public plugin so agents can read it without repository documentation or a network lookup. Its authored owner is the plugin's shared reference, and Skillset copies it through the normal declared-resource mechanism. The router links it today; future init/design specialists can reuse the same source. Those planned specialists are not implied to be installed.

Continue with [Build Your First Skill](../start/quickstart.md) to author source or [Import Existing Work](importing.md) to inspect an existing capability before adoption.
