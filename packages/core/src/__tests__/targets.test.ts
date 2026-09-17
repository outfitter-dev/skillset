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
        skills: { include: ["review"] },
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
    expect(outputs.targetOutputs.cursor.skills).toEqual(["review"]);
  });

  it("uses fixed provider skill roots while preserving participation and selection", () => {
    const outputs = readOutputConfig(
      {
        claude: { skills: false },
        codex: { skills: ["review"] },
        cursor: { skills: { enabled: true, include: ["review", "write"] } },
      },
      {}
    );

    expect(outputs.skills).toEqual({
      claude: ".claude/skills",
      codex: ".agents/skills",
      cursor: ".cursor/skills",
    });
    expect(outputs.targetOutputs).toMatchObject({
      claude: { skills: false },
      codex: { skills: ["review"] },
      cursor: { skills: ["review", "write"] },
    });

    for (const target of targetNames()) {
      expect(() =>
        readOutputConfig({ [target]: { skills: { path: `generated/${target}/skills` } } }, {})
      ).toThrow(`${target}.skills.path`);
      expect(() =>
        readOutputConfig(
          { [target]: { enabled: false, skills: { path: `generated/${target}/skills` } } },
          {}
        )
      ).toThrow(`${target}.skills.path`);
      expect(() =>
        readOutputConfig({}, { outputs: { skills: { [target]: `generated/${target}/skills` } } })
      ).toThrow(`skillset.outputs.skills.${target}`);
    }
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
