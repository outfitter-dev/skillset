import { describe, expect, test } from "bun:test";

import {
  CLI_EVENT_SCHEMA_VERSION,
  CLI_RESULT_SCHEMA_VERSION,
  cliEventContract,
  cliResultContract,
  deriveSkillsetJsonSchemaArtifacts,
  validateCliEvent,
  validateCliResult,
} from "../index";

describe("SET-286 CLI structured-output contracts", () => {
  test("exports separate finite result and event schemas", () => {
    expect(CLI_RESULT_SCHEMA_VERSION).toBe("skillset.cli.result@1");
    expect(CLI_EVENT_SCHEMA_VERSION).toBe("skillset.cli.event@1");
    expect(cliResultContract.schema).toMatchObject({
      additionalProperties: false,
      required: [
        "changes",
        "command",
        "data",
        "diagnostics",
        "exitCode",
        "kind",
        "meta",
        "ok",
        "schemaVersion",
      ],
    });
    expect(cliEventContract.schema).toMatchObject({
      additionalProperties: false,
      required: ["command", "data", "event", "schemaVersion", "sequence"],
    });
  });

  test("generates standalone CLI schema artifacts without adding them to the source union", () => {
    const artifacts = deriveSkillsetJsonSchemaArtifacts();
    expect(artifacts.map((artifact) => artifact.path)).toContain(
      "docs/reference/schemas/0.1.0/cli-result.schema.json"
    );
    expect(artifacts.map((artifact) => artifact.path)).toContain(
      "docs/reference/schemas/0.1.0/cli-event.schema.json"
    );
    const combined = artifacts.find(
      (artifact) => artifact.contractId === "skillset"
    )?.schema;
    expect(combined?.oneOf).not.toContainEqual({ $ref: "#/$defs/cli-result" });
    expect(combined?.oneOf).not.toContainEqual({ $ref: "#/$defs/cli-event" });
  });

  test("validates finite results and rejects inconsistent success state", () => {
    const valid = {
      changes: [],
      command: "check",
      data: {},
      diagnostics: [],
      exitCode: 0,
      kind: "diagnostics",
      meta: {
        schema:
          "https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/cli-result.schema.json",
      },
      ok: true,
      schemaVersion: CLI_RESULT_SCHEMA_VERSION,
    };
    expect(validateCliResult(valid)).toEqual({ diagnostics: [], ok: true });
    expect(validateCliResult({ ...valid, exitCode: 1 })).toMatchObject({
      ok: false,
    });
    expect(validateCliResult({ ...valid, command: "" })).toMatchObject({
      ok: false,
    });
  });

  test("validates sequenced CLI events", () => {
    const valid = {
      command: "dev",
      data: {},
      event: "started",
      schemaVersion: CLI_EVENT_SCHEMA_VERSION,
      sequence: 1,
    };
    expect(validateCliEvent(valid)).toEqual({ diagnostics: [], ok: true });
    expect(validateCliEvent({ ...valid, sequence: 0 })).toMatchObject({
      ok: false,
    });
  });
});
