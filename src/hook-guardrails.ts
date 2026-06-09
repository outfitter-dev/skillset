import type { TargetName } from "./types";

export type HookPrintSubcommand = "print";
export type HookRunner = "git" | "husky" | "lefthook" | "pre-commit";

export interface HookPrintOptions {
  readonly agentRuntime: boolean;
  readonly preCommit: boolean;
  readonly prePush: boolean;
  readonly runner?: HookRunner;
  readonly target?: TargetName;
}

const PRE_COMMIT_COMMAND = "skillset change check --staged";
const PRE_PUSH_COMMAND = "skillset change check --since origin/main && skillset check && skillset doctor";

export function renderHookPrint(options: HookPrintOptions): string {
  validateHookPrintOptions(options);
  if (options.agentRuntime) return renderAgentRuntimeSnippet(options.target);
  if (options.runner === undefined) throw new Error("skillset: hooks print requires --runner or --agent-runtime");
  const preCommit = options.preCommit || (!options.preCommit && !options.prePush);
  const prePush = options.prePush || (!options.preCommit && !options.prePush);
  return `${renderRunnerSnippet(options.runner, { preCommit, prePush }).trimEnd()}\n`;
}

function validateHookPrintOptions(options: HookPrintOptions): void {
  if (options.agentRuntime && options.runner !== undefined) {
    throw new Error("skillset: hooks print --agent-runtime cannot be combined with --runner");
  }
  if (options.agentRuntime) {
    if (options.target === undefined) throw new Error("skillset: hooks print --agent-runtime requires --target claude or --target codex");
    if (options.preCommit || options.prePush) {
      throw new Error("skillset: hooks print --agent-runtime cannot be combined with --pre-commit or --pre-push");
    }
    return;
  }
  if (options.target !== undefined) {
    throw new Error("skillset: hooks print --target is only supported with --agent-runtime");
  }
  if (options.runner === undefined) return;
}

function renderRunnerSnippet(
  runner: HookRunner,
  options: { readonly preCommit: boolean; readonly prePush: boolean }
): string {
  if (runner === "lefthook") return renderLefthookSnippet(options);
  if (runner === "husky") return renderHuskySnippet(options);
  if (runner === "pre-commit") return renderPreCommitSnippet(options);
  return renderGitSnippet(options);
}

function renderLefthookSnippet(options: { readonly preCommit: boolean; readonly prePush: boolean }): string {
  const lines = ["# Add to lefthook.yml"];
  if (options.preCommit) {
    lines.push(
      "pre-commit:",
      "  commands:",
      "    skillset-change-check:",
      `      run: ${PRE_COMMIT_COMMAND}`
    );
  }
  if (options.prePush) {
    if (options.preCommit) lines.push("");
    lines.push(
      "pre-push:",
      "  commands:",
      "    skillset-pre-push:",
      `      run: ${PRE_PUSH_COMMAND}`
    );
  }
  return lines.join("\n");
}

function renderHuskySnippet(options: { readonly preCommit: boolean; readonly prePush: boolean }): string {
  const sections: string[] = [];
  if (options.preCommit) {
    sections.push([
      "# .husky/pre-commit",
      "#!/bin/sh",
      ". \"$(dirname \"$0\")/_/husky.sh\" 2>/dev/null || true",
      PRE_COMMIT_COMMAND,
    ].join("\n"));
  }
  if (options.prePush) {
    sections.push([
      "# .husky/pre-push",
      "#!/bin/sh",
      ". \"$(dirname \"$0\")/_/husky.sh\" 2>/dev/null || true",
      PRE_PUSH_COMMAND,
    ].join("\n"));
  }
  return sections.join("\n\n");
}

function renderPreCommitSnippet(options: { readonly preCommit: boolean; readonly prePush: boolean }): string {
  const lines = [
    "# Add to .pre-commit-config.yaml",
    "repos:",
    "  - repo: local",
    "    hooks:",
  ];
  if (options.preCommit) {
    lines.push(
      "      - id: skillset-change-check",
      "        name: skillset change check",
      `        entry: ${PRE_COMMIT_COMMAND}`,
      "        language: system",
      "        pass_filenames: false",
      "        stages: [pre-commit]"
    );
  }
  if (options.prePush) {
    lines.push(
      "      - id: skillset-pre-push",
      "        name: skillset pre-push checks",
      `        entry: sh -c '${PRE_PUSH_COMMAND}'`,
      "        language: system",
      "        pass_filenames: false",
      "        stages: [pre-push]"
    );
  }
  return lines.join("\n");
}

function renderGitSnippet(options: { readonly preCommit: boolean; readonly prePush: boolean }): string {
  const sections: string[] = [];
  if (options.preCommit) {
    sections.push([
      "# .git/hooks/pre-commit",
      "#!/bin/sh",
      "set -eu",
      PRE_COMMIT_COMMAND,
    ].join("\n"));
  }
  if (options.prePush) {
    sections.push([
      "# .git/hooks/pre-push",
      "#!/bin/sh",
      "set -eu",
      PRE_PUSH_COMMAND,
    ].join("\n"));
  }
  return sections.join("\n\n");
}

function renderAgentRuntimeSnippet(target: TargetName | undefined): string {
  if (target === undefined) throw new Error("skillset: hooks print --agent-runtime requires --target");
  const command = "skillset change check --root . && skillset change status --root .";
  const note =
    "Generated suggestion only. Review before adding to project-local runtime config; Skillset does not install or trust hooks.";
  const value = {
    hooks: {
      PostToolUse: [
        {
          matcher: "Write|Edit|MultiEdit|apply_patch",
          hooks: [
            {
              type: "command",
              command: "git diff --name-only -- .skillset | grep -q . && skillset change status --root . || true",
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command,
            },
          ],
        },
      ],
    },
  };
  const path = target === "claude" ? ".claude/settings.local.json" : ".codex/hooks/hooks.json";
  return [
    `# ${target} agent runtime hook snippet`,
    `# Suggested destination: ${path}`,
    `# ${note}`,
    JSON.stringify(value, null, 2),
    "",
  ].join("\n");
}
