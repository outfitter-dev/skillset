---
"skillset": minor
---

Rename the rule source-unit kind and selector from `instruction` / `instruction:<id>` to `rule` / `rule:<id>` (ADR-0037). `skillset change status`, `change check`, `explain`, and generated locks report `rule:<id>`. Rule source hashes are unchanged, so existing baselines stay valid and no rule appears edited. Change history recorded with `instruction:<id>` is translated when read. A pending change entry or `skillset change add --scope` that still names `instruction:<id>` fails with an error naming the `rule:<id>` rewrite.
