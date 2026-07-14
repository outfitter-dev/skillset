import type { SkillsetOptions } from "@skillset/core/internal/types";

import { runDevWatch } from "./dev-watch";

export interface DevCommandRequest {
  readonly jsonlOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly write: boolean;
}

export async function runDevCommand({
  jsonlOutput,
  options,
  rootPath,
  write,
}: DevCommandRequest): Promise<void> {
  await runDevWatch(
    rootPath,
    options,
    process.stdout,
    write ? "write" : "preview",
    jsonlOutput ? "jsonl" : undefined
  );
}
