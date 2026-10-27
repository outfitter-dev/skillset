---
"@skillset/cli": minor
---

Generated `skillset.lock` files move to schema v5. The single whole-file `provenanceHash` is replaced by a top-level `headerHash` and one `provenanceHash` per item, so branches that change different skills, rules, or plugins edit different lock lines and merge as plain text (ADR-0045). A v4 lock whose document hash verifies is rewritten to v5 by the next `skillset build --yes`; nothing else is needed.
