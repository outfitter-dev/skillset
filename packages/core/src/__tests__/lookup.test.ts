import { describe, expect, it } from "bun:test";
import { getProviderHookEvidence, getProviderSchemaSnapshot } from "@skillset/registry";

import {
  listLookupFields,
  listLookupSubjects,
  listLookupViews,
  lookupSkillsetReference,
} from "@skillset/core";

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

  it("derives applicable views from the owned lookup contracts", () => {
    expect(listLookupViews("skill")).toEqual([
      "fields",
      "frontmatter",
      "values",
      "compat",
      "examples",
      "schema",
    ]);
    expect(listLookupViews("workspace")).toEqual([
      "fields",
      "values",
      "examples",
      "schema",
    ]);
    expect(listLookupViews("hooks")).toEqual([
      "fields",
      "values",
      "events",
      "compat",
      "examples",
      "schema",
    ]);
    expect(listLookupViews("plugin")).toEqual(["compat"]);
  });

  it("derives subjects applicable to a partial view request", () => {
    expect(
      listLookupSubjects({ views: ["frontmatter"] }).map(
        (subject) => subject.subject
      )
    ).toEqual(["skill", "agent", "instruction"]);
    expect(
      listLookupSubjects({ views: ["events"] }).map(
        (subject) => subject.subject
      )
    ).toEqual(["hooks"]);
    expect(
      listLookupSubjects({ views: ["fields"] }).map(
        (subject) => subject.subject
      )
    ).toEqual(["skill", "agent", "instruction", "workspace", "hooks"]);
    expect(
      listLookupSubjects({ field: "compile.targets" }).map(
        (subject) => subject.subject
      )
    ).toEqual(["workspace"]);
    expect(
      listLookupSubjects({ field: " compile.targets " }).map(
        (subject) => subject.subject
      )
    ).toEqual(["workspace"]);
    expect(
      listLookupSubjects({ field: "does.not.exist" }).map(
        (subject) => subject.subject
      )
    ).toEqual(["skill", "agent", "instruction", "workspace", "hooks"]);
    expect(
      listLookupSubjects({
        aspects: ["adaptive"],
        field: "context.env",
      }).map((subject) => subject.subject)
    ).toEqual(["hooks"]);
  });

  it("lists selectable nested field paths from the active schema contract", () => {
    const workspace = listLookupFields({ subject: "workspace" });
    expect(workspace).toContainEqual(
      expect.objectContaining({
        contractId: "workspace-config",
        path: "compile.targets",
        type: "array<enum>",
      })
    );

    const adaptiveHooks = listLookupFields({
      aspects: ["adaptive"],
      subject: "hooks",
    });
    expect(adaptiveHooks).toContainEqual(
      expect.objectContaining({
        contractId: "adaptive-hook",
        path: "context.env",
      })
    );
    expect(listLookupFields({ subject: "plugin" })).toEqual([]);
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
      "cursor",
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
      "tools",
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
        values: ["claude", "codex", "cursor"],
      }),
    ]);
  });

  it("returns top-level values when values has no field selection", () => {
    const report = lookupSkillsetReference({
      subject: "workspace",
      views: ["values"],
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.fields.length).toBeGreaterThan(0);
    expect(report.fields).toContainEqual(
      expect.objectContaining({
        path: "compile",
      })
    );
  });

  it("returns hook event facts from provider capabilities and schema snapshots", () => {
    const snapshot = getProviderSchemaSnapshot("codex-hook-event-schemas");
    const evidence = getProviderHookEvidence("claude");
    const report = lookupSkillsetReference({
      subject: "hooks",
      targets: ["claude", "codex"],
      views: ["events"],
    });

    expect(snapshot?.summary).toMatchObject({ schemaCount: 20 });
    expect(evidence.providerRef).toBe("claude-hooks-overlay");
    expect(report.diagnostics).toEqual([]);
    expect(report.events.map((event) => `${event.target}:${event.name}`)).toEqual(expect.arrayContaining([
      "claude:PreCompact",
      "claude:PostCompact",
      "codex:PreToolUse",
    ]));
    expect(report.events.find((event) => event.target === "claude" && event.name === "PreCompact")).toEqual(expect.objectContaining({
      canBlock: true,
      handlerTypes: ["command", "http", "mcp_tool"],
      matcherEvaluation: "exact-values",
      matcherKind: "compact-trigger",
      matcherValues: ["manual", "auto"],
      outputFields: expect.arrayContaining(["continue", "stopReason"]),
      providerRef: "claude-hooks-overlay",
      target: "claude",
    }));
    expect(report.events.find((event) => event.target === "codex" && event.name === "PreToolUse")).toEqual(expect.objectContaining({
      canBlock: true,
      handlerTypes: ["command"],
      matcherEvaluation: "provider-native",
      matcherKind: "tool",
      matcherValues: [],
      providerRef: "codex-hook-event-schemas",
      outputFields: ["decision", "hookSpecificOutput", "reason", "systemMessage"],
      rawOutputFields: expect.arrayContaining(["continue", "decision", "hookSpecificOutput", "stopReason", "suppressOutput"]),
      target: "codex",
      unsupportedOutputFields: ["continue", "stopReason", "suppressOutput"],
      fields: expect.arrayContaining([
        { name: "cwd", required: true },
        { name: "tool_name", required: true },
      ]),
    }));
    expect(report.events.find((event) => event.target === "codex" && event.name === "PreCompact")).toEqual(expect.objectContaining({
      matcherEvaluation: "exact-values",
      matcherKind: "compact-trigger",
      matcherValues: ["manual", "auto"],
      target: "codex",
    }));
  });

  it("selects adaptive hook contract and compatibility through a hook aspect", () => {
    const report = lookupSkillsetReference({
      aspects: ["adaptive"],
      subject: "hooks",
      targets: ["codex"],
      views: ["fields", "examples", "compat"],
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.fields.map((field) => `${field.contractId}:${field.path}`)).toEqual([
      "adaptive-hook:claude",
      "adaptive-hook:codex",
      "adaptive-hook:context",
      "adaptive-hook:cursor",
      "adaptive-hook:description",
      "adaptive-hook:events",
      "adaptive-hook:match",
      "adaptive-hook:name",
      "adaptive-hook:providers",
      "adaptive-hook:run",
      "adaptive-hook:status",
    ]);
    expect(report.examples.map((example) => example.contractId)).toEqual(["adaptive-hook"]);
    expect(report.compatibility).toEqual([
      expect.objectContaining({
        featureId: "adaptive-hooks",
        target: "codex",
      }),
    ]);

    expect(lookupSkillsetReference({
      aspects: ["attachments"],
      subject: "hooks",
      targets: ["claude"],
      views: ["compat"],
    }).compatibility.map((item) => item.featureId)).toEqual(["adaptive-hooks"]);
  });

  it("reports runtime context compatibility through toolkit hook aspects", () => {
    const report = lookupSkillsetReference({
      aspects: ["toolkit"],
      field: "context.env",
      subject: "hooks",
      targets: ["claude", "codex", "cursor"],
      views: ["fields", "values", "compat"],
    });

    expect(report.diagnostics).toEqual([]);
    expect(report.fields).toEqual([
      expect.objectContaining({
        contractId: "adaptive-hook",
        path: "context.env",
        type: "array<enum>",
        values: ["hook.event", "provider", "session.id"],
      }),
    ]);
    expect(report.compatibility).toEqual([
      expect.objectContaining({
        featureId: "runtime-context",
        note: expect.stringContaining("raw Claude environment remains available"),
        status: "transformed",
        target: "claude",
      }),
      expect.objectContaining({
        featureId: "runtime-context",
        note: expect.stringContaining("raw Codex environment remains available"),
        status: "transformed",
        target: "codex",
      }),
      expect.objectContaining({
        featureId: "runtime-context",
        note: expect.stringContaining("raw Cursor environment remains available"),
        status: "transformed",
        target: "cursor",
      }),
    ]);

    expect(lookupSkillsetReference({
      aspects: ["context", "runtime"],
      subject: "hooks",
      targets: ["codex"],
      views: ["compat"],
    }).compatibility.map((item) => item.featureId)).toEqual(["runtime-context"]);
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
