# Authoring model fixture

This fixture exercises the current source locations introduced by SET-551: `RULES.md`, `subagents/`, and `shared/partials/` at workspace and plugin scope.

SET-585 activates plain and parenthesized skill groups, `_drafts/`, and exact reserved `[.]` and `[...]` rule segments while keeping other bracketed or parenthesized rule directories literal. SET-552 adds the root `plugins.internal_use` selection and default package-path plan. SET-554 flattens grouped skills to their leaf at generated destinations and owns project-copy rendering. SET-555 renders the paired `tdd` draft beside its selected shipped sibling while excluding draft bytes from plugin packages.

SET-557 derives each rule's scope from its directory under `rules/`: `engineering/` takes two contributions, `docs/writing.md` narrows with relative `paths:`, the literal `app/[slug]/` and `app/(marketing)/` rules mirror their paths, the wildcard `apps/[.]/src/` rule expands to both app source directories while `[...]/packages/core/` includes top-level and nested core directories, and `services/payments/AGENTS.override.md` is an unmanaged override that must produce a shadow warning. The placeholder files under `docs/`, `engineering/`, `app/`, `apps/` and `services/` make each scope directory exist.

SET-573 adds nested walkthrough Markdown in the shipped and draft `tdd` skills, sharing one copied reference with the primary body. The plugin editor subagent and the `shared-proof` hook lift the same workspace reference into the package-level `shared/` directory. The hook deliberately strips the retained `@` marker before passing the path to `cat`.
