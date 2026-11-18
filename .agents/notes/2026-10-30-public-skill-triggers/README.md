# Public skill trigger evidence — SET-457

The six synthetic cases cover two positive requests, two unrelated provider/editor settings requests, and two ambiguous one-off/adoption requests. `assessment.json` records manual decisions from the retained raw traces, not automatic grades derived from process success. Claude selected `skillset:skillset` for both positives and the ambiguous adoption question, skipped both negatives and the disposable one-off, and made adoption conditional on reuse/provider needs. All six trigger-boundary assessments pass on the observed Claude model; this does not validate every command or factual statement in its answers.

The native CLI was Claude Code 2.1.312, reporting `claude-opus-5-5` in each clean run. No model override or fast-mode change was made. Each run used an empty independent directory, closed stdin, only Skill/Read tools, empty setting sources, strict MCP selection, no session persistence and a process-local `--plugin-dir`. Built-in Claude plugins remained present in its reported environment. No provider files, global settings or runtime installation were changed. Prompts describe hypothetical artifacts; the case workspaces contain no such files. Case 6's unsuccessful read attempts and follow-up question are part of the evidence.

`claude-traces.tar.xz` contains the six unedited stdout/stderr pairs, exit/argv/cwd records and the source, generated skill and manifest digests sampled after the runs. These inputs were not edited during the clean run. `sha256.json` binds the case set, replay script, assessment and archive. Preliminary runs in `/private/tmp/set457-trigger-trials` are excluded: the Python heredoc runner leaked its script through inherited stdin into several prompts. The retained replay closes stdin explicitly; none of those preliminary responses support this assessment.

Replay from a checkout with built output and an authenticated Claude CLI:

```sh
python3 .agents/notes/2026-10-30-public-skill-triggers/replay-claude.py --repo . --out /tmp/skillset-trigger-replay-unique
```

The output directory must be new. Execution is opt-in and may consume model allowance; each process has a one-dollar limit and a 100-second timeout. The script records execution only; inspect traces to grade the authored expectations.

Cross-provider acceptance remains open. The existing product eval runner explicitly marks plugin-owned Codex trials unavailable, and neither Cursor CLI binary (`cursor-agent` or `agent`) is present here. Neither provider was executed or marked passed. The same case set is retained for those providers. This is partial SET-457 evidence, not issue closure or permission to mark the draft ready.
