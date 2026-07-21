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
| 01.5 | confirmed | fixed | SET-313 | https://github.com/outfitter-dev/skillset/pull/323 | Accepted ADR-0002 resolves the draft/default contradiction through schema-owned defaults, explicit narrower classifications, an omitted-target all-provider regression, and a redacted runtime receipt; it was promoted without amending ADR-0001. Merged as `b351e904d14a0af4a39a066d9258f7b1c175bc76`. |
| 01.6 | confirmed | fixed | SET-339 | https://github.com/outfitter-dev/skillset/pull/325 | Significant default-build and rendering narratives now cover Cursor alongside Claude and Codex in commands, hooks, skills, instructions, layout, and quickstart, including `.cursor/skills` output; the SET-317 generated support matrices remain registry-owned. Merged as `ba1054d81994b5f6e9845955c0d03a3caab64432`. |
| 01.7 | confirmed | fixed | SET-339 | https://github.com/outfitter-dev/skillset/pull/325 | Agents, MCP, resources, and plugin documentation now records Cursor paths and native capability boundaries while preserving explicit unsupported and planned target limits. Merged as `ba1054d81994b5f6e9845955c0d03a3caab64432`. |
| 01.8 | confirmed | fixed | SET-339 | https://github.com/outfitter-dev/skillset/pull/325 | Marketplace and executable prose now covers Cursor’s native marketplace path and fail-loud unsupported plugin `bin`; existing target-native-island support truth remains explicit. Merged as `ba1054d81994b5f6e9845955c0d03a3caab64432`. |
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
| 03.4 | confirmed | fixed | SET-350 | https://github.com/outfitter-dev/skillset/pull/319 | Amendment relations are modeled separately from whole-decision supersession, with validated reciprocal decision-map edges and preview-safe ADR mutations. Merged as `12dadf7115ae15d4675f3270ae0623526538a7f9`. |
| 03.5 | confirmed | open | SET-327 | — | Determine the required amendment before any promotion. |
| 03.6 | confirmed | open | SET-326 | — | Finish the internal `try` to `test` hard cutover. |
| 03.7 | plausible | open | SET-327 | — | Audit every remaining draft and record one evidence-backed disposition. |
| 03.8 | confirmed | fixed | SET-339 | https://github.com/outfitter-dev/skillset/pull/325 | Cursor narrative, examples, default-output paths, and target caveats were reconciled with ADR-0002 and the registry-backed matrices; matrix generation/check ownership remains SET-317. Merged as `ba1054d81994b5f6e9845955c0d03a3caab64432`. |
| 03.9 | decided-needed | fixed | SET-317 | https://github.com/outfitter-dev/skillset/pull/321 | Registry-owned matrices mechanically check feature status and every canonical target support status across 35 linked feature docs while preserving narrative prose. Merged as `941e4c64212065b959cdd532a54790f59d813ed9`. |
| 03.10 | plausible | fixed | SET-339 | https://github.com/outfitter-dev/skillset/pull/325 | `source-suggestions.md` now marks provider-native no-round-trip reconciliation refusal as implemented, matching the SET-322 tested refusal path without claiming source writeback or CI automation. Merged as `ba1054d81994b5f6e9845955c0d03a3caab64432`. |
| 04.1 | confirmed | fixed | SET-319 | https://github.com/outfitter-dev/skillset/pull/306 | Core derives context-specific configuration key sets and unsupported-destination policy from schema ownership. Merged as `7760699e9b10cb73e3a7b145dfcb73b5936ae46a`. |
| 04.2 | confirmed | fixed | SET-323 | https://github.com/outfitter-dev/skillset/pull/312 | Schema owns the canonical SemVer contract and fresh RegExp factory, with exact-string parity across consumers. Merged as `ec7c5afcaee4f827969cff9ffdd4f7ab8408de85`. |
| 04.3 | confirmed | fixed | SET-346 | https://github.com/outfitter-dev/skillset/pull/314 | Direct retired CLI guard patterns derive from the authoritative command and flag arrays while bespoke semantic patterns remain explicit. Merged as `e468628c8ce62b115d3cb764313d7799f8d0ecfa`. |
| 04.4 | confirmed | fixed | SET-318 | https://github.com/outfitter-dev/skillset/pull/305 | Canonical target descriptors own project roots, project-agent extensions, display labels, and generated session expressions. Merged as `0ea4c96b72da7bad975988aeafa652716f0ced91`. |
| 04.5 | confirmed | fixed | SET-323 | https://github.com/outfitter-dev/skillset/pull/312 | Schema owns the shared lowest-owner list formatter used across Schema, Core, and CLI. Merged as `ec7c5afcaee4f827969cff9ffdd4f7ab8408de85`. |
| 04.6 | confirmed | fixed | SET-346 | https://github.com/outfitter-dev/skillset/pull/314 | The exported runtime distribution map and named exclusions form an exact partition of registered runtime IDs. Merged as `e468628c8ce62b115d3cb764313d7799f8d0ecfa`. |
| 04.7 | plausible | wont-fix | SET-343 | — | Baseline counts are intentionally prose observations, not product contracts. |
| 04.8 | decided-needed | fixed | SET-340 | https://github.com/outfitter-dev/skillset/pull/316 | The narrow AST topology guard rejects target subsets and implicit fallback chains through exact maintained exemptions, while exhaustive local target maps prevent implicit fallthrough. Merged as `dca901480f08b3e0d7da15255bcffe6c22020ebb`. |
| 05.1 | confirmed | open | SET-332 | — | Prove the finite-command adapter; SET-347 owns downstream migration. |
| 05.2 | confirmed | open | SET-333 | — | Extract the Core evaluation engine; SET-348 owns the app adapter split. |
| 05.3 | confirmed | open | SET-334 | — | Extract a reusable Core source-readiness operation. |
| 05.4 | confirmed | open | SET-335 | — | Relocate provider-maintenance codegen to its owning package. |
| 05.5 | confirmed | open | SET-341 | — | Share scaffold-report primitives across authoring flows. |
| 05.6 | confirmed | open | SET-337 | — | Required scope is the named `render.ts` seams; other large files are candidates only. |
| 05.7 | confirmed | open | SET-336 | — | Split inspection parsers and share lexical readers. |
| 05.8 | decided-needed | open | SET-342 | — | Re-baseline internal imports only after ownership moves. |
| 06.1 | confirmed | fixed | SET-328 | https://github.com/outfitter-dev/skillset/pull/330 | Shared recovery classification now drives terminal, Markdown, and JSON with authority-safe actions, reasons, paths, refs, scopes, and copyable commands. Merged as `d1da3a518ce50789f3777e1713ddc359af4f27c3`. |
| 06.2 | confirmed | fixed | SET-329 | https://github.com/outfitter-dev/skillset/pull/318 | Preview-first change refresh replans current evidence under an owner-fenced ledger lock, applies only with confirmation, and remains idempotent across concurrent callers. Merged as `936e1832d762cbdd69fc2dfece09eb748f8414e9`. |
| 06.3 | confirmed | fixed | SET-330 | https://github.com/outfitter-dev/skillset/pull/327 | Preview-first change ignore appends one explicit audit disposition only with confirmation while retaining the pending reason and current coverage evidence. Merged as `85dff8c70aed57427fa97a07f12b77019b8046bd`. |
| 06.4 | confirmed | fixed | SET-331 | https://github.com/outfitter-dev/skillset/pull/329 | Read-only restore listing validates manifests, Git payloads, portable paths, and current-target safety before reporting deterministic backup availability. Merged as `aeb62e19eaf72290fe19f8d67039f92417e1e5f0`. |
| 06.5 | plausible | open | SET-338 | — | May be deferred only with demand evidence allowed by the issue contract. |
| 06.6 | plausible | fixed | SET-328 | https://github.com/outfitter-dev/skillset/pull/330 | Recovery guidance is classified from live change, provider, reconciliation, drift, and write-eligibility facts so each surface withholds commands that cannot repair the reported state. Merged as `d1da3a518ce50789f3777e1713ddc359af4f27c3`. |
