---
metadata:
  generated: skillset@0.1.0
  kind: changelog
  target: skill:skillset-codex-development
---

# Changelog

## ea40079767ef

bump: patch | group: set-53 | scopes: plugin: skillset, skill(plugin:skillset): use-skillset, skill: skillset-codex-development

Remove pre-public compatibility aliases from the Skillset source contract and refresh the self-hosted guidance so agents use canonical selectors, instructions, hooks, resources, import, and tool_intent shapes.

The mutable release-state baseline is reset to source-unit hash schema v2 for canonical selector hashing; applied JSONL history and release records remain historical v1 evidence rather than being rewritten.

## 91d220dee994

bump: patch | scopes: skill: skillset-codex-development

Workspace split: compiler module and test paths moved under apps/skillset/src.
