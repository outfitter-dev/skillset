import { describe, expect, it } from "bun:test";

import {
  defaultTargetNames,
  defaultTargets,
  readCompileConfig,
  readCompileTargets,
  readOutputConfig,
  targetDescriptor,
  targetNames,
} from "../config";
import type { JsonRecord } from "../types";

describe("target vocabulary", () => {
  it("owns target-native project and generated-runtime conventions in one exhaustive descriptor", () => {
    expect(targetDescriptor("claude")).toEqual({
      displayLabel: "Claude",
      generatedSessionIdExpression: "${CLAUDE_SESSION_ID:-}",
      projectAgentExtension: "md",
      projectRoot: ".claude",
    });
    expect(targetDescriptor("codex")).toEqual({
      displayLabel: "Codex",
      generatedSessionIdExpression: "${CODEX_SESSION_ID:-}",
      projectAgentExtension: "toml",
      projectRoot: ".codex",
    });
    expect(targetDescriptor("cursor")).toEqual({
      displayLabel: "Cursor",
      generatedSessionIdExpression: "${CURSOR_SESSION_ID:-}",
      projectAgentExtension: "md",
      projectRoot: ".cursor",
    });
  });

  it("includes cursor in the default target plan while preserving explicit narrowing", () => {
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
    expect(defaultTargetNames()).toEqual(["claude", "codex", "cursor"]);
    expect(defaultTargets().cursor.enabled).toBe(true);
    expect(readCompileConfig({}, "skillset.yaml").targets).toEqual(["claude", "codex", "cursor"]);
    expect(readCompileConfig(record, "skillset.yaml").targets).toEqual(["cursor"]);

    const targets = readCompileTargets(record, "skillset.yaml");
    expect(targets.claude.enabled).toBe(false);
    expect(targets.codex.enabled).toBe(false);
    expect(targets.cursor.enabled).toBe(true);

    const outputs = readOutputConfig(record, {});
    expect(outputs.plugins.cursor).toBe("generated/cursor/plugins");
    expect(outputs.skills.cursor).toBe(".cursor/skills");
  });

  it("rejects standards selection instead of treating agents as a provider", () => {
    expect(readCompileConfig({}, "skillset.yaml")).not.toHaveProperty("agents");
    for (const agents of [true, false, {}, { instructions: false }]) {
      expect(() =>
        readCompileConfig({ compile: { agents } }, "skillset.yaml")
      ).toThrow("unsupported compile key agents");
    }
  });

  it("allows an explicit empty provider target selection without inventing a target", () => {
    const record: JsonRecord = { compile: { targets: [] } };

    expect(readCompileConfig(record, "skillset.yaml").targets).toEqual([]);
    expect(readCompileTargets(record, "skillset.yaml")).toEqual({
      claude: { enabled: false, options: {} },
      codex: { enabled: false, options: {} },
      cursor: { enabled: false, options: {} },
    });
  });
});
