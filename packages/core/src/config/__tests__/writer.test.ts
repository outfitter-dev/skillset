import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigSchema } from "@skillset/types";
import { dump as dumpYaml } from "js-yaml";
import { hashValue } from "../hash";
import { loadGeneratedConfig } from "../loader";
import { getProjectId } from "../project";
import { resetGeneratedValue, setGeneratedValue } from "../writer";

const baseConfig: ConfigSchema = {
  version: 1,
  rules: { unresolved: "warn", ambiguous: "warn" },
  output: { max_lines: 500, include_layout: false },
  resolution: {
    fuzzy_matching: true,
    default_scope_priority: ["project", "user", "plugin"],
  },
  skills: {},
  sets: {},
};

describe("config writer", () => {
  let tempDir: string;
  let yamlPath: string;
  let generatedPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "skillset-config-"));
    yamlPath = join(tempDir, "config.yaml");
    generatedPath = join(tempDir, "config.generated.json");
    writeFileSync(yamlPath, dumpYaml(baseConfig, { noRefs: true }), "utf8");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("setGeneratedValue stores hash and override", async () => {
    await setGeneratedValue(generatedPath, yamlPath, "output.max_lines", 300);

    const generated = loadGeneratedConfig(generatedPath);
    expect(generated._yaml_hashes["output.max_lines"]).toBe(hashValue(500));
    expect(generated.output?.max_lines).toBe(300);
  });

  test("resetGeneratedValue removes hash and override", async () => {
    await setGeneratedValue(generatedPath, yamlPath, "output.max_lines", 250);
    await resetGeneratedValue(generatedPath, "output.max_lines");

    const generated = loadGeneratedConfig(generatedPath);
    expect(generated._yaml_hashes["output.max_lines"]).toBeUndefined();
    expect(generated.output?.max_lines).toBeUndefined();
  });

  test("project overrides are stored under project id", async () => {
    const projectRoot = join(tempDir, "project");
    mkdirSync(projectRoot, { recursive: true });
    const projectYaml = join(projectRoot, "config.yaml");
    writeFileSync(projectYaml, dumpYaml(baseConfig, { noRefs: true }), "utf8");

    await setGeneratedValue(
      generatedPath,
      projectYaml,
      "skills.api",
      "project:api",
      projectRoot
    );

    const generated = loadGeneratedConfig(generatedPath);
    const projectId = getProjectId(projectRoot);
    expect(generated.projects[projectId]?.skills?.api).toBe("project:api");
    expect(generated.projects[projectId]?._yaml_hashes["skills.api"]).toBe(
      hashValue(undefined)
    );
  });
});
