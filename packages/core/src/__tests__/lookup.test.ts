import { describe, expect, it } from "bun:test";
import { getProviderSchemaSnapshot } from "@skillset/provider-formats";

import { lookupSkillsetReference } from "@skillset/core";

describe("lookupSkillsetReference", () => {
  it("lists lookup subjects when no subject is selected", () => {
    const report = lookupSkillsetReference();

    expect(report.subject).toBeUndefined();
    expect(report.subjects.map((subject) => subject.subject)).toEqual([
      "skill",
      "agent",
      "instruction",
      "workspace",
      "hooks",
      "plugin",
    ]);
    expect(report.diagnostics).toEqual([]);
  });

  it("derives skill frontmatter fields from the shared schema contract", () => {
    const report = lookupSkillsetReference({
      subject: "skill",
      views: ["frontmatter"],
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.fields.map((field) => field.path)).toEqual([
      "allowed_tools",
      "bin",
      "claude",
      "codex",
      "dependencies",
      "description",
      "dialect",
      "hooks",
      "implicit_invocation",
      "mcp",
      "metadata",
      "model",
      "name",
      "resources",
      "schema",
      "skillset",
      "summary",
      "supports",
      "title",
      "tool_intent",
      "version",
    ]);
    expect(report.fields.find((field) => field.path === "resources")).toEqual(expect.objectContaining({
      contractId: "skill-frontmatter",
      required: false,
    }));
  });

  it("describes nested workspace field values without dotted concept names", () => {
    const report = lookupSkillsetReference({
      field: "compile.targets",
      subject: "workspace",
      views: ["values"],
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.fields).toEqual([
      expect.objectContaining({
        contractId: "workspace-config",
        path: "compile.targets",
        required: false,
        type: "array<enum>",
        values: ["claude", "codex"],
      }),
    ]);
  });

  it("returns hook event facts from provider schema snapshots", () => {
    const snapshot = getProviderSchemaSnapshot("codex-hook-event-schemas");
    const report = lookupSkillsetReference({
      subject: "hooks",
      targets: ["codex"],
      views: ["events"],
    });

    expect(snapshot?.summary).toMatchObject({ schemaCount: 20 });
    expect(report.diagnostics).toEqual([]);
    expect(report.events.map((event) => event.name)).toContain("pre-tool-use.command.input");
    expect(report.events.find((event) => event.name === "pre-tool-use.command.input")).toEqual(expect.objectContaining({
      providerRef: "codex-hook-event-schemas",
      target: "codex",
      fields: expect.arrayContaining([
        { name: "cwd", required: true },
        { name: "tool_name", required: true },
      ]),
    }));
  });

  it("derives plugin aspect compatibility from the feature registry", () => {
    const report = lookupSkillsetReference({
      aspects: ["bin"],
      subject: "plugin",
      targets: ["codex"],
      views: ["compat"],
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.compatibility).toEqual([
      expect.objectContaining({
        featureId: "plugin-bin",
        featureTitle: "Plugin Bin",
        status: "unsupported",
        target: "codex",
      }),
    ]);
    expect(report.compatibility[0]?.reason).toContain("Codex plugins");
  });

  it("represents invalid view combinations as structured diagnostics", () => {
    const workspace = lookupSkillsetReference({
      subject: "workspace",
      views: ["frontmatter"],
    });
    const skill = lookupSkillsetReference({
      subject: "skill",
      views: ["events"],
    });

    expect(workspace.diagnostics).toContainEqual({
      code: "lookup/frontmatter/not-applicable",
      message: "Workspace configuration uses fields; use --fields or --field instead of --frontmatter.",
      severity: "error",
    });
    expect(skill.diagnostics).toContainEqual({
      code: "lookup/events/not-applicable",
      message: "skill lookup does not have hook events; use subject hooks for --events.",
      severity: "error",
    });
  });
});
