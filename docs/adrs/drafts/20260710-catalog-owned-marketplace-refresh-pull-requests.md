---
slug: catalog-owned-marketplace-refresh-pull-requests
title: Catalog-Owned Marketplace Refresh Pull Requests
status: draft
created: 2026-07-10
updated: 2026-07-10
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, global-xdg-managed-installs-and-sync]
---

# ADR: Catalog-Owned Marketplace Refresh Pull Requests

## Context

A Skillset marketplace repository is a curated catalog. It may contain local
plugins, but it can also reference plugins whose source, generated bundles,
versions, and release history remain in another repository. For the concrete
Outfitter case, `outfitter-dev/outfitter` owns marketplace membership while a
plugin such as Trails remains authored and released from
`outfitter-dev/trails`.

`skillset marketplace check` and `skillset marketplace update` already define
the right compiler boundary: resolve committed catalog intent, prove generated
provider output, render the provider index, and record the exact result in
`skillset.lock`. They do not yet provide a complete CI path. External entries
resolve only through the current checkout or the user/XDG known-Skillsets
index. A clean CI runner has neither, so it cannot refresh a catalog from a
remote plugin reference today.

The second pressure is authority. A plugin repository can know that it released
a plugin, but it should not own catalog membership, the catalog branch, or a
credential that can write the catalog repository. Treating the plugin event as
a command would let a compromised provider repository choose what another
repository checks out and commits. Putting all logic in every plugin workflow
would also duplicate the marketplace resolver that Skillset already owns.

GitHub's mechanics reinforce this split:

- `repository_dispatch` runs the workflow on the target repository's default
  branch and exposes `client_payload`, so it is suitable for a hint but not for
  source truth.
- Creating a repository dispatch requires `contents: write` on the target
  repository, which is too much authority to distribute to every plugin repo.
- A pull request created with the repository `GITHUB_TOKEN` can require a human
  to approve its workflow runs. An installation token from a catalog-only
  GitHub App avoids that approval when unattended checks are desired.
- GitHub App installation tokens can be restricted to selected repositories
  and permissions and expire after one hour.

## Decision

**Marketplace refresh PRs are catalog-owned pull workflows. Plugin events are
untrusted hints; committed marketplace source is the only authority for what a
refresh may resolve or change.**

### Ownership Boundary

| Concern | Owner |
| --- | --- |
| Plugin source, version, generated bundles, release SHA | Plugin repository |
| Catalog membership, requested channel/ref/version/SHA policy | Marketplace repository source |
| Remote checkout, readiness, provider index rendering, lock provenance | Skillset |
| Refresh branch, commit, pull request, reviewers, merge policy | Marketplace repository workflow |
| Event delivery across repositories | Optional GitHub App or manual/scheduled trigger |

Skillset does not gain a command that opens a PR. The marketplace workflow runs
the existing `marketplace check` and `marketplace update` commands, consumes
their JSON, and uses ordinary Git/GitHub tooling for the repository-owned PR.
This keeps compilation and repository automation modular.

### Trigger Model

The first working path is catalog-pull, with no credential installed in plugin
repositories:

1. `workflow_dispatch` provides an immediate operator-triggered refresh.
2. A conservative schedule discovers floating `channel`, `ref`, or `version`
   movement without cross-repo event credentials.
3. A later GitHub App webhook may send a `repository_dispatch` event to reduce
   latency after a plugin release.

All trigger forms run the same catalog workflow. A dispatch payload is bounded
to these hint fields:

```json
{
  "eventId": "provider-release-delivery-id",
  "sourceRepo": "github:outfitter-dev/trails",
  "plugin": "trails-review",
  "sourceSha": "0123456789abcdef0123456789abcdef01234567",
  "sourceRef": "v1.2.3"
}
```

The payload cannot select a target repository, base branch, catalog path,
provider output path, shell command, credential, or arbitrary ref policy. The
workflow accepts a hint only when the committed marketplace source already
contains the same `repo` plus `plugin` pair. Its committed `channel`, `ref`,
`version`, or `sha` policy decides what Skillset resolves. A supplied full SHA
is recorded as event evidence and compared with the resolved result; it never
overrides a pinned source declaration.

Every trigger refreshes the selected catalog as a whole. `marketplace update`
already computes a coherent catalog and lock, so event-specific partial writes
would add a second update model and make concurrent plugin releases race.

### Remote Acquisition Is The First Prerequisite

Skillset must resolve remote external entries without a developer's known-
Skillsets index before PR automation is truthful. The resolver gains a
`remote-cache` source kind with these rules:

- committed `repo` and ref policy are the only checkout inputs;
- checkouts live in the deterministic Skillset XDG cache bucket, never in
  `.skillset/cache` and never in the catalog worktree;
- pinned full SHAs are fetched and verified exactly;
- floating refs resolve to a full commit SHA before readiness is evaluated;
- acquisition never pushes, modifies the remote repository, installs output,
  or trusts provider runtime content;
- the report and `skillset.lock` contain portable repo/ref/SHA/version/output
  evidence, never host-specific cache paths;
- repeated runs reuse the cache but verify the requested commit and generated
  output rather than trusting cache presence;
- failed or unavailable acquisition remains `not-ready` and cannot produce a
  marketplace update.

Public GitHub repositories need no secret. Private plugin repositories use a
separate read-only credential scoped to declared source repositories. The
catalog writer credential is never reused for plugin acquisition.

### Catalog Workflow

The repository-owned workflow performs one deterministic transaction:

1. Check out the catalog default branch with enough history to create a branch.
2. Install a pinned released Skillset version.
3. Run `skillset marketplace check <catalog> --json` with remote acquisition
   enabled by the implementation's ordinary resolver policy.
4. Run `skillset marketplace update <catalog> --yes --json` only when the
   readiness plan can be satisfied.
5. Run the repo's normal `skillset ci`, generated-output verification, and
   provider index validation.
6. Fail without a Git commit when any source is unresolved, stale, unsupported,
   malformed, or inconsistent with pinned provenance.
7. Exit successfully without a PR when the worktree is unchanged.
8. Commit only the provider marketplace index files and `skillset.lock` on a
   deterministic branch such as `skillset/marketplace-refresh/<catalog>`.
9. Create or update one open PR for that catalog.

The workflow uses a concurrency group keyed by catalog and does not cancel a
run already writing its branch. Scheduled and event-triggered refreshes
therefore converge on one branch and one PR instead of opening one PR per
plugin event.

If the existing refresh branch contains commits not authored by the automation
identity, the workflow stops instead of force-pushing over them. A retry of the
same event or resolved catalog state is idempotent.

### Pull Request Evidence

The PR body is generated from the marketplace JSON report and Git diff. It
contains:

- catalog name and trigger kind;
- matching hint fields, when present;
- pinned Skillset CLI version;
- each changed entry's plugin id, source repo, requested policy, previous and
  new resolved full SHA/ref/version, provider target, provider source form,
  generated output path, and readiness result;
- changed catalog/lock paths;
- exact verification commands and result;
- retry/event id and a statement that no plugin repository was mutated.

Local XDG paths, tokens, checkout URLs containing credentials, and raw command
logs are excluded. Unchanged entries may be summarized by count rather than
expanded.

### Credentials And Permissions

The default manual proof may use the catalog repository's `GITHUB_TOKEN` with
job-level `contents: write` and `pull-requests: write`. Because GitHub can place
workflows for a `GITHUB_TOKEN`-created PR into approval-required state, the
recommended unattended production identity is a GitHub App installed only on
the catalog repository with:

- `contents: write` for the refresh branch and commit;
- `pull requests: write` for create/update and comments;
- no `workflows`, `administration`, `actions`, or organization permission.

The workflow mints a short-lived installation token for only the catalog
repository. Private source acquisition uses a different read-only App/token
with `contents: read` on explicitly selected plugin repositories. Personal
access tokens are a recovery path, not the recommended design.

### Failure And Retry Contract

| Failure | Result |
| --- | --- |
| Unknown event repo/plugin pair | Ignore or fail as invalid input; never acquire it. |
| Remote ref/SHA unavailable | `not-ready`; no catalog write or PR update. |
| Generated plugin output missing/stale | `not-ready`; no catalog write or PR update. |
| Pinned policy and event hint disagree | Fail with both SHAs; committed policy wins. |
| Catalog update changes unexpected paths | Fail before commit and report the allowlist violation. |
| Existing bot branch contains human commits | Fail without force push; ask for branch cleanup/review. |
| PR already open | Update the same branch/body after all checks pass. |
| No diff | Successful no-op; close no existing PR automatically. |
| GitHub API/token outage | Leave current PR untouched; retry the workflow. |

### Implementation Slices

The ordered work is:

1. **Skillset remote-cache resolution.** Add deterministic remote acquisition
   for external marketplace entries and prove clean-CI resolution, pinned SHA
   enforcement, floating ref provenance, cache reuse, and no external writes.
2. **Outfitter catalog workflow dogfood.** In `outfitter-dev/outfitter`, add the
   manual/scheduled catalog-owned refresh workflow using Skillset JSON and the
   repository's chosen writer identity. This is an external-repo issue and is
   not authorized by this ADR alone.
3. **Event adapter.** Add GitHub App delivery from plugin release events only
   after the pull workflow is stable. Dispatch remains a hint and reuses the
   catalog workflow.
4. **Reusable workflow or scaffold.** Generalize only after the Outfitter path
   proves which inputs and permissions repeat. Until then, a generic Skillset
   PR command or workflow scaffold would be speculative.

The first slice is the only Skillset-local implementation required before the
catalog workflow can work in a clean runner. Existing `--json`, update preview,
explicit `--yes`, readiness, and lock reports are sufficient for the first PR
workflow; no second report format or automation-specific command is needed.

## Consequences

### Positive

Catalog membership stays reviewable in one repository, plugin repositories keep
their own release authority, and Skillset remains the single implementation of
resolution/readiness/rendering. A compromised or misconfigured plugin workflow
cannot select arbitrary catalog inputs or write catalog branches. Scheduled
pull also provides eventual refresh without distributing cross-repo secrets.

### Tradeoffs

The first event-free workflow has polling latency. Private plugin repositories
need a second read-only credential boundary, and unattended PR checks need a
catalog-only GitHub App rather than the default `GITHUB_TOKEN`. Remote
acquisition increases network/cache complexity and must remain outside default
offline build/check paths unless marketplace resolution requires it.

### What This Does NOT Decide

This ADR does not install the Outfitter workflow, create GitHub Apps or secrets,
change repository protection, publish a marketplace, merge refresh PRs, or
mutate plugin repositories. Those are explicit repository/organization setup
steps.

It does not define provider marketplace formats. `marketplace update` continues
to derive provider-native output from the registry and provider adapters.

It does not make event delivery necessary for correctness. Manual and scheduled
catalog pull remain complete paths.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source remains the reviewed product; generated catalog files remain output.
- [Global / XDG Managed Installs and Sync](20260604-global-xdg-managed-installs-and-sync.md) - establishes Skillset-owned XDG state and the no-activation boundary.
- [Marketplaces](../../features/marketplaces.md) - current source, readiness, update, and lock contract.
- [CI](../../features/ci.md) - current report and generated-drift workflow behavior.
- [GitHub workflow events: `repository_dispatch`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch) - dispatch runs from the target default branch and exposes bounded client payload.
- [GitHub repository dispatch endpoint](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event) - dispatch creation requires target-repository contents write permission.
- [GitHub `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs) - automated PR checks can require approval; App/PAT identity avoids it.
- [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) - repository/permission scoping and one-hour expiry.
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) - least-privilege permission model.
- [SET-237](https://linear.app/outfitter/issue/SET-237/plan-marketplace-refresh-pr-automation-across-plugin-and-catalog-repos) - design acceptance criteria and implementation issue requirement.
