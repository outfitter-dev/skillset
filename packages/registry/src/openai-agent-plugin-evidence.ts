import { createHash } from "node:crypto";

/**
 * Immutable source evidence for the released OpenAI Agent Plugins consumer.
 *
 * This is deliberately separate from the `codex-authoring` validator lane:
 * that lane pins the release-notes validator script, while these records pin
 * the released parser and adjacent product contracts that govern ChatGPT
 * bundle projection. A drift report is informational; it never rewrites a
 * pin or claims that a newer upstream surface is covered.
 */
export const OPENAI_AGENT_PLUGIN_EVIDENCE_TAG =
  "36eab01061df3cde5f95ec20a526777b430091ba" as const;

export interface OpenAiAgentPluginEvidence {
  readonly hash: `sha256:${string}`;
  readonly id:
    | "adapter"
    | "app"
    | "hooks"
    | "marketplace"
    | "parser"
    | "product";
  readonly path: string;
}

export const OPENAI_AGENT_PLUGIN_EVIDENCE = [
  {
    hash: "sha256:1844eae543cfdc60e32f257ca2cb233e71c65c3f0b085871da1c8c930090a328",
    id: "parser",
    path: "codex-rs/core-plugins/src/manifest.rs",
  },
  {
    hash: "sha256:ba88408183b6d5e22ecbc751a1efa4f389bb7908df6232febb64927b7aa10749",
    id: "adapter",
    path: "codex-rs/core-plugins/src/agent_plugin_manifest.rs",
  },
  {
    hash: "sha256:eba7fed810eed705a2ff6bf73af2b7a879cabaca7807f5df36a73a01b6ff9795",
    id: "marketplace",
    path: "codex-rs/core-plugins/src/marketplace.rs",
  },
  {
    hash: "sha256:d11e4106083390591e326da783c03da942247adc50c1c0ffccd20f65af5522f2",
    id: "product",
    path: "codex-rs/protocol/src/protocol.rs",
  },
  {
    hash: "sha256:b7ac42b2a895a00b6aa491eee1d3eb04d8a147ba0e77e016bde42381e067d1c0",
    id: "hooks",
    path: "codex-rs/config/src/hook_config.rs",
  },
  {
    hash: "sha256:17a81c09378e846e035a5171ca1aa432686ad645dd34bda2fb0a25f23fda4537",
    id: "app",
    path: "codex-rs/connectors/src/plugin_config.rs",
  },
] as const satisfies readonly OpenAiAgentPluginEvidence[];

export interface OpenAiAgentPluginEvidenceCheck {
  readonly id: OpenAiAgentPluginEvidence["id"];
  readonly status: "drifted" | "matched" | "unavailable";
}

/** A read-only report: callers decide separately whether a drift blocks release. */
export async function checkOpenAiAgentPluginEvidence(
  read: (path: string) => Promise<string | undefined>,
  evidence: readonly OpenAiAgentPluginEvidence[] = OPENAI_AGENT_PLUGIN_EVIDENCE
): Promise<readonly OpenAiAgentPluginEvidenceCheck[]> {
  return Promise.all(
    evidence.map(async ({ hash, id, path }) => {
      const body = await read(path);
      if (body === undefined) return { id, status: "unavailable" };
      const observed = `sha256:${createHash("sha256").update(body).digest("hex")}`;
      return { id, status: observed === hash ? "matched" : "drifted" };
    })
  );
}
