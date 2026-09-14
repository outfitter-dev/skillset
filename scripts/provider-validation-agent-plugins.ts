import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { validateAgentPluginManifest } from "../packages/core/src/render-agent-plugins-standard";
import type { JsonRecord } from "../packages/core/src/types";
import type { InternalAuthoringConformanceResult } from "./provider-validation-hooks";

export async function validateAgentPluginConformance(
  packageRoots: readonly string[]
): Promise<readonly InternalAuthoringConformanceResult[]> {
  const diagnostics: string[] = [];
  let sample: JsonRecord | undefined;
  for (const root of packageRoots) {
    try {
      const value = parseRecord(
        JSON.parse(await readFile(join(root, "plugin.json"), "utf8"))
      );
      validateAgentPluginManifest(value);
      sample ??= value;
    } catch (error) {
      diagnostics.push(`${root}: ${message(error)}`);
    }
  }

  const positive = result(
    "agent-plugins-generated-native",
    `${packageRoots.length} generated plugin.json ${packageRoots.length === 1 ? "file" : "files"}`,
    diagnostics.length === 0 ? "passed" : "failed",
    diagnostics.length === 0 ? undefined : diagnostics.join("; ")
  );
  if (sample === undefined) {
    return [
      positive,
      result(
        "agent-plugins-unknown-field",
        "unknown top-level field rejection canary",
        "failed",
        "no valid generated Agent Plugins manifest was available for the canary"
      ),
    ];
  }

  try {
    validateAgentPluginManifest({ ...sample, skillsetInvalidCanary: true });
    return [
      positive,
      result(
        "agent-plugins-unknown-field",
        "unknown top-level field rejection canary",
        "failed",
        "Skillset accepted an unknown Agent Plugins manifest field"
      ),
    ];
  } catch (error) {
    const diagnostic = message(error);
    return [
      positive,
      diagnostic.includes("unknown field skillsetInvalidCanary")
        ? result(
            "agent-plugins-unknown-field",
            "unknown top-level field rejection canary",
            "passed"
          )
        : result(
            "agent-plugins-unknown-field",
            "unknown top-level field rejection canary",
            "failed",
            `unexpected rejection: ${diagnostic}`
          ),
    ];
  }
}

function parseRecord(value: unknown): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Plugins plugin.json must be an object");
  }
  return value as JsonRecord;
}

function result(
  id: InternalAuthoringConformanceResult["id"],
  surface: string,
  status: InternalAuthoringConformanceResult["result"],
  diagnostic?: string
): InternalAuthoringConformanceResult {
  return {
    ...(diagnostic === undefined ? {} : { diagnostic }),
    attribution: "Skillset internal",
    id,
    result: status,
    surface,
    target: "agent-plugins-1.0",
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
