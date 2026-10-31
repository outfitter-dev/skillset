---
description: Records dated provider documentation for plugin and skill installation, discovery, updates and removal, with runtime verification gaps.
---

# Provider Installation and Discovery Research

**Checked:** 2026-10-31. **Owner:** [SET-461](https://linear.app/outfitter/issue/SET-461). **Status:** documentation research; runtime acceptance remains open.

This report supports SET-468 (location evidence), SET-469 (installation journeys), and SET-473 (companion installation). It does not change their contracts or replace the [version-specific location registry](../../../packages/registry/src/provider-locations.ts). No plugin was installed, trusted, enabled, published or removed. No provider session or account workflow was exercised.

## Evidence and version boundaries

| Evidence | Version and date | What it establishes |
| --- | --- | --- |
| Official pages linked below | Retrieved 2026-10-31; living documentation without a uniform product-version pin | Documented workflows and restrictions on that date; not local runtime results. |
| Local `codex --version` | `codex-cli 0.166.0`, 2026-10-31 | Executable version only. The sandbox rejected an attempted PATH-alias setup; no installation or activation was tested. |
| Existing location registry | Verified 2026-09-11; Claude Code 2.1.269, Codex 0.154.0, other surface-specific evidence | Retained historical evidence. A newer documentation date does not automatically validate those paths for another binary. |
| Claude Code/app, ChatGPT desktop/web, Cursor | No runtime version qualified in this investigation | Exact app builds, account policy and observed behavior remain required for runtime claims. |

The local provider-document library was unavailable. Research used the primary pages below. “Unknown” means these sources or this investigation do not establish the claim; it does not mean impossible. Commands and UI steps are research findings, not actions performed here.

## Claude surfaces

### Claude Code CLI and local desktop sessions

The documented CLI route is `claude plugin marketplace add <source>`, then `claude plugin install <name>@<marketplace> --scope project`; user is the default scope. `/plugin` provides an interactive browser. Desktop local sessions expose prompt **+ → Add plugins**. User, project and local enablement use `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json`; project settings alone do not download collaborators’ plugins. `list`/`details` provide inspection, while disable and uninstall are different operations. Official marketplaces generally auto-update with named exceptions; other sources generally require opt-in. Reload plugins or start a new session after updates. Account-enabled plugins sync into signed-in Code; local CLI installation does not sync back to the account. Claude Code cloud sessions lack this local plugin browser. These distinctions come from [plugin management](https://code.claude.com/docs/en/discover-plugins); authentication, trust and successful activation were not tested.

For direct skills, personal and project roots are `~/.claude/skills/<name>/SKILL.md` and `.claude/skills/<name>/SKILL.md`. The skills guide distinguishes account/cloud skills from local files, and documents version-dependent nested/worktree discovery (including v2.1.246 and v2.1.277 conditions). File placement can be scripted, but a file existing does not prove discovery. Read [Claude Code skills](https://code.claude.com/docs/en/skills) before selecting a scope. The [plugin reference](https://code.claude.com/docs/en/plugins-reference) also distinguishes installed version directories from persistent plugin data at `~/.claude/plugins/data/<id>/`; do not treat a data directory as the install root. Current runtime cache layout and cleanup were not requalified.

### Claude.ai, Desktop Chat and Cowork

Use **Customize → Skills or Plugins → Discover** to add directory items. Custom skills can be uploaded as ZIPs through Skills; toggling and deleting custom skills are account operations, not edits to local Code folders. Added plugins are account-backed and documented across chat, Desktop Chat, Cowork and signed-in Code, subject to capability and policy limits. See the [unified directory](https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory) and [skill management](https://support.claude.com/en/articles/12512180-use-skills-in-claude). No general headless account API or physical web-storage path was established. Availability depends on plan, code execution and organization policy.

Cowork on web and desktop is distinct from Claude Code cloud sessions. Local MCP capabilities require desktop; a web-visible plugin is not proof that its local tools run there. See [Cowork surfaces](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile).

Organization plugins have separate distribution: upload a replacement ZIP using the same name, or configure a GitHub-synced marketplace. Optional automatic sync follows qualifying default-branch merges and version changes; removal and sync affect organization inventory. The current organization-sync guide limits that route to private/internal repositories, which does not restrict Code’s separate public marketplace route. Organization skills use their own publishing workflow. See [organization plugins](https://support.claude.com/en/articles/13837433-manage-plugins-for-your-organization) and [organization skills](https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization). These are documented administration paths, not verified unattended APIs.

## ChatGPT and Codex surfaces

### Shared directory and Codex CLI

On web or desktop, open **Plugins**, choose a plugin, install with its plus control, complete required connections, then start a new chat. Codex CLI uses `/plugins`; its browser supports installation, uninstall and enable/disable, followed by a new session. The IDE extension does not support plugins, although it supports standalone skills. Uninstall removes a plugin bundle from that environment but does not disconnect separately connected integrations. Workspace policies can prevent user uninstall. These are [documented plugin workflows](https://learn.chatgpt.com/docs/plugins), not an established noninteractive installation API. Universal-directory auto-update behavior was not established here.

### Local desktop marketplaces and disk locations

Repository catalogs live at `.agents/plugins/marketplace.json`; personal catalogs at `~/.agents/plugins/marketplace.json`. Add the plugin folder and catalog entry, restart the desktop app, then browse/install from that source. A relative `source.path` is resolved from the marketplace root, not its metadata subdirectory. The documented installed cache is `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`, with `local` for local plugins. Edit the source directory and restart to pick up local changes. Root `plugin.json` with `extensions.com.openai` is preferred; `.codex-plugin/plugin.json` is a fallback. `codex plugin marketplace add/list/upgrade/remove` manage catalog sources; catalog management is distinct from installation. Project enablement uses trusted `.codex/config.toml`. See [packaging and local marketplaces](https://developers.openai.com/plugins/build/plugins). This confirms documented repository discovery; it does not prove the behavior of this machine’s desktop build.

### Web and workspace distribution

Web supports eligible plugins; **Desktop only** capabilities cannot run there. In particular, saving a plugin with local MCP apps to an account does not deploy those tools to the web. Eligible administrators can use **Admin → Plugins → Add → Upload plugin** for a ZIP; manual uploads have an **Upload new version** action where permitted. Source-managed plugins must be updated through their source. See [Plugins in ChatGPT](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt). Account storage has no local filesystem path established by this report, and a local catalog is not evidence of web installation.

For workspace GitHub imports, admins use **Add → Import marketplace**, supply the repository, optional subdirectory and branch/tag/commit, authorize access, then review import results. New marketplaces sync daily; **Sync now** requests refresh. An invalid update retains the previous working plugin. Removing an entry from GitHub leaves its workspace copy; deleting the marketplace deletes its imported plugins. See [workspace import and sync](https://learn.chatgpt.com/docs/enterprise/plugin-management). These semantics must not be substituted for CLI marketplace removal or local cache cleanup.

### Standalone skills

The [skill guide](https://learn.chatgpt.com/docs/build-skills) documents repository `.agents/skills` discovery from the working directory through repository root, personal `~/.agents/skills`, admin `/etc/codex/skills`, and bundled system skills. It also documents symlink support, automatic change detection with restart as recovery, and `[[skills.config]]` disable entries. Local file creation is scriptable; runtime selection is not established by placement. The built-in skill installer is a conversational workflow, not evidence of a stable shell install API. Standalone skills and plugin-bundled skills have different surface availability. No universal standalone-skill auto-update or uninstall protocol was established.

## Cursor surfaces

The editor’s **Customize → plugin → Install** flow offers project or user scope. For local development, use `~/.cursor/plugins/local/<name>` and reload/restart; local imports must be permitted. This local path is not the undocumented marketplace-install cache. Team marketplace imports support manual refresh and optional GitHub auto-refresh, with re-indexing limited to once per ten minutes. Existing Cloud Agents retain their starting plugin version. Required plugins cannot be uninstalled; individual cache deletion and universal installed-plugin auto-update behavior remain unestablished. See [Cursor plugins](https://cursor.com/docs/plugins) and the [format reference](https://cursor.com/docs/reference/plugins).

Direct skills are discovered in repository/user `.agents/skills` and `.cursor/skills`, with additional compatibility roots. Customize lists skills and `/skill-name` invokes them. Optional personal-skill cloud sync applies to personally started Cloud Agents; automation runs do not load those personal synced skills, and `~/.agents/skills` is not copied to remote workers. Use the [skills documentation](https://cursor.com/docs/skills) to distinguish local discovery, synchronization and distribution. No runtime install/discovery was tested.

[Plugin help](https://cursor.com/help/customization/plugins) describes desktop/web/CLI availability; [CLI help](https://cursor.com/help/integrations/cli) documents headless agent tasks and CLI updates. Neither fact establishes unattended plugin installation or plugin auto-updates. A [2026-10-29 Cursor staff response](https://forum.cursor.com/t/feature-request-support-non-interactive-marketplace-plugin-installation-via-cursor-cli/176666) describes project `.cursor/settings.json` plugin declarations but no dedicated noninteractive user-scope install command. Treat that as an untested staff statement, not a version-qualified config contract; no registry promotion is proposed on that basis.

## Findings and remaining qualification

The documented restrictions are concrete: Codex IDE plugins are unavailable; Desktop-only ChatGPT plugins do not run on web; local MCP capabilities need the appropriate local execution surface; local user skills are not universally copied to cloud workers. The exact boundary varies by product. Missing storage paths or headless APIs remain unknown, rather than being labeled unsupported.

Before a downstream installation command or beta journey claims runtime support, record a specific provider build, OS, account/organization context and disposable fixture; then observe discovery, explicit installation/trust, new-session availability, version update, disable and removal. Capture provider-native inspection where available and distinguish its report from actual invocation. Obtain authority for account/global changes before executing that qualification. This report does not grant it.

SET-468 should reconcile dated source evidence with the existing registry, preserving unknown rows until evidence supports a change. SET-469 can use the documented steps with visible version and surface qualifications. SET-473 needs separate install and catalog-management adapters; a catalog file or successful compiler build is not an installation receipt. SET-461 remains open for runtime/version evidence, including desktop/web account flows, cache/removal behavior and unattended installation boundaries.
