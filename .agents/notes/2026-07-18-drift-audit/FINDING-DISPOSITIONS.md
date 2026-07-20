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
| 01.1 | confirmed | open | SET-314 | — | Preserve Cursor in hook-attachment provider lists. |
| 01.2 | confirmed | open | SET-315 | — | Load Cursor island sources and align registry evidence. |
| 01.3 | confirmed | open | SET-316 | — | Derive Cursor event casing from registry evidence. |
| 01.4 | confirmed | open | SET-318 | — | Consolidate target root mappings without implicit Cursor fallback. |
| 01.5 | confirmed | open | SET-313 | — | Final Cursor default-target and ADR decision; decision evidence required. |
| 01.6 | confirmed | open | SET-339 | — | Refresh significant Cursor documentation after SET-317 and SET-313. |
| 01.7 | confirmed | open | SET-339 | — | Refresh moderate Cursor documentation after SET-317 and SET-313. |
| 01.8 | confirmed | open | SET-339 | — | Refresh minor Cursor documentation after SET-317 and SET-313. |
| 01.9 | confirmed | open | SET-318 | — | Use the shared target-list formatter. |
| 02.1 | confirmed | open | SET-320 | — | Define effective override semantics; SET-351 is the rendering follow-on. |
| 02.2 | confirmed | open | SET-320 | — | `run.*` acceptance belongs to the effective-definition contract. |
| 02.3 | confirmed | fixed | SET-321 | https://github.com/outfitter-dev/skillset/pull/193 | Audit evidence was stale: merged plugin (`537e3e7f9e06613fba557069ee0a311aa2fa131a`) and frontmatter (`dae73c666b5a14ab29216eb329ea57825f05122b`) renderers consume attachment status first, then definition status. SET-321 adds explicit fallback and precedence coverage. |
| 02.4 | confirmed | open | SET-321 | — | Reject unsupported Codex symlink mode during validation. |
| 02.5 | confirmed | open | SET-319 | — | Single-source context-specific configuration key contracts. |
| 02.6 | confirmed | open | SET-321 | — | Remove the fixed-value test output kind if it carries no information. |
| 02.7 | plausible | open | SET-322 | — | Verify and refuse generated-side frontmatter divergence. |
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
| 04.1 | confirmed | open | SET-319 | — | Import context-specific key contracts from schema ownership. |
| 04.2 | confirmed | open | SET-323 | — | Single-source the semver value contract. |
| 04.3 | confirmed | open | SET-346 | — | Derive retired-surface guards from canonical tooling contracts. |
| 04.4 | confirmed | open | SET-318 | — | Consolidate target root and extension mappings. |
| 04.5 | confirmed | open | SET-323 | — | Single-source list formatting at the lowest owner. |
| 04.6 | confirmed | open | SET-346 | — | Add explicit runtime-map partition coverage. |
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
