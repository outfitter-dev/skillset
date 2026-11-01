# Design a Useful Agent Capability

Start with the outcome: what should the agent do, when should it do it, and what evidence will show that it worked? Choose the smallest artifact that changes that behavior. A new file is useful only when it gives the agent knowledge, a repeatable operation, or a boundary it does not already have.

## Choose the Right Artifact

| Need | Start with | Boundary |
| --- | --- | --- |
| One answer, a disposable task, or a setting the provider already exposes | No new artifact; direct work or native configuration | Do not introduce a workspace merely because a provider directory exists. |
| A reusable procedure selected for a particular request | Skill | Explain its purpose and selection cues; keep unrelated requests outside its scope. |
| Durable guidance that applies whenever working in a directory | Rule | Scope the rule to its intended files; prose is guidance, not a command-execution sandbox. |
| A distinct delegated role with its own context or tool needs | Agent | Confirm the provider supports the required delegation and policy. A different tone alone rarely needs an agent. |
| A deterministic check at a documented lifecycle event | Hook | Confirm event, input, output, failure behavior and delivery for each provider. A rendered hook is not proof it is enabled. |
| Repeated deterministic computation or file processing | Script | Give it an explicit input/output contract; document side effects and required runtimes. A script can support a skill without becoming another skill. |
| An existing supported behavior controlled by a value | Configuration | Prefer the existing setting to code that recreates it. Keep repository configuration distinct from personal or organization policy. |
| Several capabilities distributed and versioned together | Plugin | Packaging groups capabilities; it does not itself grant trust, tool access, or runtime activation. |
| Structured access to an external service or shared tool API | Existing integration or MCP server | Use an available integration first. Adding a server brings authentication, operation and distribution responsibilities. |

These choices can compose. A skill may call a small script, and a plugin may ship several skills. Add each part because the requested behavior needs it. Do not create the full family in anticipation of future uses.

## Write a Description That Selects the Skill

Describe **what it does and when to use it**. Name concrete task cues, relevant artifacts, or intended outcomes. Add a negative boundary when a nearby request would otherwise select the wrong workflow. Keep the description within the Agent Skills limit of 1,024 characters; shorter is better when it stays precise.

For example:

> Review database schema changes for migration ordering and compatibility. Use when editing migrations or reviewing a PR that changes tables, indexes, or constraints. Not for querying production data or changing database credentials.

The description routes; the body explains the procedure. Do not put the whole workflow or an exhaustive keyword list in the description. Names and file extensions are clues to inspect intent, not evidence that migration or execution is authorized.

Try a small selection set before expanding the skill:

- Positive: “Review these migrations for deployment-order problems.”
- Negative: “Run a production query and export customer records.”
- Ambiguous: “This PR changes a database setting; does it need a migration review?”

Record whether the skill was selected and whether it made the right scope decision. For the ambiguous case, inspecting the change before choosing a workflow may be correct. A completed model run is not automatically a passed evaluation, and one provider's result does not establish another's behavior.

## Keep the Entry Point Small

Keep purpose, selection boundaries, essential decisions and the next useful action in `SKILL.md`. Put substantial conditional material in named `references/` files and explain when to read each one. Put executable procedures in `scripts/` when deterministic execution is more reliable than repeating prose.

A useful reference split follows user intent: adoption, authoring, repair, or provider-specific setup. Avoid making the agent read every reference before it can begin. Prefer shallow links and one owner for shared guidance. If several specialists need the same preflight or recovery steps, share that resource instead of copying it.

Do not promise a specialist that is not shipped. Name the available reference or manual path, and describe the missing capability plainly. The public `skillset` router demonstrates this boundary: it recognizes the request, runs a read-only preflight where available, and loads the relevant bundled guidance.

## Design for the Actual Provider Output

Separate portable intent from provider-specific behavior. Inspect the build's render results and generated files before claiming that a feature survived projection.

- **Rules:** directory scope determines Codex `AGENTS.md` placement. Several source rules can be concatenated, so each should remain understandable beside other sections. Avoid assuming a source filename remains an independent runtime entry point. File-pattern narrowing can be reported as degraded when the destination cannot enforce it; an `applies_to` label is not enforcement. Native authored root `AGENTS.md` remains source and is not a generated file to replace.
- **Tools:** Claude `allowed-tools` represents preapproval/no-prompt behavior, not a portable sandbox. Skillset's `allowed_tools` has no confirmed Codex or Cursor skill-local equivalent. Portable `tools` describes open-world policy with provider-specific realizations; omission does not mean denial. Do not turn a field's presence into an unsupported security guarantee.
- **Hooks and scripts:** matching event names do not establish matching input, path resolution, output or failure semantics. Preserve a provider-native boundary where behavior cannot be adapted faithfully. Verify deployment separately from rendering.
- **Resources:** keep referenced files within the distributed package and verify their generated destinations. A path that exists in the authoring repository may not exist after installation. Avoid dependence on contributor-only instructions or repository internals.

When support is absent or ambiguous, narrow the provider scope, retain the native artifact, or report the gap. Do not invent equivalence, silently drop meaning, or relax policy just to produce a successful build.

## Verify the Smallest Useful Slice

Start with one real task and one counterexample. Preview the output, inspect diagnostics and confirm that the agent can find the needed resource. After an authorized write, check that source and generated output agree. Keep unmanaged originals until the replacement is reviewed.

Use deterministic tests for file contents, diagnostics, resource placement and failure behavior. Use provider execution for runtime claims, and assessed model trials for selection and workflow quality. Report which evidence exists and which is still missing. Build success, runtime availability and a good agent decision are separate outcomes.

Add complexity only when this slice exposes a concrete need. Often the best improvement is a clearer description, a narrower rule, an existing setting, or removing an unnecessary artifact.
