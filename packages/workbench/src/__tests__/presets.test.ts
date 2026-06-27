import { describe, expect, test } from "bun:test";

import {
  createWorkbenchDiagnostic,
  getWorkbenchPreset,
  isWorkbenchPresetId,
  isWorkbenchScope,
  listWorkbenchPresets,
  parseWorkbenchPresetId,
  parseWorkbenchScope,
  selectWorkbenchDiagnostics,
  WORKBENCH_PRESET_IDS,
  WORKBENCH_SCOPE_IDS,
} from "../index";
import type { WorkbenchScope } from "../types";

describe("workbench presets", () => {
  test("ships standard and strict presets in stable order", () => {
    expect(WORKBENCH_PRESET_IDS).toEqual(["standard", "strict"]);
    expect(listWorkbenchPresets().map((preset) => preset.id)).toEqual([
      "standard",
      "strict",
    ]);
    expect(getWorkbenchPreset("standard").scopes).toContain("source");
    expect(getWorkbenchPreset("strict").scopes).toContain("workspace");
    expect(getWorkbenchPreset("standard").ruleLevels).toEqual(["standard"]);
    expect(getWorkbenchPreset("strict").ruleLevels).toEqual(["standard", "strict"]);
    expect(WORKBENCH_SCOPE_IDS).toEqual([
      "generated",
      "provider",
      "release",
      "resource",
      "runtime",
      "source",
      "workspace",
    ]);
  });

  test("guards unchecked preset and scope strings", () => {
    expect(isWorkbenchPresetId("standard")).toBe(true);
    expect(isWorkbenchPresetId("recommended")).toBe(false);
    expect(isWorkbenchScope("workspace")).toBe(true);
    expect(isWorkbenchScope("syntax")).toBe(false);
    expect(parseWorkbenchPresetId("strict")).toBe("strict");
    expect(parseWorkbenchScope("source")).toBe("source");
    expect(() => parseWorkbenchPresetId("recommended")).toThrow(
      "unknown workbench preset: recommended"
    );
    expect(() => parseWorkbenchScope("soruce")).toThrow(
      "unknown workbench scope: soruce"
    );
  });

  test("returns cloned preset data at the API boundary", () => {
    const first = getWorkbenchPreset("standard");
    const second = getWorkbenchPreset("standard");

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.ruleLevels).not.toBe(second.ruleLevels);
    expect(first.scopes).not.toBe(second.scopes);
    expect(listWorkbenchPresets()[0]!).not.toBe(listWorkbenchPresets()[0]!);
    expect(() => (WORKBENCH_PRESET_IDS as unknown as string[]).push("recommended")).toThrow();
    expect(() => (WORKBENCH_SCOPE_IDS as unknown as string[]).push("syntax")).toThrow();
    expect(isWorkbenchPresetId("recommended")).toBe(false);
    expect(isWorkbenchScope("syntax")).toBe(false);
  });

  test("selects diagnostics by preset, scope, and rule id", () => {
    const source = createWorkbenchDiagnostic({
      message: "Source issue",
      ruleId: "lint/source",
      scope: "source",
      severity: "warning",
      subject: { kind: "skill", path: ".skillset/skills/demo/SKILL.md" },
    });
    const workspace = createWorkbenchDiagnostic({
      message: "Workspace issue",
      ruleId: "schema/workspace",
      scope: "workspace",
      severity: "error",
      subject: { kind: "workspace", id: "root" },
    });
    const strictOnly = createWorkbenchDiagnostic({
      message: "Convention issue",
      ruleId: "convention/strict",
      ruleLevel: "strict",
      scope: "source",
      severity: "info",
      subject: { kind: "skill", path: ".skillset/skills/demo/SKILL.md" },
    });

    expect(selectWorkbenchDiagnostics([source, workspace, strictOnly], { scopes: ["source"] })).toEqual([source]);
    expect(selectWorkbenchDiagnostics([source, workspace, strictOnly], { ruleIds: ["schema/workspace"] })).toEqual([workspace]);
    expect(selectWorkbenchDiagnostics([source, workspace, strictOnly], { ruleIds: ["convention/strict"] })).toEqual([strictOnly]);
    expect(selectWorkbenchDiagnostics([source, workspace, strictOnly], { preset: "strict" })).toEqual([
      source,
      workspace,
      strictOnly,
    ]);
    const uncheckedScopes = ["soruce" as unknown as WorkbenchScope];
    expect(() =>
      selectWorkbenchDiagnostics([source], { scopes: uncheckedScopes })
    ).toThrow("unknown workbench scope: soruce");
  });
});
