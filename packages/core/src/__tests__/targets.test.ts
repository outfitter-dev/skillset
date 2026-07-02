import { describe, expect, it } from "bun:test";

import {
  defaultTargetNames,
  defaultTargets,
  readCompileConfig,
  readCompileTargets,
  readOutputConfig,
  targetNames,
} from "../config";
import type { JsonRecord } from "../types";

describe("target vocabulary", () => {
  it("accepts cursor as an explicit target without changing the default target plan", () => {
    const record: JsonRecord = {
      compile: {
        targets: ["cursor"],
      },
      cursor: {
        plugins: { path: "generated/cursor/plugins" },
        skills: { path: ".cursor/skills" },
      },
    };

    expect(targetNames()).toEqual(["claude", "codex", "cursor"]);
    expect(defaultTargetNames()).toEqual(["claude", "codex"]);
    expect(defaultTargets().cursor.enabled).toBe(false);
    expect(readCompileConfig({}, "skillset.yaml").targets).toEqual(["claude", "codex"]);
    expect(readCompileConfig(record, "skillset.yaml").targets).toEqual(["cursor"]);

    const targets = readCompileTargets(record, "skillset.yaml");
    expect(targets.claude.enabled).toBe(false);
    expect(targets.codex.enabled).toBe(false);
    expect(targets.cursor.enabled).toBe(true);

    const outputs = readOutputConfig(record, {});
    expect(outputs.plugins.cursor).toBe("generated/cursor/plugins");
    expect(outputs.skills.cursor).toBe(".cursor/skills");
  });
});
