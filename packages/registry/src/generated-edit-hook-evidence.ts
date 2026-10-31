/** Documented hook wire inputs only; these facts do not establish installation or runtime activation. */
export interface GeneratedEditHookProtocol {
  readonly configuration: {
    readonly projectPath: string;
    readonly userDirectory: string;
    readonly userFile: string;
    readonly homeVariable: string;
    readonly trust: string;
  };
  readonly inputKind: "absolute-file-path" | "apply-patch-command";
  readonly matcher: string;
  readonly sources: readonly string[];
  readonly toolNames: readonly string[];
  readonly verifiedAt: string;
}

const protocols: Readonly<Record<string, GeneratedEditHookProtocol>> = {
  claude: {
    configuration: { projectPath: ".claude/settings.local.json", userDirectory: ".claude", userFile: "settings.json", homeVariable: "CLAUDE_CONFIG_DIR", trust: "Review the hook in Claude Code and start a new session; setup does not grant trust." },
    inputKind: "absolute-file-path",
    matcher: "^(Edit|Write)$",
    sources: ["https://code.claude.com/docs/en/settings", "https://code.claude.com/docs/en/env-vars", "https://code.claude.com/docs/en/hooks#pretooluse-input", "https://code.claude.com/docs/en/hooks#pretooluse-decision-control"],
    toolNames: ["Edit", "Write"],
    verifiedAt: "2026-10-31",
  },
  codex: {
    configuration: { projectPath: ".codex/hooks.json", userDirectory: ".codex", userFile: "hooks.json", homeVariable: "CODEX_HOME", trust: "Codex requires project configuration trust and separate hook trust. Review both in Codex; setup does not grant trust." },
    inputKind: "apply-patch-command",
    matcher: "^apply_patch$",
    sources: [
      "https://learn.chatgpt.com/docs/hooks",
      "https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/parser.rs",
      "https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/streaming_parser.rs",
    ],
    toolNames: ["apply_patch"],
    verifiedAt: "2026-10-31",
  },
};

export function getGeneratedEditHookProtocol(provider: string | undefined): GeneratedEditHookProtocol | undefined {
  return provider !== undefined && Object.hasOwn(protocols, provider) ? protocols[provider] : undefined;
}
