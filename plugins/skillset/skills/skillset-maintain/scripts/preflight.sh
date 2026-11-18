#!/bin/sh
# Observation only: never invoke package managers, initialize, or build.
set -u
root=${1:-.}
scope=${2:-repo}
case "$scope" in repo|user) ;; *) printf '%s\n' 'scope must be repo or user' >&2; exit 2 ;; esac
[ -d "$root" ] || { printf '%s\n' 'root must be an existing directory' >&2; exit 2; }
case "$0" in */*) script_dir=${0%/*} ;; *) script_dir=. ;; esac
qualified=
compatibility_scope=
while IFS='=' read -r key value; do
  case "$key" in cli) qualified=$value ;; scope) compatibility_scope=$value ;; esac
done < "$script_dir/../assets/compatibility.env" || exit 2
[ -n "$qualified" ] && [ "$compatibility_scope" = entry-preview ] || exit 2
cli=missing
version=unknown
if command -v skillset >/dev/null 2>&1; then
  cli=unknown
  if observed=$(skillset --version 2>/dev/null && printf x); then
    observed=${observed%x}
    newline='
'
    observed=${observed%"$newline"}
    case "$observed" in
      ''|*[!0-9.]*|.*|*.) ;;
      *)
        major=${observed%%.*}
        rest=${observed#*.}
        minor=${rest%%.*}
        patch=${rest#*.}
        case "$major:$minor:$patch" in
          *::*|*:|*.*|0[0-9]*:*|*:0[0-9]*:*|*:0[0-9]*) ;;
          *)
            if [ "$observed" != "$rest" ] && [ "$rest" != "$patch" ]; then
              version=$observed
              cli=incompatible
              [ "$observed" != "$qualified" ] || cli=compatible
            fi ;;
        esac ;;
    esac
  fi
fi
platform=unknown
if command -v uname >/dev/null 2>&1; then
  case "$(uname -s)" in Darwin) platform=macos ;; Linux) platform=linux ;; *) platform=other ;; esac
fi
printf '%s\n' "platform=$platform" 'shell=posix' "scope=$scope" "cli=$cli" "version=$version" "qualifiedVersion=$qualified" "compatibilityScope=$compatibility_scope"
for runtime in node npm bun; do
  state=missing
  if command -v "$runtime" >/dev/null 2>&1; then state=present; fi
  printf '%s=%s\n' "$runtime" "$state"
done
for item in workspaceConfig:skillset.yaml rootAgents:AGENTS.md rootClaude:CLAUDE.md rootSkill:SKILL.md; do
  state=absent
  [ ! -f "$root/${item#*:}" ] || state=present
  printf '%s=%s\n' "${item%%:*}" "$state"
done
for item in sourceDirectory:.skillset claudeDirectory:.claude codexDirectory:.codex cursorDirectory:.cursor agentsDirectory:.agents; do
  state=absent
  [ ! -d "$root/${item#*:}" ] || state=present
  printf '%s=%s\n' "${item%%:*}" "$state"
done
