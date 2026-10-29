import { join } from "node:path";
import type { NativeHookFindingSource } from "@skillset/core/internal/adoption-native-findings";
import { isTargetName } from "@skillset/core/internal/targets";
import { selectorForPluginFeature } from "@skillset/core/internal/source-unit-selector";
import type { AdoptImportResult } from "./adopt";

export function adoptedHookFindingSources(imports: readonly AdoptImportResult[]): readonly NativeHookFindingSource[] {
  const sources = new Map<string, NativeHookFindingSource>();
  for (const imported of imports) {
    for (const result of imported.renderResults) {
      if (result.featureId !== "plugin-hooks" || result.sourcePath === undefined || !isTargetName(result.target)) continue;
      const unit = imported.units.find((unit) => unit.kind === "plugin" && result.sourceUnit === selectorForPluginFeature(unit.name, "hooks"));
      const prior = sources.get(result.sourcePath);
      const targets = [...new Set([...(prior?.targets ?? []), result.target])];
      sources.set(result.sourcePath, {
        path: result.sourcePath,
        targets,
        ...(unit === undefined ? {} : { originPath: join(unit.sourcePath, "hooks/hooks.json").replaceAll("\\", "/") }),
      });
    }
  }
  return [...sources.values()];
}
