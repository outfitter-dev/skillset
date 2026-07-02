---
slug: path-references-resolve-and-rename-together
title: Source References Resolve And Rename Together
status: draft
created: 2026-07-01
updated: 2026-07-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [named-partials, skillset-workspace-layout, first-class-sets, agent-source-model]
---

# ADR: Source References Resolve And Rename Together

## Context

Skills point at their own companion files constantly: `SKILL.md` links to
`references/foo.md`, a script mentions `references/foo.md` in a comment, a
`resources.references` frontmatter entry names it, another `references/*.md`
file cross-links it. Rename `references/foo.md` to `references/bar.md` and
every one of those mentions goes stale at once, with nothing to catch it.

Nothing in the compiler validates any of this today. `preprocessText`
(`packages/core/src/preprocess.ts:30-44`) only expands `{{...}}` tokens; it
has no logic that touches markdown link syntax (`[text](path)`) or bare prose
paths. `resources.references` frontmatter is merged straight into generated
output without a filesystem check (`packages/core/src/render.ts:1169-1171`).
The only reference form that gets validated and rewritten at all is a
markdown link using the `shared:`/`plugin:` scheme
(`packages/core/src/resources.ts:239-293`), and that machinery exists purely
because that content lives outside the skill's own directory and must be
copied in — it does not fire for a plain relative link, a backtick-wrapped
mention, or a frontmatter path field.

Named Partials (draft) already solved half of this shape of problem for
*embedded* content: `{{> name}}` decouples prose from a physical path so a
reusable fragment can be renamed without touching every place it's included.
But `references/foo.md` in the SKILL.md progressive-disclosure sense is never
embedded — it's a pointer the agent reads on demand. There is no equivalent
indirection for a reference that stays a reference.

The result: a rename is a manual, unverified grep across an unknown number of
files, in four different textual shapes, with no build-time signal if you
miss one. This is exactly the kind of drift the compiler's tenets say should
surface early instead of failing silently at read time.

Skills are not the only surface with this problem. Rules already support the
same `shared:`/`plugin:`/named-partial preprocessing as skills
([Instructions](../../features/instructions.md)), so a rule body can mention
a stale path exactly the same way a skill body can. Project agents
(`.skillset/agents/*.md`) run their bodies through the identical
`preprocessText` pipeline
(`renderProjectAgentBody`, `packages/core/src/render.ts:712`), so they inherit
the same prose-staleness risk for free — but agents add a second, structurally
different reference kind: an agent's `skills:` frontmatter list names a skill
by its derived id, not by path. `readStringArray(parts.frontmatter, "skills")`
(`packages/core/src/resolver.ts:480`) only checks that the field is a string
array; it never checks that any entry names a skill that actually exists.
Renaming a skill's own directory silently breaks every agent that lists its
old id, the same way renaming a file silently breaks every `{{@old-path}}`
would if nothing validated it.

## Decision

Skillset adds a resolve-only reference token, `{{@<specifier>}}`, that
validates a file exists and expands to its correct path at build time; a new
diagnostic that validates every agent `skills:` entry against a real skill
id; and a `skillset rename <from> <to>` command that uses both — plus
schema-known frontmatter path fields — to make renames safe by construction
across skills, rules, and agents, warning rather than guessing wherever it
cannot rewrite safely.

### `{{@specifier}}` resolves, it never embeds

A bare `{{path.md}}` token is already a path partial: it **embeds** the
file's content inline (`isPartialSpecifier`,
`packages/core/src/preprocess.ts:401-417`). `{{@path.md}}` is the resolve-only
sibling of that same grammar — the `@` is what tells the preprocessor "point
at this, don't inline it":

```md
{{references/foo.md}}     -> embeds the file's content inline (existing)
{{@references/foo.md}}    -> resolves and validates the path, emits it as text (new)
```

Specifier forms mirror the existing partial scheme vocabulary exactly, so the
same resolution and escape guardrails apply without inventing a second
path-resolution system:

```md
{{@references/foo.md}}   skill-relative path, resolved like today's path partials
{{@shared:foo.md}}       workspace .skillset/shared/
{{@plugin:foo.md}}       current plugin's shared/ (requires a plugin-bound source)
{{@root:foo.md}}         alias for shared:, matching existing partial resolution
```

The bare form is deliberately `{{@...}}`, never unwrapped `@path/to/file.md`.
Skillset's own authored prose — this repo included — mentions scoped package
names like `@outfitter/*` and `@acme/docs-cli` constantly (see
[skill-frontmatter.yaml](../reference/examples/skill-frontmatter.yaml)). An
unwrapped `@` marker would collide with that on sight. `{{...}}` is already
reserved for preprocessing, so wrapping the marker removes the ambiguity for
free.

Resolution failures throw at build time, reusing the same error paths
`resolvePartial`/`resolveNamedPartial` already have: missing file, `..`
escape, absolute path, or a `plugin:` specifier outside a plugin-bound source
all fail loudly instead of silently passing through. The resolved file is
added to `preprocessDependencies` (the same provenance mechanism partials and
resources already use), so `skillset explain`/`verify`/lock provenance treat
it as a real dependency of the document that referenced it.

### Output text depends on the specifier kind, not on formatting choices

- A bare skill-relative specifier emits the literal path text unchanged.
  Same-directory-tree files always copy byte-for-byte to every target
  (`collectFiles`, `packages/core/src/render.ts:2732-2746`, reused by both
  plugin- and standalone-skill rendering), so there is never a target-specific
  path to compute here.
- A `shared:`/`plugin:`/`root:` specifier emits the same target-specific
  copied-in path `resources.ts` already computes for a declared resource link.
  This still requires the file to be declared in the skill's `resources`
  frontmatter, exactly as a `shared:`/`plugin:` markdown link does today; an
  undeclared reference fails with the same "add a resources entry" guidance
  `findUndeclaredResourceLinks` already gives.
- The token never adds formatting. It emits path text only — no automatic
  backticks, no automatic markdown link. Authors choose the wrapper:

  ```md
  See `{{@references/foo.md}}` for details.
  [See the API guide]({{@references/api.md}})
  ```

  This keeps the token doing one job (resolve and validate a path) and reuses
  Markdown's own label mechanism for aliasing instead of inventing a
  pipe-delimited alias syntax.

### `{{@specifier}}` applies uniformly to skills, rules, and agents

Skills, rules, and project agents already run their bodies through the same
`preprocessText` function. `{{@specifier}}` needs no per-surface plumbing —
it works in a rule body or an agent's prose exactly as it does in a skill,
with resolution scoped to that same file's own location the way path
partials already are. A rule referencing a workspace-shared file, or an
agent describing where its own supporting doc lives, gets the identical
build-time validation skills get.

### Skill-identity references are validated, not tokenized

An agent's `skills:` list is not a path, so it does not get a `{{@...}}`
token — it gets a direct existence check against the resolved source graph,
the same way `resources.references` frontmatter gets checked directly rather
than requiring authors to wrap it in a token.

Resolution mirrors the algorithm named partials already use for a bare
`{{> name}}` (`resolveNamedPartial`, `packages/core/src/preprocess.ts:469-518`)
instead of inventing a second precedence rule: a bare entry resolves against
standalone skills first, then falls back to the referencing agent's own
plugin's skills if the agent is plugin-bound and no standalone match exists.
This makes a plugin agent's own sibling skill referenceable by its short
name, the same way a plugin's own partials are.

The fully-qualified selector form is always valid too, in every context —
cross-plugin, within-plugin, or from a standalone project agent — reusing the
selector grammar the First-Class Sets draft already establishes
(`plugin.<plugin>.skill:<name>`, `selectorForPluginSkill`,
`packages/core/src/source-unit-selector.ts:82-83`) rather than inventing a
second selector shape for one frontmatter field. An author who wants zero
ambiguity, even inside that skill's own plugin, can always write the
qualified form instead of relying on the fallback:

```yaml
skills:
  - skillset-codex-development          # standalone skill
  - plugin.skillset.skill:use-skillset  # plugin-bound skill
```

An unresolvable entry — standalone or plugin-qualified — fails the build,
closing the same silent-staleness gap the path token closes, for identity
references instead of path references.

What Skillset renders into the generated `.claude/agents/*.md` `skills:`
field for a plugin-qualified entry is a target-lowering question, not a
source-authoring question, and this ADR does not resolve it: Claude's actual
runtime convention for cross-plugin skill references needs verification
before implementation (see Non-Decisions). Codex's `skills` handling is
already a shimmed compatibility preface, not a native mechanism
([Agents](../../features/agents.md)), so a plugin-qualified entry may simply
render into that preface's text rather than needing its own Codex-native
form.

### `skillset rename` makes the rewrite safe, not just detectable

`skillset rename <from> <to>` previews its plan by default and writes only
with `--yes`, matching every other mutating command (`build`, `init`,
`create`). Scope is derived from what is being renamed, because a skill-local
file can only ever be legally referenced from within that same skill's tree
(the escape rule already forbids anything else):

| Renaming... | Search scope | Rewrites |
| --- | --- | --- |
| A skill-local file (`references/foo.md`) | That skill's own directory tree | `{{@<relative-path>}}` |
| A workspace shared file (`.skillset/shared/foo.md`) | Whole workspace | `{{@shared:<old>}}` |
| A plugin shared file (`plugins/<p>/shared/foo.md`) | That plugin's own skills/rules | `{{@plugin:<old>}}` |
| A named partial file | Same scoping rule as above, by partial root | `{{> old-name}}` -> `{{> new-name}}` |
| A skill's own directory (its id) | Every project agent workspace-wide, plus the skill's own plugin's agents when plugin-bound | Every `skills:` entry naming `<old-id>` or `plugin.<p>.skill:<old-id>` |
| A rule file | Whole workspace, for symmetry with skills/agents; no known identity reference exists today | `{{@...}}`/`{{> name}}` occurrences pointing at it, if any |
| An agent file | Whole workspace; no known identity reference exists today | `{{@...}}`/`{{> name}}` occurrences pointing at it, if any |

Named partials get the same treatment because they have the identical
staleness problem: renaming `partials/foo.md` breaks every `{{> foo}}`
reference the same way a path rename breaks `{{@foo.md}}`, and the rename
command already has to do "find every reference to this identifier in scope"
either way.

Renaming a skill's own directory is a different operation from renaming a
file inside one: it changes the skill's machine identity, not just a path
segment, so its blast radius is every agent's `skills:` list rather than the
skill's own tree. `skillset rename` detects this case by checking whether
`<from>` is a skill root (contains `SKILL.md`) rather than an arbitrary file,
and switches from token-rewriting to identity-rewriting accordingly. Rule and
agent files rename like any other file for now: no source surface today
references a rule or an agent by id the way agents reference skills, so
`skillset rename` treats them as plain files with a workspace-wide `{{@...}}`
search, kept for symmetry and to future-proof against a surface later adding
such a reference.

Because a plugin-bound skill is reachable through two forms — a bare name
falling back to its own plugin, or the fully-qualified selector reachable
from anywhere — renaming one means searching for both: bare `<old-id>` in
that skill's own plugin's agents, and `plugin.<p>.skill:<old-id>` in every
agent, workspace-wide.

`skillset rename` also rewrites schema-known frontmatter path fields (for
example `resources.references` entries) directly, because the compiler
already knows structurally that those fields hold paths — no `{{@...}}`
marker is needed to disambiguate frontmatter the way it is for free-form
prose.

What it does **not** do: rewrite a plain markdown link or backtick-wrapped
mention that isn't `{{@...}}`. That text is ambiguous to the compiler — it
could be a live reference or a documentation example showing syntax — so
guessing and silently rewriting it would trade one kind of silent breakage
for another. Instead, the command's preview warns: `N unmarked mentions of
<old-path> found in <file>, not rewritten — consider {{@...}}`, giving
visibility without false confidence.

## Non-Goals

- Auto-formatting bare `{{@path}}` output (for example, auto-wrapping in
  backticks). Worth a future `compile.features` option; not built now.
- Rewriting unmarked plain links or backtick mentions automatically. Flagged,
  never guessed.
- A path-based way to *embed* content — that already exists as today's path
  partials.
- Cross-plugin reference resolution for path tokens. Named Partials already
  rejected this for `{{> <plugin>.<name>}}`; this ADR inherits the same
  boundary for `{{@plugin:...}}`. Plugin-qualified *skill-identity* references
  are explicitly allowed (see Decision) because that is a different reference
  kind with its own selector grammar, not a path escaping its plugin.
- Bulk-moving multiple arbitrary files or directories in one invocation.
  `skillset rename` takes exactly one `<from>` and one `<to>`; a skill's own
  root directory is a special-cased single identity rename, not a general
  directory-move feature.
- Deciding Claude's/Codex's exact generated-output form for a
  plugin-qualified `skills:` entry. That is a target-lowering detail to
  verify during implementation, not a source-contract decision (see
  Non-Decisions).

## Consequences

### Positive

- A rename is one command instead of an unbounded manual grep across however
  many files, agents, and rules mention the old path or id.
- A stale reference fails the build instead of shipping a dead link, and a
  stale `skills:` entry fails the build instead of silently pointing at
  nothing — drift becomes visible at build time, not at read time, for both
  reference kinds.
- Reuses the exact resolution, escape, and provenance machinery partials and
  resources already have, and the exact selector grammar First-Class Sets
  already establishes for plugin-qualified skills; no second path-resolution
  or selector system.
- One rename command covers every portable authoring surface (skills, rules,
  agents) instead of a skill-only tool that leaves rules and agents as a
  known gap.

### Tradeoffs

- One more syntax form for authors to learn, alongside `{{> name}}` and plain
  path partials.
- Skills that keep using unmarked plain links get no retroactive protection
  until an author adopts `{{@...}}` (or runs `skillset rename` and sees the
  warning).
- Frontmatter rewriting in `skillset rename` depends on the schema knowing
  which fields are paths or identities; a new path-shaped or identity-shaped
  frontmatter field has to be taught to the rename command explicitly, or it
  silently falls back to the unmarked-mention warning path.
- Renaming a skill's own directory now has workspace-wide blast radius
  (every project agent, not just that skill's own tree), which is a bigger
  search than any other rename case this ADR covers.

### Risks

- Authors may keep writing plain links out of habit, leaving the safety net
  partial. A future lint nudge recommending `{{@...}}` for skill
  support-directory links would close this, but is not part of this decision.
- Same-basename files across different scoped roots (a skill-local
  `references/foo.md` versus a `shared:` `foo.md`) could confuse an author
  about which `{{@...}}` form resolves where. This mirrors the ambiguity
  named partials already accept via basename fallback and an explicit
  collision error; the same discipline applies here.
- Claude's actual runtime convention for a cross-plugin skill reference in
  generated `skills:` frontmatter has not been verified against current
  Claude Code documentation. If it differs from the assumed lowering target,
  the identity-validation and rename-rewrite logic for plugin-qualified
  skills needs a follow-up correction before implementation ships.
- The bare-name fallback inherits named partials' shadowing behavior: a
  standalone skill match is always returned before the current plugin's own
  skill is even considered, so a plugin skill with the same bare name as a
  standalone skill is silently shadowed rather than flagged as a collision.
  This is the precedent already accepted for partials, but it means the
  "safety" this ADR adds comes from authors *using* the qualified form when
  they want certainty, not from the bare form detecting the ambiguity itself.

## Non-Decisions

- Whether existing plain links get a one-time bulk codemod to `{{@...}}`
  form.
- Whether frontmatter values should eventually accept `{{@...}}` directly,
  instead of relying on schema-level path knowledge in `skillset rename`.
- Directory renames or multi-file batch moves beyond the single skill-root
  identity-rename case.
- An auto-backtick-wrap configuration surface.
- The exact target-native lowering of a plugin-qualified `skills:` entry for
  Claude and Codex output. Verify Claude's current documented convention
  before implementation; this ADR only decides the source-authoring grammar
  (reuse the existing selector, do not invent a second one).

## References

- ADR: Named Partials (draft) - `{{@...}}` is the resolve-only sibling of the
  embed-only `{{> name}}` grammar that ADR establishes; both reuse the same
  scheme vocabulary and reject cross-plugin references the same way.
- ADR: Skillset Workspace Layout (draft) - defines the `.skillset/`
  workspace/plugin boundary this ADR's scoping rules for `skillset rename`
  follow.
- ADR: First-Class Sets (draft) - owns the `plugin.<plugin>.skill:<name>`
  selector grammar this ADR reuses for plugin-qualified `skills:` entries,
  rather than defining a second selector shape.
- ADR: Agent / Subagent Source Model (draft) - establishes the project agent
  `skills:` frontmatter field this ADR adds identity validation and
  rename-cascade support for.
- [Skills](../../features/skills.md) - current skill body preprocessing
  contract this ADR extends.
- [Instructions](../../features/instructions.md) - current rule body
  preprocessing contract this ADR extends.
- [Agents](../../features/agents.md) - current project agent `skills:`
  frontmatter and body preprocessing contract this ADR extends.
- [Tenets](../../tenets.md) - "Drift should become visible early" is the
  governing principle behind failing the build instead of shipping a stale
  reference.
