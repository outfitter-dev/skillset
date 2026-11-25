# SET-433 license-boundary recapture

This packet records one external fixture capture at implementation commit `95951b07b821e9120ee6aae9bbadac0dd21b0939`, Bun 1.4.4. Final reviewed commit `74647a3b6a852f09099473bd006767baf800f692` adds only a regression test and two reviewed evidence-hash updates. This is neither a recapture at that final commit nor provider execution.

Run `python3 .agents/notes/2026-10-30-set-433-license-recapture/verify.py`. The verifier reads archives in memory without extraction, network access or captured-code execution. It requires the sibling historical evidence packet. Checks cover hashes, recorded compiler/manifest provenance, seven fixture tuples, original-archive references, exact projection path/byte comparisons and blocked reports. These are recorded provenance and content checks, not an independently reconstructed compiler execution or Git object chain.

| Fixture | Historical 8a5d outputs → 95951 outputs | Result |
| --- | ---: | --- |
| Browserbase | 8 → 8 | All bytes unchanged. |
| review-loop | 8 → 8 | All bytes unchanged. |
| Matt Pocock | 64 → 99 | Prior files unchanged; 35 added notices equal original root LICENSE. |
| Cursor | 8 → unavailable | Native metadata plus bundled notice conflict blocks import. |
| last30days | unavailable → unavailable | License conflict blocks before the previously recorded nested metadata failure; the latter is not resolved. |
| compound | unavailable → unavailable | Native metadata conflict. |
| Emil | unavailable → unavailable | Unattributed frontmatter blocks build. |

There are three successful selected projections and four blocked fixtures. Counts total 88→115, 80 unchanged, 35 added and eight unavailable prior Cursor outputs. Equality covers regular-file contents; mode equality, runtime dependency completeness, provider behavior and legal equivalence are not claimed. AppleDouble sidecars are excluded from file counts. One capture does not establish repeatability at 95951; historical A/B/C evidence remains specific to 8a5d.

`capture.tar.xz` preserves current raw reports, adopted source snapshots, selected projections and provenance. Duplicate original.tar payloads are omitted: `original-refs.json` records their hashes, checked against the seven current originals and the historical retained originals during capture review. The offline verifier checks those references against retained originals, but cannot independently resample the omitted current files. `capture.log`, `install.log`, `comparison.json` and `original-hash-audit.md` preserve the supporting observations. Absolute paths in raw records are historical provenance, not required local paths.

No accepted exception permits notice loss. Native identifier-plus-text representation, dependency/curation (SET-439), lifecycle/readiness (SET-438), field review (SET-442), and fixture expectations (SET-444) remain distinct follow-ups. This packet does not close those issues or retroactively repair historical outputs.
