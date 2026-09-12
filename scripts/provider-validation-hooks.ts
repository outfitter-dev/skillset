import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { validateHookDefinition } from "../packages/core/src/hooks";
import { renderBuildGraph } from "../packages/core/src/render";
import { loadBuildGraph } from "../packages/core/src/resolver";
import type { JsonRecord } from "../packages/core/src/types";

export interface CursorHookConformanceInputs {
  readonly invalid: string;
  readonly valid: string;
}

export interface InternalAuthoringConformanceResult {
  readonly attribution: "Skillset internal";
  readonly diagnostic?: string;
  readonly id: "cursor-hooks-generated-native" | "cursor-hooks-malformed-flat";
  readonly result: "failed" | "passed";
  readonly surface: string;
  readonly target: "cursor";
}

export async function stageCursorHookConformanceInputs(
  validationTemp: string
): Promise<CursorHookConformanceInputs> {
  const source = join(validationTemp, "cursor-hook-source");
  await mkdir(join(source, ".skillset/plugins/hosted-hook/hooks"), {
    recursive: true,
  });
  await writeFile(
    join(source, "skillset.yaml"),
    "skillset:\n  name: hosted-hook-conformance\nclaude: false\ncodex: false\ncursor: true\n"
  );
  await writeFile(
    join(source, ".skillset/plugins/hosted-hook/skillset.yaml"),
    "skillset:\n  name: hosted-hook\nhooks:\n  WorkspaceOpen:\n    - hosted-check\n"
  );
  await writeFile(
    join(source, ".skillset/plugins/hosted-hook/hooks/hosted-check.json"),
    `${JSON.stringify({ events: ["WorkspaceOpen"], run: { command: "echo hosted-hook-conformance" } }, null, 2)}\n`
  );

  const rendered = await renderBuildGraph(await loadBuildGraph(source));
  const hookFile = rendered.find(
    ({ path }) => path === "plugins/hosted-hook/cursor/hooks/hooks.json"
  );
  if (hookFile === undefined) {
    throw new Error(
      "skillset: hosted Cursor hook conformance fixture did not render hooks/hooks.json"
    );
  }

  const root = join(validationTemp, "stage/cursor-hook-conformance");
  await mkdir(root, { recursive: true });
  const valid = join(root, "generated-native-hooks.json");
  await writeFile(valid, hookFile.content);

  const malformed = JSON.parse(
    new TextDecoder().decode(hookFile.content)
  ) as JsonRecord;
  const hooks = malformed.hooks as JsonRecord;
  const handlers = hooks.workspaceOpen as JsonRecord[];
  handlers[0] = { ...handlers[0], command: 42 };
  const invalid = join(root, "malformed-flat-handler.json");
  await writeFile(invalid, `${JSON.stringify(malformed, null, 2)}\n`);

  return { invalid, valid };
}

export async function validateCursorHookConformance(
  inputs: CursorHookConformanceInputs
): Promise<readonly InternalAuthoringConformanceResult[]> {
  const valid = await readJson(inputs.valid);
  const positive = runCheck(
    "cursor-hooks-generated-native",
    "generated version:1 flat native hook file",
    () =>
      validateHookDefinition(valid, {
        sourcePath: inputs.valid,
        target: "cursor",
      })
  );

  const invalid = await readJson(inputs.invalid);
  let negative: InternalAuthoringConformanceResult;
  try {
    validateHookDefinition(invalid, {
      sourcePath: inputs.invalid,
      target: "cursor",
    });
    negative = result(
      "cursor-hooks-malformed-flat",
      "malformed flat handler rejection canary",
      "failed",
      "Skillset accepted a Cursor handler with a non-string command field"
    );
  } catch (error) {
    const diagnostic = message(error);
    negative = diagnostic.includes("requires a string command field")
      ? result(
          "cursor-hooks-malformed-flat",
          "malformed flat handler rejection canary",
          "passed"
        )
      : result(
          "cursor-hooks-malformed-flat",
          "malformed flat handler rejection canary",
          "failed",
          `unexpected rejection: ${diagnostic}`
        );
  }

  return [positive, negative];
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
}

function runCheck(
  id: InternalAuthoringConformanceResult["id"],
  surface: string,
  check: () => void
): InternalAuthoringConformanceResult {
  try {
    check();
    return result(id, surface, "passed");
  } catch (error) {
    return result(id, surface, "failed", message(error));
  }
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
    target: "cursor",
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
