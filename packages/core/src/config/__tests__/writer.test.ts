import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigSchema } from "@skillset/types";
import { YAML } from "bun";
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

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "skillset-config-"));
    yamlPath = join(tempDir, "config.yaml");
    generatedPath = join(tempDir, "config.generated.json");
    const yaml = YAML.stringify(baseConfig, null, 2) ?? "";
    await Bun.write(yamlPath, yaml);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("setGeneratedValue stores hash and override", async () => {
    await setGeneratedValue(generatedPath, yamlPath, "output.max_lines", 300);

    const generated = await loadGeneratedConfig(generatedPath);
    expect(generated._yaml_hashes["output.max_lines"]).toBe(hashValue(500));
    expect(generated.output?.max_lines).toBe(300);
  });

  test("resetGeneratedValue removes hash and override", async () => {
    await setGeneratedValue(generatedPath, yamlPath, "output.max_lines", 250);
    await resetGeneratedValue(generatedPath, "output.max_lines");

    const generated = await loadGeneratedConfig(generatedPath);
    expect(generated._yaml_hashes["output.max_lines"]).toBeUndefined();
    expect(generated.output?.max_lines).toBeUndefined();
  });

  test("project overrides are stored under project id", async () => {
    const projectRoot = join(tempDir, "project");
    mkdirSync(projectRoot, { recursive: true });
    const projectYaml = join(projectRoot, "config.yaml");
    const yaml = YAML.stringify(baseConfig, null, 2) ?? "";
    await Bun.write(projectYaml, yaml);

    await setGeneratedValue(
      generatedPath,
      projectYaml,
      "skills.api",
      "project:api",
      projectRoot
    );

    const generated = await loadGeneratedConfig(generatedPath);
    const projectId = getProjectId(projectRoot);
    expect(generated.projects[projectId]?.skills?.api).toBe("project:api");
    expect(generated.projects[projectId]?._yaml_hashes["skills.api"]).toBe(
      hashValue(undefined)
    );
  });
});
