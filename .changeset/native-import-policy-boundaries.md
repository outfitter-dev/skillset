---
"@skillset/cli": patch
---

Keep explicitly imported Claude skill tool and user-invocation fields inside Claude frontmatter for standalone and plugin skills. Reject conflicting top-level and provider-scoped policies rather than silently replacing authored values. Unknown-origin imports retain their existing warning and preservation behavior.
