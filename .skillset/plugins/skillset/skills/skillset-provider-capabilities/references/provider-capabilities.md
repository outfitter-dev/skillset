<!-- Generated capability comparison; do not edit directly. -->

# Provider Capability Comparison Snapshot

Generated from the same crosswalk as `skillset lookup capability`. Read the matching concept and target rows, plus their destination formats when needed. Exact aliases can match more than one concept.

Authority pins identify bundled evidence, not its freshness against the live provider. Destination support and fidelity do not establish installation, activation, enforcement, or runtime effectiveness.

## adaptive-hooks

Reusable hook behavior. Family: hooks. Exact aliases: `hooks`, `hook.json`.

### claude: adaptive-hooks

- Skillset source: `hooks/<name>.json or hooks/<name>/hook.json adaptive hook units`. Contracts: `adaptive-hook`.
- Destination: [claude-hooks](#claude-hooks). Support: `transformed`.
- Realization: Defines reusable adaptive hook units and renders supported plugin and Claude frontmatter hook destinations with explicit unsupported-destination results.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:0067b6add96fd93e00d631473986d455b9b5d27e10c17f257ca4000c5a780384`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: adaptive-hooks

- Skillset source: `hooks/<name>.json or hooks/<name>/hook.json adaptive hook units`. Contracts: `adaptive-hook`.
- Destination: none recorded. Support: `degraded`.
- Realization: Defines reusable adaptive hook units and renders supported plugin and Claude frontmatter hook destinations with explicit unsupported-destination results.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:ee6a24597708fd4aea0fb324827302228718edc80f203af9ef922bea570e458f`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.
- Limitation: Codex supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and narrower event/matcher support.

### cursor: adaptive-hooks

- Skillset source: `hooks/<name>.json or hooks/<name>/hook.json adaptive hook units`. Contracts: `adaptive-hook`.
- Destination: [cursor-hooks](#cursor-hooks). Support: `degraded`.
- Realization: Defines reusable adaptive hook units and renders supported plugin and Claude frontmatter hook destinations with explicit unsupported-destination results.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:330a68ea2be2d2c6a5ff67de99d1fb08893747cbd6e5b2f8f75d932727532981`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.
- Limitation: Cursor supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and uses provider-native lower-camel event names.

## agent-instructions-standard

Agent Instructions portable baseline. Family: standards. Exact aliases: `agent-instructions`, `AGENTS.md`.

### claude: project-instructions

- Skillset source: `.skillset/rules/**/*.md`. Contracts: none recorded.
- Destination: none recorded. Support: `transformed`.
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:60010cc879097e7ce0e0280c1eea87d887e4a26c30724f8ef258616bb0d546dd`. Standards: `agent-instructions`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: project-instructions

- Skillset source: `.skillset/rules/**/*.md`. Contracts: none recorded.
- Destination: [codex-agents-md](#codex-agents-md). Support: `transformed`.
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:e07fe27a66cc3a081751d7c4d83a80314de380eb9e30ebcb113cff8b0b8f2877`. Standards: `agent-instructions`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: project-instructions

- Skillset source: `.skillset/rules/**/*.md`. Contracts: none recorded.
- Destination: [cursor-rules](#cursor-rules). Support: `transformed`.
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:a88b2fb22c6ff554ee2a089f117a5e5842c8e62269593112b75f811d6ee93c36`. Standards: `agent-instructions`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## agent-plugins-standard

Agent Plugins portable baseline. Family: standards. Exact aliases: `agent-plugins`, `agent-plugins-1.0`.

### claude: plugin-manifests

- Skillset source: `.skillset/plugins/<plugin>/skillset.yaml`. Contracts: none recorded.
- Destination: [claude-plugin](#claude-plugin). Support: `native`.
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:4d6b62adf26fd148e691bdf1491915922172ee110b15d83e6cba214493cebb08`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: plugin-manifests

- Skillset source: `.skillset/plugins/<plugin>/skillset.yaml`. Contracts: none recorded.
- Destination: none recorded. Support: `native`.
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:8fd801d278d9620d53bf8faff79ac56dcdbfffa0ebfdf830ee7807288c7e5023`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: plugin-manifests

- Skillset source: `.skillset/plugins/<plugin>/skillset.yaml`. Contracts: none recorded.
- Destination: [cursor-plugin](#cursor-plugin). Support: `native`.
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:30404c36e84d718005023ee0d35737f4a5bf6dc10d3d5bca00d1ad3584e6242d`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### claude: plugin-mcp

- Skillset source: `plugin mcp/source pointer or conventional .mcp.json`. Contracts: none recorded.
- Destination: [claude-plugin](#claude-plugin). Support: `native`.
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:0ab0977b2bb6ae38dfa5dac57cb2a9da3161b20a2cc72ab07df13705eecf47d4`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: plugin-mcp

- Skillset source: `plugin mcp/source pointer or conventional .mcp.json`. Contracts: none recorded.
- Destination: none recorded. Support: `native`.
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:ef3450cf0acca893e57573737a2a604f49c402c740c695cae881830e020403a4`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: plugin-mcp

- Skillset source: `plugin mcp/source pointer or conventional .mcp.json`. Contracts: none recorded.
- Destination: [cursor-plugin](#cursor-plugin). Support: `native`.
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:a6831e927ddf521f6c1ecf2da2866a38bc7586883180d6d14e74ccede3c05586`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### claude: plugin-skills

- Skillset source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md`. Contracts: none recorded.
- Destination: [claude-skill](#claude-skill). Support: `native`.
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:6c38d5cb4af370e552c19e312d55dd033846124a7018fcbb92102bd0b6d7e118`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: plugin-skills

- Skillset source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md`. Contracts: none recorded.
- Destination: [codex-skill](#codex-skill). Support: `native`.
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:012f3bfaa7d2f6453268d033a83370fa4ad82726e57392692fe25afa6b3779e3`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: plugin-skills

- Skillset source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md`. Contracts: none recorded.
- Destination: [cursor-skill](#cursor-skill). Support: `native`.
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:c5c11d51d0927cef098b3e1627700ae376d6374e7c1a5df1c2f0a8063bbe431c`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## agent-skills-standard

Agent Skills portable baseline. Family: standards. Exact aliases: `agent-skills`, `SKILL.md`.

### claude: standalone-skills

- Skillset source: `.skillset/skills/<skill>/SKILL.md`. Contracts: none recorded.
- Destination: [claude-skill](#claude-skill). Support: `native`.
- Realization: Projects standalone repo skills into configured target skill roots.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:1d416a18441fc1255608974f38c65c2b9a60ab096c98acc94017b47f42eafbdf`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: standalone-skills

- Skillset source: `.skillset/skills/<skill>/SKILL.md`. Contracts: none recorded.
- Destination: [codex-skill](#codex-skill). Support: `native`.
- Realization: Projects standalone repo skills into configured target skill roots.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:871bf46e45b4293eb8196695d6800ba0d1417e4b0d14c5887d5ecbdf56454984`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: standalone-skills

- Skillset source: `.skillset/skills/<skill>/SKILL.md`. Contracts: none recorded.
- Destination: [cursor-skill](#cursor-skill). Support: `native`.
- Realization: Projects standalone repo skills into configured target skill roots.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:45681072c603b4e9ef5f0185dda3fb8bcc504b2ed9e16a4b82dfa7e1ead02b79`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## native-hooks

Provider-native hook declarations. Family: hooks. Exact aliases: `hooks/hooks.json`.

### claude: plugin-hooks

- Skillset source: `plugin hooks/hooks.json`. Contracts: `hook`.
- Destination: [claude-hooks](#claude-hooks). Support: `pass_through`.
- Realization: Copies plugin hook declarations with registry-backed provider event and handler validation.
- Fidelity: **provider-only**. Scope: Claude-native plugin hook declarations retain Claude event and handler semantics through validated pass-through.
- Authority: `sha256:69cdb29880ac838f610030b9a714229efeb9fa034c35cd909426e1a0f5ac65fd`. Standards: none recorded.
- Limitation: The declaration is provider-native; identically spelled events on other providers do not establish equivalence. Use adaptive hooks for explicitly supported adaptation.

### codex: plugin-hooks

- Skillset source: `plugin hooks/hooks.json`. Contracts: `hook`.
- Destination: none recorded. Support: `pass_through`.
- Realization: Copies plugin hook declarations with registry-backed provider event and handler validation.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:89559f3e2cdef078bda68ae98badca16a299afbd65e9075de0e3933355bc9df5`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: plugin-hooks

- Skillset source: `plugin hooks/hooks.json`. Contracts: `hook`.
- Destination: [cursor-hooks](#cursor-hooks). Support: `pass_through`.
- Realization: Copies plugin hook declarations with registry-backed provider event and handler validation.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:b73a3a31afffb0678cad622edc3658d07e537a174d57a88a5645e842b43f8490`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## plugin-agents

Plugin-packaged agents. Family: plugins. Exact aliases: `agents/`.

### claude: plugin-agents

- Skillset source: `plugin target-native agents/`. Contracts: `plugin-config`.
- Destination: [claude-subagent](#claude-subagent). Support: `pass_through`.
- Realization: Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:e9332fc31d94d5a68e8862e719f48fbd74c4d23ae36059ad752fc9ede95276ce`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: plugin-agents

- Skillset source: `plugin target-native agents/`. Contracts: `plugin-config`.
- Destination: [codex-plugin](#codex-plugin). Support: `unsupported`.
- Realization: Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.
- Fidelity: **unavailable**. Scope: The pinned Codex plugin contract has no plugin agents component; Skillset cannot faithfully emit plugin-packaged agents there.
- Authority: `sha256:2f53e3b41d9d118724b6c36a899dfb54c0eff3d52bb66fbc0f9f532fa16fccb0`. Standards: none recorded.
- Limitation: This is a plugin-packaging limitation. It does not mean Codex project agents are unavailable.
- Limitation: Codex plugin documentation does not include a plugin agents component.

### cursor: plugin-agents

- Skillset source: `plugin target-native agents/`. Contracts: `plugin-config`.
- Destination: [cursor-agent](#cursor-agent). Support: `pass_through`.
- Realization: Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:e3c413d6f6a67e8df77d6095772c5cb9a43016296e059b15fa37922c4c7ef538`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## plugin-manifests

Plugin identity and components. Family: plugins. Exact aliases: `plugins`, `plugin.json`.

### claude: plugin-manifests

- Skillset source: `.skillset/plugins/<plugin>/skillset.yaml`. Contracts: `plugin-config`, `source-metadata`.
- Destination: [claude-plugin](#claude-plugin). Support: `native`.
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:12c2d8b42a7fc862d5ad9d75ea8f3847ccc94940972984216de81ebb5e535359`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: plugin-manifests

- Skillset source: `.skillset/plugins/<plugin>/skillset.yaml`. Contracts: `plugin-config`, `source-metadata`.
- Destination: none recorded. Support: `native`.
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:b9d72a38c0f514f17fed93a76a6aca6a95ec741f1f9751a0cae4d6f17796a34f`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: plugin-manifests

- Skillset source: `.skillset/plugins/<plugin>/skillset.yaml`. Contracts: `plugin-config`, `source-metadata`.
- Destination: [cursor-plugin](#cursor-plugin). Support: `native`.
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:d262a6ad1b79f1c4439f3fb0546e9488d01c21d0bdaead94481c9597a789a288`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## plugin-mcp

Plugin MCP servers. Family: mcp. Exact aliases: `mcp`, `mcpServers`, `.mcp.json`, `http_headers`.

### claude: plugin-mcp

- Skillset source: `plugin mcp/source pointer or conventional .mcp.json`. Contracts: `plugin-config`.
- Destination: [claude-plugin](#claude-plugin). Support: `native`.
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:079942d8a5ab4afe017fb4d3dcf582745fe73e23e9c58fdc7d3685df53958d01`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: plugin-mcp

- Skillset source: `plugin mcp/source pointer or conventional .mcp.json`. Contracts: `plugin-config`.
- Destination: none recorded. Support: `native`.
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:ddac384ad3b4733e476ad93bfd4949153d6737941feb66e4656f2a190db0f513`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: plugin-mcp

- Skillset source: `plugin mcp/source pointer or conventional .mcp.json`. Contracts: `plugin-config`.
- Destination: [cursor-plugin](#cursor-plugin). Support: `native`.
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:c9164e0983fbfddb64145186fc7a59de2fa60865493e3bb0ed9b22a45f2be072`. Standards: `agent-plugins-1.0`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## project-agents

Project agent instructions. Family: agents. Exact aliases: `subagents`, `developer_instructions`.

### claude: project-agents

- Skillset source: `.skillset/subagents/*.md`. Contracts: `agent-frontmatter`.
- Destination: [claude-subagent](#claude-subagent). Support: `native`.
- Realization: Renders portable project agents to Claude Markdown agents and Codex TOML agents.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:11e115524e7218ca3075e3f117914685ca5b26c563aa8fa85104d7a3242ee36c`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: project-agents

- Skillset source: `.skillset/subagents/*.md`. Contracts: `agent-frontmatter`.
- Destination: [codex-subagent](#codex-subagent). Support: `transformed`.
- Realization: Renders portable project agents to Claude Markdown agents and Codex TOML agents.
- Fidelity: **partial**. Scope: Project-agent name, description and instructions receive native TOML fields; shared skill-loading intent is only an instruction preface.
- Authority: `sha256:9ef3d5e5bfab312cb15b3d4455ff914c136c78223e70c0d0aa87dcc9096b5601`. Standards: none recorded.
- Limitation: The skills preface is advisory, not target-enforced skill metadata. Provider-only fields require explicit provider configuration.

### cursor: project-agents

- Skillset source: `.skillset/subagents/*.md`. Contracts: `agent-frontmatter`.
- Destination: [cursor-agent](#cursor-agent). Support: `native`.
- Realization: Renders portable project agents to Claude Markdown agents and Codex TOML agents.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:f76028d5578e855e024ce1da8a359ae9f57a7456c038a008c13f70e3672c1b9c`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## project-rules

Scoped project instructions. Family: rules. Exact aliases: `rules`, `AGENTS.md`, `CLAUDE.md`, `alwaysApply`.

### claude: project-instructions

- Skillset source: `.skillset/rules/**/*.md`. Contracts: `rule-frontmatter`.
- Destination: none recorded. Support: `transformed`.
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:4335b2b5465e69b2a3ce8ccb9e77a2282744a4bf5ce65d79e74d64f243331cf9`. Standards: `agent-instructions`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: project-instructions

- Skillset source: `.skillset/rules/**/*.md`. Contracts: `rule-frontmatter`.
- Destination: [codex-agents-md](#codex-agents-md). Support: `transformed`.
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Fidelity: **synthesized**. Scope: Generated rules with literal directory scope and no paths narrowing are combined in deterministic source-path order into the directory AGENTS.md.
- Authority: `sha256:bbeafbbf025b130dafbeb55deeaaad150e64ed7c7e58543e4269a3de7bd9bd40`. Standards: `agent-instructions`.
- Limitation: This judgment excludes paths narrowing, which is degraded, and wildcard scopes, which are unsupported. It describes generated files only. Native context limits and AGENTS.override.md shadowing still apply.

### cursor: project-instructions

- Skillset source: `.skillset/rules/**/*.md`. Contracts: `rule-frontmatter`.
- Destination: [cursor-rules](#cursor-rules). Support: `transformed`.
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:4634ed4caa47510ba445f81ed722d96d965fde278755b610e74d5f3ac1deeba7`. Standards: `agent-instructions`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## skill-invocation

Implicit skill invocation. Family: skills. Exact aliases: `implicit_invocation`, `disable-model-invocation`, `allow_implicit_invocation`.

### claude: skill-invocation-policy

- Skillset source: `skill implicit_invocation frontmatter`. Contracts: `skill-frontmatter`.
- Destination: [claude-skill](#claude-skill). Support: `transformed`.
- Realization: Lowers canonical skill invocation eligibility into provider-native policy.
- Fidelity: **equivalent**. Scope: The resolved implicit_invocation boolean is inverted into disable-model-invocation; false eligibility becomes true disablement and vice versa.
- Authority: `sha256:881316c3151aa8e4da5994858106862812011cdb4314968051d1c1f09a5adc68`. Standards: none recorded.
- Limitation: Scope is invocation eligibility only; this does not disable explicit user invocation or prove runtime enforcement. Explicit provider overrides are outside this judgment.

### codex: skill-invocation-policy

- Skillset source: `skill implicit_invocation frontmatter`. Contracts: `skill-frontmatter`.
- Destination: [codex-skill](#codex-skill). Support: `transformed`.
- Realization: Lowers canonical skill invocation eligibility into provider-native policy.
- Fidelity: **exact**. Scope: The resolved implicit_invocation boolean is represented directly as policy.allow_implicit_invocation in agents/openai.yaml.
- Authority: `sha256:f75055451ba906f201a1000360ac42e05696f5b5e3bc547c1bac66eb26b76fa9`. Standards: none recorded.
- Limitation: Scope is invocation eligibility only, not model compliance or user invocation. Explicit provider overrides are outside this judgment.

### cursor: skill-invocation-policy

- Skillset source: `skill implicit_invocation frontmatter`. Contracts: `skill-frontmatter`.
- Destination: [cursor-skill](#cursor-skill). Support: `transformed`.
- Realization: Lowers canonical skill invocation eligibility into provider-native policy.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:bd0386e496238da7cb03b7fcbd76f5c34693c18d1f0a06d7cbe873e1c656af09`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## skills

Reusable skill content. Family: skills. Exact aliases: `skill`, `SKILL.md`.

### claude: plugin-skills

- Skillset source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md`. Contracts: `skill-frontmatter`.
- Destination: [claude-skill](#claude-skill). Support: `native`.
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:12210b72c186f747bce9f6e51325ce84581e4ae6207c63063674200fc1fe8b97`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: plugin-skills

- Skillset source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md`. Contracts: `skill-frontmatter`.
- Destination: [codex-skill](#codex-skill). Support: `native`.
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:144accb9c562ddc9b9bbf86f24c4f66fab03718af36bd9ecda8c8b3ca4fb0e81`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: plugin-skills

- Skillset source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md`. Contracts: `skill-frontmatter`.
- Destination: [cursor-skill](#cursor-skill). Support: `native`.
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:b7fd75f646eb96e4aadc273f63b0626ab450888f42e394739a08fb9c5abd22cd`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### claude: standalone-skills

- Skillset source: `.skillset/skills/<skill>/SKILL.md`. Contracts: `skill-frontmatter`.
- Destination: [claude-skill](#claude-skill). Support: `native`.
- Realization: Projects standalone repo skills into configured target skill roots.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:fcb35966960170ef0205b0fcd7df9c158170c54a1550760df07c420ed0ff8fac`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: standalone-skills

- Skillset source: `.skillset/skills/<skill>/SKILL.md`. Contracts: `skill-frontmatter`.
- Destination: [codex-skill](#codex-skill). Support: `native`.
- Realization: Projects standalone repo skills into configured target skill roots.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:6dc2c2ff2dd32783f101c851bb8bdd393d697d2654421a99757a478b213fd0a3`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: standalone-skills

- Skillset source: `.skillset/skills/<skill>/SKILL.md`. Contracts: `skill-frontmatter`.
- Destination: [cursor-skill](#cursor-skill). Support: `native`.
- Realization: Projects standalone repo skills into configured target skill roots.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:47d0b3d3e3e42db88efb116935e3e3f4ae071c55ea59a0a75bdb7d84eb969aac`. Standards: `agent-skills`.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## tools-policy

Skill-local tool policy. Family: mcp. Exact aliases: `allowed-tools`, `disallowed-tools`, `.skillset.tools.yaml`.

### claude: tools-policy

- Skillset source: `skill tools frontmatter`. Contracts: `skill-frontmatter`.
- Destination: none recorded. Support: `transformed`.
- Realization: Portable keys lower to allowed-tools / disallowed-tools preapproval and denial rules; native overlay strings pass through verbatim.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:b046b5dd1f511e08d84e246950e721938969f199efd6ab4466a35d32da3b751e`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### codex: tools-policy

- Skillset source: `skill tools frontmatter`. Contracts: `skill-frontmatter`.
- Destination: none recorded. Support: `metadata_only`.
- Realization: Recorded as .skillset.tools.yaml metadata; no proven skill-local enforcement surface.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:9046faab8295e9fc769102c8fca6e0f13710b2cf376e9bf4132c109a84226057`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

### cursor: tools-policy

- Skillset source: `skill tools frontmatter`. Contracts: `skill-frontmatter`.
- Destination: none recorded. Support: `metadata_only`.
- Realization: Recorded as .skillset.tools.yaml metadata; no proven skill-local enforcement surface.
- Fidelity: **unknown**. Scope: No current reviewed semantic scope.
- Authority: `sha256:5382d345de6fa89469eb994267467709f2619da2b17a164ec44b8d63ea243915`. Standards: none recorded.
- Limitation: No semantic evidence is recorded.
- Limitation: No semantic fidelity judgment is recorded.

## Provider Destination Formats

### claude-hooks

Claude Hook Destination Format

```json
{
  "filePattern": "hooks/hooks.json",
  "handlerFields": [
    "type",
    "command",
    "prompt",
    "agent",
    "timeout",
    "async",
    "args"
  ],
  "rootFields": [
    "description",
    "hooks"
  ],
  "shape": "event-map",
  "supportedHandlerTypes": [
    "agent",
    "command",
    "http",
    "mcp_tool",
    "prompt"
  ]
}
```

- Source: <https://code.claude.com/docs/en/hooks>

### claude-plugin

Claude Plugin Destination Format

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": ".lsp.json",
      "kind": "lsp",
      "manifestField": "lspServers",
      "status": "native"
    },
    {
      "defaultPath": "monitors/monitors.json",
      "kind": "monitors",
      "manifestField": "experimental.monitors",
      "status": "native"
    },
    {
      "defaultPath": "output-styles/",
      "kind": "output-styles",
      "manifestField": "outputStyles",
      "status": "native"
    },
    {
      "defaultPath": "themes/",
      "kind": "themes",
      "manifestField": "experimental.themes",
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "settings.json",
      "kind": "settings",
      "manifestField": null,
      "status": "native"
    }
  ],
  "manifest": {
    "path": ".claude-plugin/plugin.json",
    "requiredFields": [
      "name",
      "description"
    ],
    "optionalFields": [
      "version",
      "author",
      "displayName",
      "homepage",
      "repository",
      "license"
    ],
    "unknownFields": "warn"
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".claude-plugin/"
  }
}
```

- Source: <https://code.claude.com/docs/en/plugins>
- Source: <https://code.claude.com/docs/en/plugins-reference#metadata-fields>
- Source: <https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.142.tgz>
- Source: <https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.143.tgz>

### claude-skill

Claude Skill Destination Format

```json
{
  "directoryPattern": ".claude/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "allowed-tools",
      "arguments",
      "context",
      "description",
      "disable-model-invocation",
      "name",
      "user-invocable"
    ],
    "recommendedFields": [
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "examples/",
    "references/",
    "scripts/"
  ]
}
```

- Source: <https://code.claude.com/docs/en/skills>

### claude-subagent

Claude Subagent Destination Format

```json
{
  "filePattern": ".claude/agents/*.md",
  "frontmatter": {
    "optionalFields": [
      "background",
      "color",
      "disallowedTools",
      "effort",
      "hooks",
      "initialPrompt",
      "isolation",
      "maxTurns",
      "mcpServers",
      "memory",
      "model",
      "permissionMode",
      "tools"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Source: <https://code.claude.com/docs/en/sub-agents>

### codex-agents-md

Codex Project Instructions Destination Format

```json
{
  "discoveryOrder": [
    "AGENTS.override.md",
    "AGENTS.md",
    "project_doc_fallback_filenames"
  ],
  "filePattern": "AGENTS.md",
  "mergeOrder": "root-to-current-working-directory",
  "projectDocMaxBytesDefault": 32768,
  "serialization": "markdown"
}
```

- Source: <https://developers.openai.com/codex/guides/agents-md>

### codex-plugin

Codex Plugin Destination Format

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": ".app.json",
      "kind": "apps",
      "manifestField": "apps",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": null,
      "status": "unsupported"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "interfaceFields": [
      "brandColor",
      "capabilities",
      "category",
      "composerIcon",
      "defaultPrompt",
      "developerName",
      "displayName",
      "logo",
      "longDescription",
      "privacyPolicyURL",
      "screenshots",
      "shortDescription",
      "termsOfServiceURL",
      "websiteURL"
    ],
    "authorFields": [
      "name",
      "email",
      "url"
    ],
    "path": ".codex-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "apps",
      "author",
      "description",
      "homepage",
      "hooks",
      "interface",
      "keywords",
      "license",
      "mcpServers",
      "repository",
      "skills",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "manifestPathsStartWith": "./",
    "metadataDirectory": ".codex-plugin/"
  }
}
```

- Source: <https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core-plugins/src/manifest.rs>
- Source: <https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core-plugins/src/loader.rs>
- Source: <https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core-plugins/src/loader_tests.rs>
- Source: <https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/skills/src/assets/samples/plugin-creator/scripts/validate_plugin.py>
- Source: <https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md>

### codex-skill

Codex Skill Destination Format

```json
{
  "directoryPattern": ".agents/skills/<skill-name>/",
  "frontmatter": {
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "agents/",
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Source: <https://developers.openai.com/codex/skills>

### codex-subagent

Codex Custom Agent Destination Format

```json
{
  "filePattern": ".codex/agents/*.toml",
  "requiredFields": [
    "name",
    "description",
    "developer_instructions"
  ],
  "optionalFields": [
    "mcp_servers",
    "model",
    "model_reasoning_effort",
    "nickname_candidates",
    "sandbox_mode",
    "skills.config"
  ],
  "serialization": "toml"
}
```

- Source: <https://developers.openai.com/codex/subagents>

### cursor-agent

Cursor Agent Destination Format

```json
{
  "filePattern": ".cursor/agents/*.md",
  "frontmatter": {
    "optionalFields": [
      "is_background",
      "model",
      "readonly",
      "skills"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Source: <https://cursor.com/docs/subagents>
- Source: <https://cursor.com/docs/reference/plugins>
- Source: <https://github.com/cursor/plugins>

### cursor-hooks

Cursor Hook Destination Format

```json
{
  "canonicalEventNames": "skillset-pascal-case",
  "nativeEventNames": "cursor-lower-camel",
  "filePattern": "hooks/hooks.json",
  "handlerFields": [
    "type",
    "command",
    "prompt",
    "timeout",
    "loop_limit",
    "failClosed",
    "matcher",
    "model"
  ],
  "rootFields": [
    "version",
    "hooks"
  ],
  "shape": "versioned-flat-event-map",
  "supportedHandlerTypes": [
    "command",
    "prompt"
  ]
}
```

- Source: <https://cursor.com/docs/hooks>
- Source: <https://cursor.com/docs/reference/third-party-hooks>
- Source: <https://github.com/cursor/plugins/blob/e87eaecc7bd3a06160035b5bc1a76d8cd695273a/ralph-loop/hooks/hooks.json>

### cursor-plugin

Cursor Plugin Destination Format

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "rules/",
      "kind": "rules",
      "manifestField": "rules",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "scripts/",
      "kind": "scripts",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "authorFields": [
      "name",
      "email"
    ],
    "path": ".cursor-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "agents",
      "author",
      "category",
      "commands",
      "description",
      "displayName",
      "hooks",
      "homepage",
      "keywords",
      "license",
      "logo",
      "mcpServers",
      "minClientVersions",
      "publisher",
      "repository",
      "rules",
      "skills",
      "tags",
      "variables",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".cursor-plugin/"
  }
}
```

- Source: <https://github.com/cursor/plugins/blob/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json>

### cursor-rules

Cursor Rules Destination Format

```json
{
  "filePattern": ".cursor/rules/*.mdc",
  "frontmatter": {
    "optionalFields": [
      "alwaysApply",
      "globs"
    ],
    "requiredFields": [
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Source: <https://cursor.com/docs/rules>

### cursor-skill

Cursor Skill Destination Format

```json
{
  "directoryPattern": ".cursor/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "disable-model-invocation"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Source: <https://cursor.com/docs/skills#frontmatter-fields>
- Source: <https://cursor.com/docs/plugins>
- Source: <https://github.com/cursor/plugins>
