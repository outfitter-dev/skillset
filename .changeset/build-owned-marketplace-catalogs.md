---
"@skillset/core": patch
---

Make ordinary builds the single owner of provider marketplace catalogs. Builds now record the Claude and Cursor catalogs in `skillset.lock`, so `skillset explain` traces them and declaring a catalog after an implicit one rebuilds in place instead of failing with `unmanaged-output-collision`. `marketplace update` now renders its resolved entries through the build, so the catalog and lock it writes match what the next build produces.
