import { describe, expect, test } from "bun:test";

import {
  checkOpenAiAgentPluginEvidence,
  OPENAI_AGENT_PLUGIN_EVIDENCE,
  OPENAI_AGENT_PLUGIN_EVIDENCE_TAG,
  type OpenAiAgentPluginEvidence,
} from "../openai-agent-plugin-evidence";

describe("SET-531 immutable OpenAI Agent Plugins evidence", () => {
  test("pins every released 0.154.0 parser-adjacent source surface", () => {
    expect(OPENAI_AGENT_PLUGIN_EVIDENCE_TAG).toBe(
      "36eab01061df3cde5f95ec20a526777b430091ba"
    );
    expect(OPENAI_AGENT_PLUGIN_EVIDENCE.map(({ id, path }) => ({ id, path }))).toEqual([
      { id: "parser", path: "codex-rs/core-plugins/src/manifest.rs" },
      { id: "adapter", path: "codex-rs/core-plugins/src/agent_plugin_manifest.rs" },
      { id: "marketplace", path: "codex-rs/core-plugins/src/marketplace.rs" },
      { id: "product", path: "codex-rs/protocol/src/protocol.rs" },
      { id: "hooks", path: "codex-rs/config/src/hook_config.rs" },
      { id: "app", path: "codex-rs/connectors/src/plugin_config.rs" },
    ]);
    expect(OPENAI_AGENT_PLUGIN_EVIDENCE.every(({ hash }) => hash.startsWith("sha256:"))).toBe(true);
  });

  test("reports immutable evidence drift without mutating an adopted pin", async () => {
    const evidence: readonly OpenAiAgentPluginEvidence[] = [
      {
        hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        id: "parser",
        path: "parser.rs",
      },
      {
        hash: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        id: "adapter",
        path: "missing.rs",
      },
    ];
    const report = await checkOpenAiAgentPluginEvidence(
      async (path) => (path === "parser.rs" ? "changed" : undefined),
      evidence
    );

    expect(report).toEqual([
      { id: "parser", status: "drifted" },
      { id: "adapter", status: "unavailable" },
    ]);
    expect(evidence[0]?.hash).toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });
});
