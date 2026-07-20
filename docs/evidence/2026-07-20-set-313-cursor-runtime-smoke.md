# SET-313 Cursor Runtime Smoke Receipt

Date: 2026-07-20

Provider: Cursor Agent `2026.07.16-899851b`

Result: accepted local runtime evidence

## Result

Exactly one real provider invocation ran for this attempt. Skillset retained run
`20260720T195201Z-set313-sandboxed-relocated-config-cursor-agent-d715891d`
with exit `0`, state `passed`, no timeout, and an elapsed time of approximately
13 seconds. No fifth provider call or wrapper run followed.

The normalized provider result contained `SET313_CURSOR_PLUGIN_SMOKE_OK` after
a short skill-lookup preamble. Skillset runtime declarations define `contains`
as substring inclusion and `notContains` as substring exclusion; they do not
define exact-response equality. The SET-313 gate declared the marker through
that containment contract, so the retained passing state and contained marker
are the authoritative assertion evidence.

Skillset generated and routed the local Cursor plugin with these SHA-256
identities:

- `.cursor-plugin/plugin.json`: `3638b2e8d32d8041d15ddf9e2394f4d3963e828abe3ca74b917a6e4bc8451285`
- `skills/set313-cursor-marker/SKILL.md`: `08e1e11a3bb3a149817691d09c26e5c1c27c297426f319629fbf8735dfec0cd0`
- `plugins/skillset.lock`: `8e95d28ace8cea565ba53299644b91cc975de8ea80f96e6d6507f8a01b362fde`

## Local Verification Boundary

The run used a fresh canonical, non-symlink temporary root. `HOME` remained
inherited and unchanged. These version-specific provider/runtime variables were
confined beneath that root:

```text
CURSOR_DATA_DIR=<run-root>/cursor-data
CURSOR_CONFIG_DIR=<run-root>/cursor-config
NODE_COMPILE_CACHE=<run-root>/node-compile
TMPDIR=<run-root>/tmp
XDG_CACHE_HOME=<run-root>/xdg-cache
```

The macOS sandbox profile denied file writes by default and allowed them only
beneath `<run-root>`. Its SHA-256 was
`b23abb6083d15258f8fc7b824d65c8ab5a3459f997d61112a2bf0c895e6938f6`.
Profile compilation and an in-root write canary exited `0`. Before and after
the provider run, both a parent-process write and a descendant-process write to
the outside sibling failed with exit `1` and `Operation not permitted`.

The outside baseline remained byte- and metadata-identical:

- SHA-256: `6b71b4b2bf81ab56a9a5926b4de11cd6700a9f0c91b7a7b4af2147606386c75c`
- size: 39 bytes
- inode: `913733732`
- modification and change timestamps: `1784577030` before and after

Provider write-state appeared only in these redacted path classes beneath the
temporary root:

- `<run-root>/cursor-data/projects/<workspace-id>/...`
- `<run-root>/cursor-config/cli-config.json`
- `<run-root>/cursor-config/statsig-cache.json`
- `<run-root>/cursor-config/chats/<workspace-id>/<session-id>/...`

Metadata-only snapshots of `~/.cursor/projects`, `~/.config/cursor`,
`~/.cursor/skills-cursor`, and `~/.cursor/agent-cli-state.json` were identical
before and after. Their contents were not read.

Two outside-root write attempts were denied and remained nonfatal:

- `~/.cursor/skills-cursor/.sync-manifest.json.tmp` is a hardcoded built-in
  skill-sync path. Failure to persist the sync manifest did not affect plugin
  loading, the marker assertion, or the passing result.
- `~/.local/share/cursor-agent/.install.lock` is version-scoped background
  updater housekeeping. Its denied update check was debug-only and did not
  affect the provider process or Skillset result.

No outside write was observed. This is a bounded local harness result, not a
general write-clean guarantee: the sandbox evidence cannot exclude every
pre-opened descriptor or brokered-service side effect. Sol accepted that
residual for this authenticated, fixed-prompt smoke.

`CURSOR_DATA_DIR` and `CURSOR_CONFIG_DIR` are installed-version evidence inputs
used only to confine this verification run. They are not Skillset product
configuration and must not be added to source schema, compiler behavior,
generated output, or general provider guidance.

## Earlier Attempts

Attempt 2 proved the restrictive sandbox and generated route, but Cursor tried
to create project state under the normal home data root and exited before the
marker. Attempt 3 relocated project data with `CURSOR_DATA_DIR`, then exposed
separate config, Statsig, and chat writes and failed on the denied chat path.
Attempt 4 added the independently evidenced `CURSOR_CONFIG_DIR` confinement,
which relocated those writes and produced the accepted passing run. These
failures are causal evidence for the final boundary, not discarded trials.

## Redaction and Handling

No credential, auth record, provider cache payload, session/request identifier,
raw response, or raw provider log is included here. No login, logout, update,
or explicit configuration command ran during the smoke.

During denial classification, a broad diagnostic grep accidentally expanded
redirected Statsig-cache text into an internal tool result. The spill was
disclosed immediately. No raw payload was retained in Git, RETRO, this receipt,
or coordinator messages, and no cache, auth, or credential file was opened
again. Only the redacted path-class and boundary evidence above was retained.
