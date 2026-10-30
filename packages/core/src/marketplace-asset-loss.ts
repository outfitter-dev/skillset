import { relative } from "node:path";
import { OPENAI_MARKETPLACE_PATH_RULES } from "@skillset/registry";
import { mergeRecords, readRecord, readString } from "./config";
import { getSkillsetFeature } from "./feature-registry";
import { chatGptMarketplacePath } from "./plugin-output";
import { renderEffectiveOpenAiInterface } from "./render-plugin-manifest";
import { defineRenderResult, type SkillsetRenderResult } from "./render-result";
import { selectorForPluginConfig, selectorForRootConfig } from "./source-unit-selector";
import type { BuildGraph, JsonRecord, RenderedFile } from "./types";
import { isJsonRecord } from "./yaml";

/** Account for assets omitted from entries actually present in the native catalog. */
export function marketplaceAssetLossResults(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: (path: string) => string
): readonly SkillsetRenderResult[] {
  const path = chatGptMarketplacePath();
  const file = rendered.find((item) => item.path === path);
  if (file === undefined) return [];
  const document = JSON.parse(new TextDecoder().decode(file.content)) as JsonRecord;
  const catalogName = readString(document, "name");
  const catalog = catalogName === undefined ? undefined : graph.root.marketplaces[catalogName];
  // Implicit catalogs contain only local packages and cannot incur this loss.
  if (catalog === undefined || !Array.isArray(document.plugins)) return [];
  const included = includedPaths.has(path);
  const results: SkillsetRenderResult[] = [];
  for (const output of document.plugins) {
    if (!isJsonRecord(output) || readRecord(output, "source")?.source === "local") continue;
    const entry = catalog.plugins.find((item) => item.id === output.name && (item.targets ?? catalog.targets).includes("codex"));
    if (entry === undefined) continue;
    const plugin = graph.plugins.find((item) => item.id === entry.plugin);
    const configured = readRecord((entry.codex ?? {}) as unknown as JsonRecord, "interface") ?? {};
    const inherited = plugin === undefined ? {} : renderEffectiveOpenAiInterface(graph, plugin);
    // These asset fields are unaffected by catalog homepage/category/name defaults.
    // Use the manifest's shared effective-interface owner, including native overrides.
    const effective = mergeRecords(inherited, configured);
    const actual = readRecord(output, "interface") ?? {};
    const omitted = OPENAI_MARKETPLACE_PATH_RULES.assetFields.filter((field) => {
      const value = effective[field];
      return actual[field] === undefined &&
        (typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0);
    });
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
        status: included ? "lossy" : "intentionally_skipped",
        reason: included ? reason : `marketplace entry ${entry.id} excluded by build scope`,
        ...(included ? {
          outputs: [{ kind: "marketplace", path: mapOutputPath(path) }],
          diagnostics: [{ code: "render/codex-marketplace-assets-omitted", path: sourcePath, message: reason }],
        } : { policy: "scope:excluded" as const }),
      }));
    }
  }
  return results;
}
