---
description: Container-fence correctness controls and finite parser-cost measurements for SET-673.
---

# SET-673 Container Fences

Marked references inside fenced code nested in lists or blockquotes were rewritten as active references. Thirteen initial public-API tests produced eleven failures; the correction shares the pinned CommonMark 0.31.2 block discovery with HTML handling and uses public fenced-code metadata and source positions for nested fences. Top-level fence handling and the separate indented-code policy remain unchanged. Parser-confirmed container endings prevent an unclosed nested fence from masking the next block.

The final focused corpus passes 139 tests / 322 assertions across six scanner and link-consumer files. Controls cover four-column lists, nested and ordered lists, quote/list combinations, tab continuation, empty list openers, compact quotes, both marker families, short/wrong closers, unclosed fences, container exits, raw HTML, tables and UTF-16 offsets across LF/CRLF/CR. Public rewrite normalizes newline variants; range assertions use original offsets. Initial typecheck passed; the final gate reruns it after the filter improvement.

## Measured cost

An initial 24-sample series at `792179d0d979a96ffe61f0a5a9328cd151c54c09` exposed unnecessary parsing for top-level indented fence-like text with no container: a two-megabyte backtick paragraph before that text used approximately 602–618 MiB peak RSS, versus 234–236 MiB before. A conservative container-presence filter now requires a possible list or quote opener somewhere in the document before requesting nested-fence discovery. The parser still decides grammar; this filter is not a second container parser.

The final series compares clean baseline `7187126850a6f75e21908d3161ad6a3d76a06ad7` and candidate `9d03f070e9a828519811949d0b0f312709f0feeb`. Four finite workloads each ran three counterbalanced baseline/candidate pairs (AB, BA, AB), in fresh processes with offline frozen dependencies and Bun 1.4.4. All 24 final commands passed and were attributable to their exact clean trees. The prior full verification had ended; no campaign gate ran concurrently. Ambient host load was recorded, cache state uncontrolled, and no cold/warm or statistical-significance claim is made.

| Workload | Baseline function ms | Candidate function ms | Baseline peak MiB | Candidate peak MiB |
| --- | --- | --- | --- | --- |
| One million alternating backtick runs | 76.00–79.65 | 76.89–80.78 | 235.12–239.44 | 229.44–232.39 |
| Same paragraph before a quote fence | 77.96–79.92 | 182.11–185.35 | 231.31–235.44 | 612.19–619.59 |
| Same runs inside a quote fence | 77.09–80.76 | 0.93–0.96 | 239.22–245.77 | 32.53–32.78 |
| Same paragraph before top-level indented tildes | 77.24–79.44 | 77.03–82.95 | 229.78–234.38 | 225.08–236.08 |

Function time excludes imports/input construction; RSS is the whole child process peak. The inside-fence case changes the result from 500,000 falsely paired inline spans to one protected fenced range, so its lower cost is not equivalent-work speedup evidence. The before-container case adds the previously missing fenced range; the plain and indented cases retain 500,000 ranges with matching first/last boundaries.

A genuine quote fence after the pathological paragraph still requires a full inline AST: peak RSS is about 612–620 MiB, versus 231–235 MiB in the baseline. False candidates elsewhere in a document that also contains a possible container can likewise trigger parsing. This known allocation tradeoff is not resolved by the filter; larger inputs or concurrency can amplify it. The implementation does not claim a memory bound, performance neutrality, complete GFM coverage, or completion of the other SET-673 outcomes. No arbitrary limits, hidden fallback or private parser API are introduced.

[Machine observations and exact workload script](2026-11-01-set-673-container-cost.json) retain all final samples, source and input hashes, load, wall time, RSS and raw evidence hashes. Initial-series raw reports remain local. These measurements qualify the stated inputs on this host only.
