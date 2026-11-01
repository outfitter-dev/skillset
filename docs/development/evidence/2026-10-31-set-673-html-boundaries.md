---
description: HTML-block classification controls and measured large-input cost for the scoped SET-673 scanner correction.
---

# SET-673 HTML Block Boundaries

Explicit references inside raw HTML were incorrectly hidden by paired backticks or apparent code fences. The correction uses the already-pinned CommonMark 0.31.2 parser's HTML block line spans as boundaries for the existing code-span scanner. Raw HTML is not added to the literal-code mask, so marked references there remain active. Actual code spans and fences retain their protection.

The parser owns block grammar; a permissive prefix filter only avoids parsing when no HTML block opener could occur. It admits whitespace and list/quote container punctuation before a possible opener. This is not a new HTML parser, a full GFM implementation, or a general repair for the issue's other list, quote, inline-link and reuse follow-ups.

## Correctness evidence

The original implementation failed 16 focused cases with two passing controls. The final focused corpus passes 134 tests and 349 assertions across HTML boundaries, reference preprocessing, ordered ranges, rule links, nested resources and rendered Markdown links; typecheck passed before the final filter/test additions and is rerun by the final gate.

Coverage includes all seven CommonMark HTML block forms, script/style/pre/textarea, apparent tilde/backtick fences inside HTML, crossing either boundary, blank-line termination, adjacent blocks, EOF, CRLF/CR/UTF-16 offsets, list/quote containers and real code negatives. A tab-container fixture was corrected from two to four continuation spaces after checking the pinned parser's actual list content column; production behavior was not changed to fit it.

An initial review concern classified a leading `<div>` line as a GFM table row. The [GFM table rule](https://github.github.com/gfm/#tables-extension-) ends tables at a new block-level structure. GitHub's Markdown API in GFM mode confirmed a header-only table followed by raw HTML for the exact synthetic fixture, so the concern was withdrawn and retained as a positive regression. The inline `<span>` control still protects actual code in a table cell. This is a dated syntax observation, not qualification of agent-provider execution.

## Cost and retained limitation

The first candidate (`354118cbe0024969128bb1e1c31483583a840d74`) invoked the parser for every document containing `<`. A two-megabyte alternating-backtick paragraph with a trailing inline tag allocated an unnecessary inline AST: approximately 591–602 MiB peak process memory, versus 219–221 MiB before. That observation prompted the permissive block-candidate filter.

Final measurements compare clean baseline `5adc3e85158ade07848631c0f446a2cd443bbcbd` with candidate `a8b149c204cc2d1fe854a8e1d1060147330bb6f3`. Five synthetic workloads each ran three counterbalanced baseline/candidate pairs, in fresh processes on Bun 1.4.4. All 30 commands succeeded and the repository measurement harness marked them attributable. The source checkouts were isolated, dependencies installed offline with a frozen lock, and other campaign full verification had terminated. Cache state was uncontrolled; no cold/warm or statistical-significance claim is made.

| Workload | Baseline function ms | Candidate function ms | Baseline peak MiB | Candidate peak MiB |
| --- | --- | --- | --- | --- |
| One million alternating backtick runs | 79.71–83.59 | 77.93–79.85 | 219.6–228.2 | 229.5–243.9 |
| Same paragraph with trailing inline tag | 75.83–78.34 | 79.29–81.29 | 220.2–225.4 | 232.5–238.1 |
| Same runs inside an HTML block | 78.47–82.17 | 0.94–1.00 | 223.1–224.8 | 34.6–34.7 |
| Same paragraph before a real HTML block | 78.16–80.78 | 181.63–186.36 | 218.5–222.9 | 608.8–624.0 |
| One thousand comments through link-context scanning | 295.00–297.45 | 361.55–366.16 | 70.2–71.1 | 85.7–88.8 |

Function timing excludes imports and input construction; peak RSS covers the whole child process. The HTML-only case now correctly returns zero code spans, while its baseline incorrectly returned 500,000; it is not equivalent-work speedup evidence. The other million-run cases retain 500,000 spans with matching boundary observations. Comment cases keep hidden links inactive and the final real link active.

The real-block-after-paragraph case retains a substantial allocation penalty because the public CommonMark API builds inline nodes even when only block positions are needed. The filter cannot eliminate that genuine candidate. This implementation prioritizes correct block boundaries using the existing public parser rather than a second incomplete block grammar or an override of undocumented parser internals. It does **not** claim performance neutrality, a hard memory bound, or immunity to larger pathological inputs. A future optimization must preserve the transition/container controls and qualify this allocation cost directly; arbitrary input limits or silent fallback are not introduced here.

[Machine observations and exact workload script](2026-10-31-set-673-html-cost.json) retain every final sample, input hashes, commit/tree IDs, loads, wall time, RSS and raw evidence hashes. Raw original harness files and the first-candidate series remain local. The measurements qualify these finite inputs on this host; broader source or provider behavior is not inferred.
