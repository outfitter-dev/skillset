---
"skillset": minor
---

Render canonical author metadata into Claude's supported object shape, report omitted author fields explicitly, and remove unsupported marketplace provenance.

Native plugin authors that cannot form canonical source now **block import** rather than disappearing. Previously a malformed native `author` — a scalar such as `42`, or an object that cannot satisfy the canonical author contract (`{}`, email-only, a non-string or empty `name`) — was treated as absent: another provider's valid author became canonical, and the source-owned `author` was stripped, so the original value was silently lost. Import now rejects with the offending providers named, and `skillset adopt` surfaces a matching `unreadable-plugin-author` error diagnostic so the pre-flight reports what import will refuse.

Validation is per provider: an author that cannot be lifted is rejected even when a sibling provider declares a valid one, so no provider's author silently stands in for another's.

Marketplace author evidence is also now scoped to the plugins actually projected into the effective marketplace, so a root `claude.marketplace.plugins` override no longer produces blocking evidence for plugins absent from the final output.
