import { relative } from "node:path";
import { OPENAI_MARKETPLACE_PATH_RULES } from "@skillset/registry";
import { readRecord } from "./config";
import { getSkillsetFeature } from "./feature-registry";
import { chatGptMarketplacePath } from "./plugin-output";
import { defineRenderResult, type SkillsetRenderResult } from "./render-result";
import { selectorForPluginConfig, selectorForRootConfig } from "./source-unit-selector";
import type { BuildGraph, JsonRecord, MarketplacePluginEntryConfig, SourcePlugin } from "./types";

/** Capture omission evidence from the same effective interface that produced the catalog bytes. */
export function marketplaceAssetLossResults(args: {
  readonly graph: BuildGraph;
  readonly entry: MarketplacePluginEntryConfig;
  readonly plugin: SourcePlugin | undefined;
  readonly effectiveInterface: JsonRecord;
  readonly listingInterface: JsonRecord;
}): readonly SkillsetRenderResult[] {
  const { graph, entry, plugin } = args;
  const path = chatGptMarketplacePath();
  const configured = readRecord((entry.codex ?? {}) as unknown as JsonRecord, "interface") ?? {};
  const omitted = OPENAI_MARKETPLACE_PATH_RULES.assetFields.filter((field) => {
    const value = args.effectiveInterface[field];
    return args.listingInterface[field] === undefined &&
      (typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0);
  });
  const results: SkillsetRenderResult[] = [];
  for (const origin of ["configured", "inherited"] as const) {
    const fields = omitted.filter((field) => (configured[field] !== undefined) === (origin === "configured"));
    if (fields.length === 0) continue;
    const sourcePath = origin === "inherited" && plugin !== undefined
      ? relative(graph.rootPath, plugin.path).replaceAll("\\", "/")
      : relative(graph.rootPath, graph.rootConfigPath).replaceAll("\\", "/");
    const reason = `ChatGPT marketplace entry ${entry.id} omits remote interface assets: ${fields.join(", ")}; remote package assets are not materialized in the catalog. Use a local materialized entry or explicitly accept the recorded loss.`;
    results.push(defineRenderResult({
      destination: "marketplace",
      evidence: [
        ...(getSkillsetFeature("marketplaces")?.targetSupport.codex.evidence ?? []),
        { kind: "source", ref: "packages/core/src/marketplace-asset-loss.ts" },
        { kind: "test", ref: "packages/core/src/__tests__/marketplace-asset-loss.test.ts" },
      ],
      featureId: "marketplaces",
      sourcePath,
      sourceUnit: origin === "inherited" && plugin !== undefined ? selectorForPluginConfig(plugin.id) : selectorForRootConfig(),
      target: "codex",
      status: "lossy",
      reason,
      outputs: [{ kind: "marketplace", path }],
      diagnostics: [{ code: "render/codex-marketplace-assets-omitted", path: sourcePath, message: reason }],
    }));
  }
  return results;
}
