import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseYamlRecord } from "../../packages/core/src/yaml";
import {
  reportContract,
  SKILLSET_SCHEMA_VERSION,
  skillsetSchemaContracts,
  skillsetSchemaExamples,
  validateSkillsetReport,
} from "../../packages/schema/src";
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
    const content = await readFile(examplePath, "utf8");
    const parsed = example.format === "json"
      ? JSON.parse(content)
      : parseYamlRecord(content, examplePath);

    expect(validateAgainstSchema(parsed, schema)).toEqual([]);
  }
});

test("SET-445: report artifacts enforce discriminants, bounds, and pipeline state", () => {
  const example = skillsetSchemaExamples.find((candidate) => candidate.id === "report")?.value;
  if (example === undefined) throw new Error("missing report example");
  expect(validateAgainstSchema(example, reportContract.schema)).toEqual([]);

  const invalidKind = structuredClone(example);
  (invalidKind as Record<string, unknown>).kind = "import";
  expect(validateAgainstSchema(invalidKind, reportContract.schema)).not.toEqual([]);

  const invalidCommand = structuredClone(example);
  (invalidCommand.result as Record<string, unknown>).command = "import";
  expect(validateAgainstSchema(invalidCommand, reportContract.schema)).not.toEqual([]);

  const invalidExitCode = structuredClone(example);
  (invalidExitCode.result as Record<string, unknown>).exitCode = 99;
  (invalidExitCode.result as Record<string, unknown>).ok = false;
  expect(validateAgainstSchema(invalidExitCode, reportContract.schema)).not.toEqual([]);

  const invalidBounds = structuredClone(example);
  (invalidBounds.workspace as Record<string, unknown>).name = "x".repeat(161);
  const invalidBoundsPayload = invalidBounds.payload as Record<string, unknown>;
  (invalidBoundsPayload.fixture as Record<string, unknown>).targets = [];
  (invalidBoundsPayload.fixture as Record<string, unknown>).manifestEntryCount = -1;
  invalidBoundsPayload.evidence = Array.from({ length: 41 }, (_, index) => ({
    available: false,
    id: `evidence-${index}`,
  }));
  expect(validateAgainstSchema(invalidBounds, reportContract.schema)).not.toEqual([]);

  const duplicateTargets = structuredClone(example);
  ((duplicateTargets.payload as Record<string, unknown>).fixture as Record<string, unknown>).targets = [
    "claude",
    "claude",
  ];
  expect(validateAgainstSchema(duplicateTargets, reportContract.schema)).not.toEqual([]);

  const invalidPipeline = structuredClone(example);
  (invalidPipeline.payload as Record<string, unknown>).pipelinePassed = false;
  expect(validateAgainstSchema(invalidPipeline, reportContract.schema)).not.toEqual([]);

  for (const id of [
    "C:private/path",
    "file:Users/private/path",
    "http:github.com/example/private",
    "https:github.com/example/private",
    "instructions:../AGENTS.md",
    "instructions:file:AGENTS.md",
    "plugins:./private",
    "plugins:/private",
    "ssh:host/private",
  ]) {
    const invalidIdentity = structuredClone(example);
    const payload = invalidIdentity.payload as Record<string, unknown>;
    const evidence = payload.evidence as Record<string, unknown>[];
    (evidence[0] as Record<string, unknown>).id = id;
    expect(validateAgainstSchema(invalidIdentity, reportContract.schema)).not.toEqual([]);
  }

  for (const id of [
    "plugin:.",
    "plugin:plugins/review",
    "instructions:AGENTS.md",
    "plugins:.claude/plugins",
    "skills:.agents/skills",
    "skill:review",
    ".agents/skills/review",
  ]) {
    const validIdentity = structuredClone(example);
    const payload = validIdentity.payload as Record<string, unknown>;
    const evidence = payload.evidence as Record<string, unknown>[];
    (evidence[0] as Record<string, unknown>).id = id;
    expect(validateAgainstSchema(validIdentity, reportContract.schema)).toEqual([]);
  }
});

test("SET-445: external fixture repository identity has runtime and schema parity", () => {
  const example = skillsetSchemaExamples.find((candidate) => candidate.id === "report")?.value;
  if (example === undefined) throw new Error("missing report example");
  const invalidIdentity = structuredClone(example);
  const payload = invalidIdentity.payload as Record<string, unknown>;
  const fixture = payload.fixture as Record<string, unknown>;
  fixture.repository = "home/alice/private-repo";

  expect(validateSkillsetReport(invalidIdentity).ok).toBe(false);
  expect(validateAgainstSchema(invalidIdentity, reportContract.schema)).not.toEqual([]);
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
