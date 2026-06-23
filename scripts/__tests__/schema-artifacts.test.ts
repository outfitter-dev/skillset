import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseYamlRecord } from "../../packages/core/src/yaml";
import { SKILLSET_SCHEMA_VERSION, skillsetSchemaContracts, skillsetSchemaExamples } from "../../packages/schema/src";
import type { SchemaJsonRecord } from "../../packages/schema/src";
import { buildSchemaArtifacts, findUnexpectedGeneratedArtifactPaths, validateAgainstSchema } from "../schema-artifacts";

import { expect, test } from "bun:test";

test("SET-182: schema artifacts are generated deterministically from contracts", () => {
  const artifacts = buildSchemaArtifacts();
  const paths = artifacts.map((artifact) => artifact.path);

  expect(paths).toContain(join("docs", "reference", "schemas", SKILLSET_SCHEMA_VERSION, "workspace-config.schema.json"));
  expect(paths).toContain(join("docs", "reference", "schemas", SKILLSET_SCHEMA_VERSION, "skillset.schema.json"));
  expect(paths).toContain(join("docs", "reference", "examples", "workspace-config.yaml"));
  expect(paths).toContain(join("docs", "reference", "schemas", "README.md"));

  const workspaceSchema = artifacts.find((artifact) => artifact.path.endsWith("workspace-config.schema.json"));
  expect(workspaceSchema?.content).toBe(`${JSON.stringify(skillsetSchemaContracts.find((contract) => contract.id === "workspace-config")?.schema, null, 2)}\n`);
});

test("SET-182: generated example files validate against generated schemas", async () => {
  for (const example of skillsetSchemaExamples) {
    const schemaPath = join("docs", "reference", "schemas", SKILLSET_SCHEMA_VERSION, `${example.id}.schema.json`);
    const examplePath = join("docs", "reference", "examples", example.path);
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as SchemaJsonRecord;
    const parsed = parseYamlRecord(await readFile(examplePath, "utf8"), examplePath);

    expect(validateAgainstSchema(parsed, schema)).toEqual([]);
  }
});

test("SET-182: generated workspace examples use the language-server schema comment", async () => {
  const workspace = await readFile(join("docs", "reference", "examples", "workspace-config.yaml"), "utf8");
  expect(workspace.startsWith("# yaml-language-server: $schema=https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/workspace-config.schema.json\n")).toBe(true);
});

test("SET-182: schema freshness rejects stale generated artifacts", () => {
  const artifacts = buildSchemaArtifacts();
  const paths = artifacts.map((artifact) => artifact.path);

  expect(findUnexpectedGeneratedArtifactPaths(artifacts, paths)).toEqual([]);
  expect(findUnexpectedGeneratedArtifactPaths(artifacts, [
    ...paths,
    join("docs", "reference", "examples", "retired.yaml"),
    join("docs", "reference", "schemas", "0.1.0", "retired.schema.json"),
  ])).toEqual([
    join("docs", "reference", "examples", "retired.yaml"),
    join("docs", "reference", "schemas", "0.1.0", "retired.schema.json"),
  ]);
});
