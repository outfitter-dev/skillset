# Drift-audit finding dispositions

Linear owns issue workflow status. This table is the durable evidence map: each
numbered finding has exactly one current disposition and one owning Linear
issue. `fixed` is valid only with a merged PR or commit. `wont-fix` requires a
reason. Run `bun .agents/notes/2026-07-18-drift-audit/check-findings.ts` to
validate completeness and print the project finding counts.

| Finding | Confidence | Disposition | Owning Linear issue | Merged PR / commit | Notes |
| --- | --- | --- | --- | --- | --- |
| 00.1 | confirmed | wont-fix | SET-343 | — | MCP implementation is explicitly outside this project; retain the terminology evidence. |
| 00.2 | confirmed | wont-fix | SET-343 | — | Structured CLI output is the current automation contract; MCP implementation is out of scope. |
| 00.3 | decided-needed | wont-fix | SET-343 | — | Retain as a future constraint if an MCP surface is separately authorized. |
| 01.1 | confirmed | fixed | SET-314 | https://github.com/outfitter-dev/skillset/pull/299 | Hook-attachment provider lists preserve Cursor through the schema-backed target contract. Merged as `c3123238d22a2e5d7f54fd10172a58c7dab5aae0`. |
| 01.2 | confirmed | fixed | SET-315 | https://github.com/outfitter-dev/skillset/pull/301 | Cursor target-native islands load and align with registry evidence. Merged as `d7468f1145da59bc119f61124b96fe0c504e5a0a`. |
| 01.3 | confirmed | fixed | SET-316 | https://github.com/outfitter-dev/skillset/pull/300 | Cursor hook-event casing derives from registry-owned evidence. Merged as `a2d421026d6b0853d3a488dd47564476cd9e1700`. |
| 01.4 | confirmed | fixed | SET-318 | https://github.com/outfitter-dev/skillset/pull/305 | Target roots and project-agent extensions use exhaustive canonical descriptors without an implicit Cursor fallback. Merged as `0ea4c96b72da7bad975988aeafa652716f0ced91`. |
| 01.5 | confirmed | open | SET-313 | — | Final Cursor default-target and ADR decision; decision evidence required. |
| 01.6 | confirmed | open | SET-339 | — | Refresh significant Cursor documentation after SET-317 and SET-313. |
| 01.7 | confirmed | open | SET-339 | — | Refresh moderate Cursor documentation after SET-317 and SET-313. |
| 01.8 | confirmed | open | SET-339 | — | Refresh minor Cursor documentation after SET-317 and SET-313. |
| 01.9 | confirmed | fixed | SET-318 | https://github.com/outfitter-dev/skillset/pull/305 | Target-list diagnostics derive from the canonical target vocabulary and shared formatter. Merged as `0ea4c96b72da7bad975988aeafa652716f0ced91`. |
| 02.1 | confirmed | fixed | SET-320 | https://github.com/outfitter-dev/skillset/pull/308 | Typed effective provider overrides resolve once before attachment validation in PR 307 (`e8b5e5e2c2703d5c5d9d91cd1d03f1eaad08c8fc`) and render across supported destinations in PR 308 (`312299c83cf80574ac92b2f70c947fbf63100565`). |
| 02.2 | confirmed | fixed | SET-320 | https://github.com/outfitter-dev/skillset/pull/307 | The effective-definition contract validates and preserves supported `run.*` intent while rejecting unsupported surface combinations. Merged as `e8b5e5e2c2703d5c5d9d91cd1d03f1eaad08c8fc`. |
| 02.3 | confirmed | fixed | SET-321 | https://github.com/outfitter-dev/skillset/pull/193 | Audit evidence was stale: merged plugin (`537e3e7f9e06613fba557069ee0a311aa2fa131a`) and frontmatter (`dae73c666b5a14ab29216eb329ea57825f05122b`) renderers consume attachment status first, then definition status. SET-321 adds explicit fallback and precedence coverage. |
| 02.4 | confirmed | fixed | SET-321 | https://github.com/outfitter-dev/skillset/pull/309 | Shared schema validation rejects unsupported Codex instruction symlink mode before resolution. Merged as `673667656188b76e0070eb7299a0d560e9f0052c`. |
| 02.5 | confirmed | fixed | SET-319 | https://github.com/outfitter-dev/skillset/pull/306 | Schema-owned contracts distinguish single-file root, split workspace, source-manifest, and plugin configuration vocabularies. Merged as `7760699e9b10cb73e3a7b145dfcb73b5936ae46a`. |
| 02.6 | confirmed | fixed | SET-321 | https://github.com/outfitter-dev/skillset/pull/309 | The inert fixed-value test output container was removed from schema, runtime, docs, examples, and generated artifacts. Merged as `673667656188b76e0070eb7299a0d560e9f0052c`. |
| 02.7 | plausible | fixed | SET-322 | https://github.com/outfitter-dev/skillset/pull/310 | Output-wins reconciliation compares exact expected generated frontmatter and refuses divergence before source writes. Merged as `588e51d962fec11bff0dd21b81a830912b715389`. |
| 03.1 | confirmed | open | SET-324 | — | Accept a successor ADR for shipped unsupported-destination policy. |
| 03.2 | confirmed | open | SET-327 | — | Audit every draft first; SET-325 is the evidence-gated promotion follow-on. |
| 03.3 | confirmed | open | SET-327 | — | Record the supersession disposition before SET-325 acts. |
| 03.4 | confirmed | open | SET-350 | — | Model amendments separately from supersession in the decision map. |
| 03.5 | confirmed | open | SET-327 | — | Determine the required amendment before any promotion. |
| 03.6 | confirmed | open | SET-326 | — | Finish the internal `try` to `test` hard cutover. |
| 03.7 | plausible | open | SET-327 | — | Audit every remaining draft and record one evidence-backed disposition. |
| 03.8 | confirmed | open | SET-339 | — | Refresh Cursor documentation after registry-backed table checks. |
| 03.9 | decided-needed | open | SET-317 | — | Mechanically check target-support tables against registry evidence. |
| 03.10 | plausible | open | SET-339 | — | Verify and correct the lagging feature-doc status row. |
| 04.1 | confirmed | fixed | SET-319 | https://github.com/outfitter-dev/skillset/pull/306 | Core derives context-specific configuration key sets and unsupported-destination policy from schema ownership. Merged as `7760699e9b10cb73e3a7b145dfcb73b5936ae46a`. |
| 04.2 | confirmed | fixed | SET-323 | https://github.com/outfitter-dev/skillset/pull/312 | Schema owns the canonical SemVer contract and fresh RegExp factory, with exact-string parity across consumers. Merged as `ec7c5afcaee4f827969cff9ffdd4f7ab8408de85`. |
| 04.3 | confirmed | fixed | SET-346 | https://github.com/outfitter-dev/skillset/pull/314 | Direct retired CLI guard patterns derive from the authoritative command and flag arrays while bespoke semantic patterns remain explicit. Merged as `e468628c8ce62b115d3cb764313d7799f8d0ecfa`. |
| 04.4 | confirmed | fixed | SET-318 | https://github.com/outfitter-dev/skillset/pull/305 | Canonical target descriptors own project roots, project-agent extensions, display labels, and generated session expressions. Merged as `0ea4c96b72da7bad975988aeafa652716f0ced91`. |
| 04.5 | confirmed | fixed | SET-323 | https://github.com/outfitter-dev/skillset/pull/312 | Schema owns the shared lowest-owner list formatter used across Schema, Core, and CLI. Merged as `ec7c5afcaee4f827969cff9ffdd4f7ab8408de85`. |
| 04.6 | confirmed | fixed | SET-346 | https://github.com/outfitter-dev/skillset/pull/314 | The exported runtime distribution map and named exclusions form an exact partition of registered runtime IDs. Merged as `e468628c8ce62b115d3cb764313d7799f8d0ecfa`. |
| 04.7 | plausible | wont-fix | SET-343 | — | Baseline counts are intentionally prose observations, not product contracts. |
| 04.8 | decided-needed | open | SET-340 | — | Guard against target subsets and implicit fallbacks. |
| 05.1 | confirmed | open | SET-332 | — | Prove the finite-command adapter; SET-347 owns downstream migration. |
| 05.2 | confirmed | open | SET-333 | — | Extract the Core evaluation engine; SET-348 owns the app adapter split. |
| 05.3 | confirmed | open | SET-334 | — | Extract a reusable Core source-readiness operation. |
| 05.4 | confirmed | open | SET-335 | — | Relocate provider-maintenance codegen to its owning package. |
| 05.5 | confirmed | open | SET-341 | — | Share scaffold-report primitives across authoring flows. |
| 05.6 | confirmed | open | SET-337 | — | Required scope is the named `render.ts` seams; other large files are candidates only. |
| 05.7 | confirmed | open | SET-336 | — | Split inspection parsers and share lexical readers. |
| 05.8 | decided-needed | open | SET-342 | — | Re-baseline internal imports only after ownership moves. |
| 06.1 | confirmed | open | SET-328 | — | Print structured terminal recovery guidance. |
| 06.2 | confirmed | open | SET-329 | — | Add preview-first, idempotent change evidence refresh. |
| 06.3 | confirmed | open | SET-330 | — | Add preview-first ignore semantics while retaining coverage evidence. |
| 06.4 | confirmed | open | SET-331 | — | List backups with integrity-aware restore evidence. |
| 06.5 | plausible | open | SET-338 | — | May be deferred only with demand evidence allowed by the issue contract. |
| 06.6 | plausible | open | SET-328 | — | Identify which failures are fixable and print the correct recovery operation. |
