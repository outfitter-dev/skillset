import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { checkProviderFormatConformance } from "../packages/core/src/provider-format-conformance";
import type { InternalAuthoringConformanceResult } from "./provider-validation-hooks";

export async function validateChatGptPluginConformance(
  roots: readonly string[]
): Promise<readonly InternalAuthoringConformanceResult[]> {
  return Promise.all(
    roots.map(async (root) => {
      const path = join(root, "plugin.json");
      const report = checkProviderFormatConformance([
        {
          content: await readFile(path),
          featureId: "plugin-manifests",
          path,
          target: "codex",
        },
      ]);
      return {
        attribution: "Skillset internal" as const,
        ...(report.ok
          ? {}
          : {
              diagnostic: report.issues
                .map((issue) => `${issue.outputPath}: ${issue.message}`)
                .join("; "),
            }),
        id: "chatgpt-plugin-generated-manifest" as const,
        result: report.ok ? ("passed" as const) : ("failed" as const),
        surface: path,
        target: "codex" as const,
      };
    })
  );
}
