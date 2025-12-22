# Skillset Roadmap

Features deferred from the initial release, prioritized for future development.

## Priority Order

| Feature | Priority | Complexity | Notes |
| ------- | -------- | ---------- | ----- |
| [Stats v2](./stats.md) | High | Medium | Builds on v1 logging from Phase 8 |
| [Search](./search.md) | High | Medium | Essential for large skill collections |
| [Suggest](./suggest.md) | Medium | High | Context-aware recommendations |
| [Browse](./browse.md) | Low | High | Nice-to-have TUI, not critical path |

## Dependency on Phase 8

All roadmap features depend on the Phase 8 CLI redesign being complete:

- Stats v2 requires the `usage.jsonl` logging from Phase 8
- Search builds on the indexed skill cache
- Suggest uses the same caching and matching infrastructure
- Browse requires the verb-first command structure

## Implementation Order

Recommended implementation sequence:

```text
Phase 8 (CLI Redesign)
         │
         ├──▶ Stats v2 (quick win, builds on v1)
         │
         ├──▶ Search (high value, moderate effort)
         │
         └──▶ Suggest ──▶ Browse
                │
                └── (Share context analysis code)
```

## Not Prioritized

Features considered but not currently planned:

- **Cloud sync**: Sync skills across machines (security/privacy concerns)
- **Skill marketplace**: Public skill sharing (scope creep)
- **AI generation**: Generate skills from prompts (future, when proven value)
- **GUI app**: Desktop application (CLI-first philosophy)

## Contributing

When adding new roadmap features:

1. Create a new markdown file in this directory
2. Include: Status, Feature Overview, Implementation, Checklist
3. Add to the priority table above
4. Link dependencies to existing phases or roadmap items
