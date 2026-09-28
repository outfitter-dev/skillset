---
"skillset": minor
---

Classify invocation errors found by argument validators and at execution time as usage errors. They now exit 2 in human, `--json`, and `--jsonl` modes:

- argument validators called by the parsers: ad hoc `test` flag combinations and `--preset` values;
- missing required arguments: the `reconcile` and `import` path, the `new` kind, the `create` name, `new` names, `new hook --attach`, `--event`, and `--command` or `--script`, and `hooks print --runner`;
- conflicting or unsupported flags on `new`, `new hook`, and `hooks print`;
- malformed argument values: change refs that are not hex or are too short, release refs that are too short, non-slug `new --id` and `--in` values, and unknown `new hook --event` names.

In human mode these move from 1 to 2. In JSON mode they exit 2 rather than the 1 that dropping message-prefix inference would otherwise give. Well-formed values that do not resolve, such as unmatched or ambiguous refs and missing containers, and other data failures still exit 1.
