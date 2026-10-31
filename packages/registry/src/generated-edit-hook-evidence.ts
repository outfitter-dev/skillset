/** Documented hook wire inputs only; these facts do not establish installation or runtime activation. */
export interface GeneratedEditHookProtocol {
  readonly inputKind: "absolute-file-path" | "apply-patch-command";
  readonly matcher: string;
  readonly sources: readonly string[];
  readonly toolNames: readonly string[];
  readonly verifiedAt: string;
}

const protocols: Readonly<Record<string, GeneratedEditHookProtocol>> = {
  claude: {
    inputKind: "absolute-file-path",
    matcher: "^(Edit|Write)$",
    sources: ["https://code.claude.com/docs/en/hooks#pretooluse-input", "https://code.claude.com/docs/en/hooks#pretooluse-decision-control"],
    toolNames: ["Edit", "Write"],
    verifiedAt: "2026-10-31",
  },
  codex: {
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
