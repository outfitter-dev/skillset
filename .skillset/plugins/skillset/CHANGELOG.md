---
metadata:
  generated: skillset@0.1.0
  kind: changelog
  target: plugin:skillset
---

# Changelog

## f6616cb51e25

bump: none | group: SET-43 | scopes: plugin: skillset, skill(plugin:skillset): use-skillset

Documented the repo-local init adoption boundary, clarified that import should reuse version-baseline seeding, and split the richer create-project generator into SET-54 so release commands stay focused on applying recorded changes.

## ea40079767ef

bump: patch | group: set-53 | scopes: plugin: skillset, skill(plugin:skillset): use-skillset, skill: skillset-codex-development

Remove pre-public compatibility aliases from the Skillset source contract and refresh the self-hosted guidance so agents use canonical selectors, instructions, hooks, resources, import, and tool_intent shapes.

The mutable release-state baseline is reset to source-unit hash schema v2 for canonical selector hashing; applied JSONL history and release records remain historical v1 evidence rather than being rewritten.

## d5e6194362ec

bump: patch | scopes: plugin: skillset, skill(plugin:skillset): use-skillset

Replace the init/create --with-* scaffold flags with a single --include list (agents, ci), drop the project-doc and islands scaffolds, and document the CI workflow scaffold in the use-skillset guidance.
