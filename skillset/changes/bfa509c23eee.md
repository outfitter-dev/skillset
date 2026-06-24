---
bump: patch
evidence:
  - scope: config:root
    sourceHash: sha256:de21482cecafbeea2bb243a43c74d5532c9df62b1985473c68c977423254cbdb
id: bfa509c23eee
scope: config:root
---

Stop requiring self-hosted workspaces to pin workspace.cacheKey now that automatic XDG cache keys include host-qualified remotes and host/path local fallback hashes.
