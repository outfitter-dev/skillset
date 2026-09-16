# SET-550 Cursor parity fixture evidence

Date: 2026-09-16

This receipt pins the official Cursor documentation used by the
`fixtures/cursor-parity` baseline. The SHA-256 values are hashes of the fetched
HTML response bodies on the date above. Cursor's documentation URLs are rolling
rather than immutable; the hashes make the exact reviewed responses visible,
while `packages/registry/src` records the semantic snapshots used by the
compiler.

## Source pins

| Pin | URL | SHA-256 | Fetched |
| --- | --- | --- | --- |
| `rules` | <https://cursor.com/docs/rules> | `9ef699e09092dcee7901fff6b06f80212bf4876f505c63826504d9d9afec7acc` | 2026-09-16 |
| `skills` | <https://cursor.com/docs/skills> | `70b3cae045211e56c1974f96b92269db0e01ded43d4941258e9bccb0505e5825` | 2026-09-16 |
| `plugins` | <https://cursor.com/docs/reference/plugins> | `30e4da171ccc6a809227e667bf3c67c05ba44fe8c62ab427cba29f85068e87b5` | 2026-09-16 |
| `hooks` | <https://cursor.com/docs/hooks> | `fff5a34ab893f93289e7c246b1bdb15272d075fc3eddf34fa4881224d5918ccd` | 2026-09-16 |
| `third-party-hooks` | <https://cursor.com/docs/reference/third-party-hooks> | `02e8ee310c20406886440daac67a5927ad5734c103f469d5695d877c2c8c2c70` | 2026-09-16 |
| `subagents` | <https://cursor.com/docs/subagents> | `a1bab646408aebe5a3b5dc82430f0641204d6ca858fda8e811c35ada874b08cf` | 2026-09-16 |
| `cli-permissions` | <https://cursor.com/docs/cli/reference/permissions> | `675f5a0b750998e2c61e05898f06c12da465b699b4df3c6be7558e33a43f1fde` | 2026-09-16 |
| `permissions` | <https://cursor.com/docs/reference/permissions> | `74dc27ec885a3b113bd6a746e574445a494600d17b78143fa27bc6811bacc8d1` | 2026-09-16 |

## Claim disposition

| Claim | Fixture id | Evidence and result | Owner |
| --- | --- | --- | --- |
| `.mdc` carries `description`, `alwaysApply`, and `globs` | `cursor-rules-frontmatter` | Verified by `rules`; asserted by the fixture test. | SET-557 |
| `[` and `(` escaping inside a derived glob | `cursor-rules-globs-escaping` | **Not documented.** The rules page describes `*` and `**`, but not escaping literal brackets or parentheses. The fixture test is a todo. | SET-557, SET-574 |
| Nested `.cursor/rules/<dir>/` directories and their scoping | `cursor-rules-nested-dirs` | **Partially documented.** The `rules` page shows a nested folder, and the fixture separately records today's structural path mirroring. The page does not define independent scoping semantics for nested directories, so that provider claim remains a todo. | SET-557 |
| Cursor reads a project-root `AGENTS.md` | `cursor-agents-md-root` | The rolling `rules` page now states this, but SET-550 does not enable or change a renderer destination. The fixture keeps an owned todo so SET-551/SET-557 can resolve the behavior contract deliberately. | SET-551, SET-557 |
| `.cursor/skills/<skill>/SKILL.md` discovery | `cursor-skills-path` | Verified by `skills`; asserted by the fixture test. | SET-553, SET-554 |
| `.cursor/agents/<name>.md` discovery | `cursor-subagents-path` | Verified by `subagents`; asserted by the fixture test. | SET-551 |
| Package-root `assets/` is a general plugin presentation location | `cursor-plugin-assets` | **Partially documented.** `plugins` documents a relative logo such as `assets/logo.svg`; it does not define arbitrary `assets/` content as a plugin component. The logo passthrough baseline is asserted and the general claim remains a todo. | SET-558 |
| Plugin `rules/` is plugin content | `cursor-plugin-rules` | Verified by `plugins`, including default folder discovery. The fixture carries the package-root source shape, but current rendering leaves it unsupported, so the output assertion remains a todo for SET-568. | SET-568 |
| Hook events and handler shape | `cursor-hooks-events` | Verified by `hooks` and `third-party-hooks`; asserted structurally by the fixture test and pinned registry overlay. | SET-559 |
| Command allow and deny lists are one settings surface | `cursor-settings-allow-deny` | **Partially documented.** `cli-permissions` documents `permissions.allow` and `permissions.deny` in CLI config. `permissions` documents IDE terminal and MCP allowlists, without the same deny-list contract. The fixture test remains a todo. | SET-564 |

The `cursor-plugin-components` registry observation records the components the
plugin reference currently names: agents, commands, hooks, MCP servers, rules,
skills, and variables. It does not promote `assets/` into a general component.

## Fixture boundary

The fixture builds Cursor as its only target and captures current compiler
output. Its `cursor-kit` plugin carries package-root `assets/`, `rules/`, and
`hooks/hooks.json` inputs beside an explicit `_cursor/` island. Unsupported
package-root rule rendering remains a named todo rather than being hidden by
native-island passthrough. At the workspace level,
`.cursor/rules/app/[slug]/routing.mdc` and
`.cursor/rules/app/(marketing)/copy.mdc` preserve source directory punctuation.
That is a renderer baseline, not proof that Cursor's glob matcher treats those
characters literally.

No runtime discovery claim follows from this structural fixture. The existing
[Cursor runtime smoke receipt](2026-07-20-set-313-cursor-runtime-smoke.md)
remains separate provider-runtime evidence.
