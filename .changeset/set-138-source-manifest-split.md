---
"skillset": patch
---

Split workspace build configuration from root source metadata. Root `.skillset/config.yaml` now accepts workspace/build keys only, root source identity and support metadata live in `.skillset/src/skillset.yaml`, setup commands scaffold both files, source hashes include both roots, and a limited local migration script can move early Skillset repos to the unified `.skillset/src/` layout.
