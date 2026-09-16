import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listProviderDestinationFormatSnapshots,
  type ProviderDestinationFormatJsonValue,
} from "@skillset/registry";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import {
  pluginComponentManifestField,
  pluginComponentPath,
  pluginComponents,
} from "../plugin-component-paths";
import { checkProviderFormatConformance } from "../provider-format-conformance";
import { renderBuildGraph } from "../render";
import { withOptionalSurfacePaths } from "../render-plugin-manifest";
import { loadBuildGraph } from "../resolver";
import {
  selectorForTargetNativeIsland,
  targetNativeSurface,
} from "../source-unit-selector";
import type {
  BuildGraph,
  SourcePlugin,
  SourcePluginFeature,
  SourceSkill,
  TargetName,
} from "../types";

const targets = ["claude", "codex", "cursor"] as const;

describe("registry-backed plugin component paths", () => {
  test("projects every registry component path and manifest field", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-plugin-components-"));
    const componentsByTarget = new Map(
      targets.map((target) => [target, registryComponents(target)])
    );
    for (const components of componentsByTarget.values()) {
      for (const component of components) {
        const outputPath = component.defaultPath.endsWith("/")
          ? join(root, component.defaultPath, ".fixture")
          : join(root, component.defaultPath);
        await Bun.write(outputPath, "fixture\n");
      }
    }

    const skills = [{ relativePath: "skills/review/SKILL.md" } as SourceSkill];
    const features = [
      feature("app", join(root, ".app.json")),
      feature("mcp", join(root, ".mcp.json")),
    ];
    const plugin = {
      adaptiveHooks: [],
      features,
      hookAttachments: [],
      id: "demo",
      path: root,
    } as unknown as SourcePlugin;
    const graph = {
      adaptiveHooks: [],
      hookAttachments: [],
      projectIslands: [],
    } as unknown as BuildGraph;

    for (const target of targets) {
      const components = componentsByTarget.get(target) ?? [];
      expect(pluginComponents(target).map(({ kind }) => kind)).toEqual(
        components.map(({ kind }) => kind)
      );
      const manifest = withOptionalSurfacePaths(
        graph,
        {},
        plugin,
        skills,
        target
      );
      for (const component of components) {
        expect(pluginComponentPath(target, component.kind)).toBe(
          `./${component.defaultPath}`
        );
        expect(pluginComponentManifestField(target, component.kind)).toBe(
          component.manifestField ?? undefined
        );
        if (component.manifestField !== null) {
          expect(readDotted(manifest, component.manifestField)).toBe(
            `./${component.defaultPath}`
          );
        }
      }
    }
  });

  test.each([
    {
      expected: "./skills/",
      files: [".skillset/plugins/demo/skills/review/SKILL.md"],
      label: "flat-only",
    },
    {
      expected: ["./skills/engineering/tdd"],
      files: [".skillset/plugins/demo/skills/engineering/tdd/SKILL.md"],
      label: "nested-only",
    },
    {
      expected: ["./skills/engineering/tdd"],
      files: [
        ".skillset/plugins/demo/skills/review/SKILL.md",
        ".skillset/plugins/demo/skills/engineering/tdd/SKILL.md",
      ],
      label: "mixed immediate and nested",
    },
  ])("renders Claude $label skill paths", async ({ expected, files }) => {
    const graph = await fixtureGraph(
      Object.fromEntries(files.map((path) => [path, skill(path)]))
    );
    const rendered = await renderBuildGraph(graph);
    const manifest = rendered.find((file) =>
      file.path.endsWith("/.claude-plugin/plugin.json")
    );
    expect(manifest).toBeDefined();
    const value = JSON.parse(
      new TextDecoder().decode(manifest?.content)
    ) as Record<string, unknown>;
    expect(value.skills).toEqual(expected);
  });

  test("accepts a Claude manifest skills array in local conformance", () => {
    const report = checkProviderFormatConformance([
      {
        content: new TextEncoder().encode(
          `${JSON.stringify({
            description: "Nested skills.",
            name: "demo",
            skills: ["./skills/engineering/review"],
          })}\n`
        ),
        path: "plugins/demo/claude/.claude-plugin/plugin.json",
      },
    ]);
    expect(report).toEqual({ checkedFiles: 1, issues: [], ok: true });
  });

  test("keeps selector surfaces aligned with target component paths", () => {
    expect(targetNativeSurface("claude", ".mcp.json")).toBe("mcp");
    expect(targetNativeSurface("cursor", "mcp.json")).toBe("mcp");
    expect(targetNativeSurface("claude", "commands/review.md")).toBe(
      "commands"
    );
    expect(targetNativeSurface("cursor", "rules/review.mdc")).toBe("rules");
    expect(targetNativeSurface("claude", "hooks/hooks.json")).toBe("hooks");
    expect(targetNativeSurface("claude", "hooks.json")).toBe("hooksjson");
    expect(
      selectorForTargetNativeIsland(
        "cursor",
        "plugin:demo",
        "commands/review.md"
      )
    ).toBe("plugin.demo.cursor.commands:commands/review.md");
  });

  test("keeps authored MCP source spelling independent of Cursor destination spelling", async () => {
    const graph = await fixtureGraph({
      ".skillset/plugins/demo/.mcp.json": JSON.stringify({
        mcpServers: { demo: { command: "demo" } },
      }),
      ".skillset/plugins/demo/skills/review/SKILL.md": skill("review"),
    });
    const feature = graph.plugins[0]?.features.find(({ key }) => key === "mcp");
    expect(feature?.targetPath).toBe(".mcp.json");
    expect(feature?.sourcePath.endsWith("/.mcp.json")).toBe(true);
    expect(pluginComponentPath("cursor", "mcp")).toBe("./mcp.json");
  });
});

interface RegistryComponent {
  readonly defaultPath: string;
  readonly kind: string;
  readonly manifestField: string | null;
}

function registryComponents(target: TargetName): readonly RegistryComponent[] {
  const snapshot = listProviderDestinationFormatSnapshots().find(
    (candidate) =>
      candidate.destination === "plugin" && candidate.target === target
  );
  if (
    !isRecord(snapshot?.format) ||
    !Array.isArray(snapshot.format.components)
  ) {
    throw new Error(`missing ${target} plugin components`);
  }
  return snapshot.format.components.map((value) => {
    if (!isRecord(value)) throw new Error("invalid plugin component");
    const defaultPath = value.defaultPath;
    const kind = value.kind;
    const manifestField = value.manifestField;
    if (
      typeof defaultPath !== "string" ||
      typeof kind !== "string" ||
      (manifestField !== null && typeof manifestField !== "string")
    ) {
      throw new Error("invalid plugin component fields");
    }
    return { defaultPath, kind, manifestField };
  });
}

function feature(
  key: SourcePluginFeature["key"],
  sourcePath: string
): SourcePluginFeature {
  return {
    key,
    origin: "conventional",
    sourcePath,
    targetPath: sourcePath.split("/").at(-1) ?? sourcePath,
  };
}

function readDotted(value: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((current, part) => {
    return isRecord(current) ? current[part] : undefined;
  }, value);
}

function isRecord(
  value: ProviderDestinationFormatJsonValue | unknown
): value is Record<string, ProviderDestinationFormatJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function skill(path: string): string {
  const name = path.split("/").at(-2) ?? "review";
  return `---\nname: ${name}\ndescription: Review changes.\n---\n\nReview changes.\n`;
}

async function fixtureGraph(
  pluginFiles: Record<string, string>
): Promise<BuildGraph> {
  const root = await mkdtemp(join(tmpdir(), "skillset-component-fixture-"));
  const files = normalizeSkillsetFixtureFiles({
    ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
  description: Demo plugin.
`,
    "skillset.yaml": `
skillset:
  name: component-fixture
claude: true
codex: true
cursor: true
compile:
  unsupportedDestination: warn
`,
    ...pluginFiles,
  });
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return loadBuildGraph(root);
}
