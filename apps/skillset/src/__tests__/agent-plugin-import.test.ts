import { describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { renderBuildGraph } from "@skillset/core/internal/render";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { BuildGraph, RenderedFile } from "@skillset/core/internal/types";
import { parseMarkdown } from "@skillset/core/internal/yaml";

import { adoptSkillset } from "../adopt";
import { importSource } from "../import";

const SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const decoder = new TextDecoder();

describe("Agent Plugins package import", () => {
  test("imports and semantically round-trips the portable package core", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      author: {
        email: "maintainer@example.com",
        name: "Maintainer",
        url: "https://example.com/maintainer",
      },
      description: "Portable review tools.",
      homepage: "https://example.com/review-tools",
      keywords: ["agents", "review"],
      license: "MIT",
      name: "review-tools",
      repository: "https://github.com/example/review-tools",
      version: "2.4.6",
    });
    await writeJson(join(external, "mcp.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        review: {
          args: ["${PLUGIN_ROOT}/scripts/server.js"],
          command: "node",
          type: "stdio",
        },
      },
    });
    await write(
      join(external, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review a change.\n---\n\nReview carefully.\n"
    );
    await write(
      join(external, "skills/review/references/checklist.md"),
      "# Checklist\n"
    );
    await write(join(external, "README.md"), "# Review tools\n");
    await write(join(external, "CHANGELOG.md"), "# Changes\n");
    await write(join(external, "assets/icon.svg"), "<svg />\n");
    await write(join(external, "scripts/server.js"), "export {};\n");
    await write(
      join(external, "src/index.ts"),
      "export const review = true;\n"
    );

    const report = await importSource({
      kind: "plugin",
      rootPath: root,
      sourcePath: external,
    });

    expect(report.name).toBe("review-tools");
    expect(report.copiedFiles).toEqual(
      expect.arrayContaining([
        ".mcp.json",
        "CHANGELOG.md",
        "README.md",
        "assets/icon.svg",
        "scripts/server.js",
        "skillset.yaml",
        "skills/review/SKILL.md",
        "skills/review/references/checklist.md",
        "src/index.ts",
      ])
    );
    expect(report.copiedFiles).not.toContain("plugin.json");
    expect(report.copiedFiles).not.toContain("mcp.json");
    expect(report.baselines).toContainEqual(
      expect.objectContaining({
        scope: "plugin:review-tools",
        version: "2.4.6",
      })
    );

    const config = await readFile(
      join(root, ".skillset/plugins/review-tools/skillset.yaml"),
      "utf8"
    );
    expect(config).toContain("name: review-tools");
    expect(config).toContain("description: Portable review tools.");
    expect(config).toContain("license: MIT");
    expect(config).not.toContain("$schema");
    expect(config).not.toContain("version:");
    expect(
      JSON.parse(
        await readFile(
          join(root, ".skillset/plugins/review-tools/.mcp.json"),
          "utf8"
        )
      )
    ).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        review: {
          args: ["${PLUGIN_ROOT}/scripts/server.js"],
          command: "node",
          type: "stdio",
        },
      },
    });

    const rendered = await renderBuildGraph(
      adopted(await loadBuildGraph(root))
    );
    expect(json(rendered, "plugins/review-tools/plugin.json")).toEqual({
      $schema: SCHEMA,
      author: {
        email: "maintainer@example.com",
        name: "Maintainer",
        url: "https://example.com/maintainer",
      },
      description: "Portable review tools.",
      homepage: "https://example.com/review-tools",
      keywords: ["agents", "review"],
      license: "MIT",
      name: "review-tools",
      repository: "https://github.com/example/review-tools",
      version: "2.4.6",
    });
    expect(json(rendered, "plugins/review-tools/mcp.json")).toEqual({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        review: {
          args: ["${PLUGIN_ROOT}/scripts/server.js"],
          command: "node",
          type: "stdio",
        },
      },
    });
    expect(paths(rendered)).toEqual(
      expect.arrayContaining([
        "plugins/review-tools/README.md",
        "plugins/review-tools/CHANGELOG.md",
        "plugins/review-tools/assets/icon.svg",
        "plugins/review-tools/scripts/server.js",
        "plugins/review-tools/src/index.ts",
        "plugins/review-tools/skills/review/SKILL.md",
      ])
    );
  });

  test("blocks manifest extensions atomically", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Extended plugin.",
      extensions: { "com.example": { enabled: true } },
      name: "extended",
      version: "1.0.0",
    });

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("manifest extensions cannot be mapped");
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("preserves an MCP-referenced bin support root", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Executable MCP package.",
      name: "mcp-bin",
      version: "1.0.0",
    });
    await writeJson(join(external, "mcp.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        local: {
          command: "./bin/server",
          type: "stdio",
        },
      },
    });
    await write(join(external, "bin/server"), "#!/bin/sh\nexit 0\n");

    const report = await importSource({
      kind: "plugin",
      rootPath: root,
      sourcePath: external,
    });

    expect(report.copiedFiles).toContain("bin/server");
    const rendered = await renderBuildGraph(
      adopted(await loadBuildGraph(root))
    );
    expect(paths(rendered)).toContain("plugins/mcp-bin/bin/server");
  });

  test("blocks unreferenced siblings inside an MCP-referenced bin root", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Executable MCP package with extra bin content.",
      name: "mcp-bin-extra",
      version: "1.0.0",
    });
    await writeJson(join(external, "mcp.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        local: { command: "./bin/server", type: "stdio" },
      },
    });
    await write(join(external, "bin/server"), "#!/bin/sh\nexit 0\n");
    await write(join(external, "bin/unrelated"), "do not import\n");

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("unreferenced bin paths");
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("preserves only the referenced MCP working-directory subtree", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "MCP package with a working directory.",
      name: "mcp-bin-cwd",
      version: "1.0.0",
    });
    await writeJson(join(external, "mcp.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        local: {
          command: "node",
          cwd: "${PLUGIN_ROOT}/bin/runtime",
          type: "stdio",
        },
      },
    });
    await write(join(external, "bin/runtime/config.json"), "{}\n");

    const report = await importSource({
      kind: "plugin",
      rootPath: root,
      sourcePath: external,
    });
    expect(report.copiedFiles).toContain("bin/runtime/config.json");
  });

  test("blocks an unreferenced bin root", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Unreferenced executable package.",
      name: "unused-bin",
      version: "1.0.0",
    });
    await write(join(external, "bin/server"), "#!/bin/sh\nexit 0\n");

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("unmappable root paths: bin");
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("ignores repository control metadata without importing it", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Repository package.",
      name: "repository-package",
      version: "1.0.0",
    });
    await write(
      join(external, ".git/config"),
      "[core]\n\trepositoryformatversion = 0\n"
    );

    const report = await importSource({
      kind: "plugin",
      rootPath: root,
      sourcePath: external,
    });

    expect(report.copiedFiles).not.toContain(".git/config");
    expect(
      await Bun.file(
        join(root, ".skillset/plugins/repository-package/.git/config")
      ).exists()
    ).toBe(false);
  });

  test("blocks standard metadata outside the canonical license vocabulary", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Custom licensed package.",
      license: "LicenseRef-Proprietary",
      name: "custom-license",
      version: "1.0.0",
    });

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow('license "LicenseRef-Proprietary" cannot be mapped');
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test.each([
    [
      { description: "Release label.", version: "release-2026" },
      "semantic version",
    ],
    [{ description: "", version: "1.0.0" }, "metadata cannot be mapped"],
  ])(
    "blocks canonically unmappable manifest metadata before adoption writes",
    async (metadata, message) => {
      const root = await createTestFixtureRoot("skillset-agent-plugin-metadata-blocked-");
      await writeJson(join(root, "plugin.json"), {
        $schema: SCHEMA,
        name: "blocked-metadata",
        ...metadata,
      });

      const preview = await adoptSkillset(root);
      expect(preview.ok).toBe(false);
      expect(preview.surveyDiagnostics).toContainEqual(
        expect.objectContaining({
          code: "agent-plugin-import-blocked",
          message: expect.stringContaining(message),
        })
      );

      const writeAttempt = await adoptSkillset(root, { write: true });
      expect(writeAttempt.ok).toBe(false);
      expect(writeAttempt.write).toBe(false);
      expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
      expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
    }
  );

  test.each([
    [
      "name mismatch",
      "---\nname: wrong\ndescription: Review.\n---\n\nReview.\n",
      "must match directory",
    ],
    [
      "missing description",
      "---\nname: review\n---\n\nReview.\n",
      "description must be a non-empty string",
    ],
    [
      "oversized description",
      `---\nname: review\ndescription: ${"x".repeat(1025)}\n---\n\nReview.\n`,
      "at most 1024 characters",
    ],
    [
      "malformed frontmatter",
      "---\nname: [review\ndescription: Review.\n---\n\nReview.\n",
      "Flow sequence",
    ],
    [
      "non-semver reserved metadata version",
      "---\nname: review\ndescription: Review.\nmetadata:\n  version: release-2026\n---\n\nReview.\n",
      "metadata.version must be a semantic version",
    ],
    [
      "incompatible reserved metadata schema",
      '---\nname: review\ndescription: Review.\nmetadata:\n  skillset.schema: "2"\n---\n\nReview.\n',
      "metadata.skillset.schema must be 1",
    ],
  ])(
    "blocks invalid Agent Skill %s before adoption writes",
    async (_label, source, message) => {
      const root = await createTestFixtureRoot("skillset-agent-plugin-skill-blocked-");
      await writeJson(join(root, "plugin.json"), {
        $schema: SCHEMA,
        description: "Package with invalid skill.",
        name: "invalid-skill-package",
        version: "1.0.0",
      });
      await write(join(root, "skills/review/SKILL.md"), source);

      const preview = await adoptSkillset(root);
      expect(preview.ok).toBe(false);
      expect(preview.surveyDiagnostics).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining(message) })
      );

      const writeAttempt = await adoptSkillset(root, { write: true });
      expect(writeAttempt.write).toBe(false);
      expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
      expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
    }
  );

  test.each([
    [undefined, "must declare $schema"],
    ["https://example.com/mcp.schema.json", "must declare $schema"],
  ])(
    "requires the exact Agent Plugins MCP schema before writes",
    async (schema, message) => {
      const { external, root } = await roots();
      await writeJson(join(external, "plugin.json"), {
        $schema: SCHEMA,
        description: "MCP package.",
        name: "mcp-schema-package",
        version: "1.0.0",
      });
      await writeJson(join(external, "mcp.json"), {
        ...(schema === undefined ? {} : { $schema: schema }),
        mcpServers: {},
      });

      await expect(
        importSource({ kind: "plugin", rootPath: root, sourcePath: external })
      ).rejects.toThrow(message);
      expect(
        await Bun.file(
          join(root, ".skillset/plugins/mcp-schema-package")
        ).exists()
      ).toBe(false);
    }
  );

  test("blocks Agent Plugins MCP entries that canonical source would drop", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Authenticated MCP package.",
      name: "authenticated-mcp",
      version: "1.0.0",
    });
    await writeJson(join(external, "mcp.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        authenticated: {
          headers: { Authorization: "Bearer ${CHANNEL}" },
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
      },
    });

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow(
      "MCP server authenticated is unsupported: provider credential placeholders are outside Agent Plugins 1.0; fields: headers"
    );
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);

    const adoptionRoot = await createTestFixtureRoot("skillset-agent-plugin-mcp-blocked-");
    await writeJson(join(adoptionRoot, "plugin.json"), {
      $schema: SCHEMA,
      description: "Authenticated MCP package.",
      name: "authenticated-mcp",
      version: "1.0.0",
    });
    await writeJson(join(adoptionRoot, "mcp.json"), {
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        authenticated: {
          headers: { Authorization: "Bearer ${CHANNEL}" },
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
      },
    });

    const preview = await adoptSkillset(adoptionRoot);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "agent-plugin-import-blocked",
        message: expect.stringContaining("MCP server authenticated is unsupported"),
      })
    );

    const writeAttempt = await adoptSkillset(adoptionRoot, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(adoptionRoot, "skillset.yaml")).exists()).toBe(
      false
    );
    expect(await Bun.file(join(adoptionRoot, ".skillset")).exists()).toBe(false);
  });

  test("normalizes the standard LICENSE spelling", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Licensed package.",
      name: "licensed-package",
      version: "1.0.0",
    });
    await write(join(external, "LICENSE"), "License terms.\n");

    const report = await importSource({
      kind: "plugin",
      rootPath: root,
      sourcePath: external,
    });

    expect(report.copiedFiles).toContain("LICENSE.txt");
    expect(report.copiedFiles).not.toContain("LICENSE");
    expect(
      await readFile(
        join(root, ".skillset/plugins/licensed-package/LICENSE.txt"),
        "utf8"
      )
    ).toBe("License terms.\n");
    const rendered = await renderBuildGraph(
      adopted(await loadBuildGraph(root))
    );
    expect(text(rendered, "plugins/licensed-package/LICENSE.txt")).toBe(
      "License terms.\n"
    );
  });

  test("blocks license metadata combined with bundled license text before writes", async () => {
    const root = await createTestFixtureRoot("skillset-agent-plugin-license-blocked-");
    await writeJson(join(root, "plugin.json"), {
      $schema: SCHEMA,
      description: "Multiply licensed package.",
      license: "MIT",
      name: "multiple-license-sources",
      version: "1.0.0",
    });
    await write(join(root, "LICENSE.txt"), "Original license terms.\n");

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "agent-plugin-import-blocked",
        message: expect.stringContaining(
          "license metadata and bundled license text cannot both be mapped"
        ),
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("blocks ambiguous LICENSE spellings before writes", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Ambiguously licensed package.",
      name: "ambiguous-license",
      version: "1.0.0",
    });
    await write(join(external, "LICENSE"), "License terms.\n");
    await write(join(external, "LICENSE.txt"), "Other terms.\n");

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("both LICENSE and LICENSE.txt");
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("normalizes portable Agent Skill policy and license metadata", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Skill metadata package.",
      name: "skill-metadata-package",
      version: "1.0.0",
    });
    await write(
      join(external, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review a change.\nlicense: MIT\ncompatibility: Requires git.\nmetadata:\n  owner: example\nallowed-tools: Read Search\n---\n\nReview carefully.\n"
    );

    await importSource({
      kind: "plugin",
      rootPath: root,
      sourcePath: external,
    });
    const source = parseMarkdown(
      await readFile(
        join(
          root,
          ".skillset/plugins/skill-metadata-package/skills/review/SKILL.md"
        ),
        "utf8"
      ),
      "imported skill"
    );
    expect(source.frontmatter).toEqual({
      name: "review",
      description: "Review a change.",
      compatibility: "Requires git.",
      metadata: { owner: "example" },
      allowed_tools: { agents: "Read Search" },
      skillset: { license: "MIT" },
    });

    const rendered = await renderBuildGraph(
      adopted(await loadBuildGraph(root))
    );
    const renderedSkill = rendered.find(
      (file) =>
        file.path ===
        "plugins/skill-metadata-package/skills/review/SKILL.md"
    );
    expect(renderedSkill).toBeDefined();
    const roundTrip = parseMarkdown(
      decoder.decode(renderedSkill?.content),
      "rendered skill"
    );
    expect(roundTrip.frontmatter).toEqual(
      expect.objectContaining({
        "allowed-tools": "Read Search",
        compatibility: "Requires git.",
        description: "Review a change.",
        license: "MIT",
        metadata: expect.objectContaining({ owner: "example" }),
        name: "review",
      })
    );
  });

  test("preserves Agent Skill license-file bytes through standard rendering", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Skill license file package.",
      name: "skill-license-file-package",
      version: "1.0.0",
    });
    await write(
      join(external, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review a change.\nlicense: LICENSE.txt\n---\n\nReview carefully.\n"
    );
    await write(
      join(external, "skills/review/LICENSE.txt"),
      "Original skill license terms.\n"
    );

    await importSource({
      kind: "plugin",
      rootPath: root,
      sourcePath: external,
    });
    const rendered = await renderBuildGraph(
      adopted(await loadBuildGraph(root))
    );
    expect(
      text(
        rendered,
        "plugins/skill-license-file-package/skills/review/LICENSE.txt"
      )
    ).toBe("Original skill license terms.\n");
  });

  test("blocks Agent Skill license metadata combined with bundled text before writes", async () => {
    const root = await createTestFixtureRoot("skillset-agent-plugin-skill-license-blocked-");
    await writeJson(join(root, "plugin.json"), {
      $schema: SCHEMA,
      description: "Conflicting skill license package.",
      name: "skill-license-conflict",
      version: "1.0.0",
    });
    await write(
      join(root, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review a change.\nlicense: MIT\n---\n\nReview carefully.\n"
    );
    await write(
      join(root, "skills/review/LICENSE.txt"),
      "Original skill license terms.\n"
    );

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "agent-plugin-import-blocked",
        message: expect.stringContaining(
          "license metadata and bundled LICENSE.txt cannot both be mapped"
        ),
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test.each([
    ["com.example", "extension namespace directory com.example"],
    ["commands", "unmappable root paths: commands"],
  ])(
    "blocks unmappable root package path %s atomically",
    async (path, message) => {
      const { external, root } = await roots();
      await writeJson(join(external, "plugin.json"), {
        $schema: SCHEMA,
        description: "Package with unsupported material.",
        name: "unsupported-package",
        version: "1.0.0",
      });
      await write(join(external, path, "entry.md"), "Unsupported.\n");

      await expect(
        importSource({ kind: "plugin", rootPath: root, sourcePath: external })
      ).rejects.toThrow(message);
      expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
    }
  );

  test("rejects POSIX backslash filenames before they can escape import staging", async () => {
    if (process.platform === "win32") return;
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Package with a non-portable source path.",
      name: "unsafe-source-path",
      version: "1.0.0",
    });
    await write(
      join(external, "src", "..\\..\\escaped.txt"),
      "must remain outside the workspace\n"
    );

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("non-portable backslash path");
    expect(
      await Bun.file(join(root, ".skillset/plugins/escaped.txt")).exists()
    ).toBe(false);
    expect(
      await Bun.file(
        join(root, ".skillset/plugins/unsafe-source-path")
      ).exists()
    ).toBe(false);
  });

  test("rejects POSIX backslash filenames at the shared generic import sink", async () => {
    if (process.platform === "win32") return;
    const { external, root } = await roots();
    await write(
      join(external, "skillset.yaml"),
      "skillset:\n  name: generic-source\n"
    );
    await write(
      join(external, "assets", "..\\..\\escaped.txt"),
      "must remain outside the workspace\n"
    );

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("non-portable backslash path");
    expect(
      await Bun.file(join(root, ".skillset/plugins/escaped.txt")).exists()
    ).toBe(false);
    expect(
      await Bun.file(join(root, ".skillset/plugins/generic-source")).exists()
    ).toBe(false);
  });

  test("requires an explicit mapping for a dotted package identity", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Dotted identity.",
      name: "com.example.tools",
      version: "1.0.0",
    });

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("pass --name <slug> to map it explicitly");

    const report = await importSource({
      kind: "plugin",
      name: "example-tools",
      rootPath: root,
      sourcePath: external,
    });
    expect(report.name).toBe("example-tools");
    expect(report.warnings).toContain(
      'Agent Plugins manifest name "com.example.tools" was explicitly mapped to Skillset plugin id "example-tools".'
    );
  });

  test("rejects nested skill groups instead of dropping them", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Nested skills.",
      name: "nested-skills",
      version: "1.0.0",
    });
    await write(
      join(external, "skills/group/review/SKILL.md"),
      "---\nname: review\ndescription: Review.\n---\n\nReview.\n"
    );

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("nested skill groups cannot be imported");
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("adoption preview detects the standard package and writes nothing", async () => {
    const root = await createTestFixtureRoot("skillset-agent-plugin-adopt-preview-");
    await writeJson(join(root, "plugin.json"), {
      $schema: SCHEMA,
      description: "Preview package.",
      name: "preview-package",
      version: "1.0.0",
    });

    const preview = await adoptSkillset(root);

    expect(preview.ok).toBe(true);
    expect(preview.write).toBe(false);
    expect(preview.candidates).toContainEqual({
      kind: "plugin",
      path: ".",
      plugin: {
        identity: "preview-package",
        paths: ["."],
        providers: [],
        relation: "single-source",
        standardProfile: "agent-plugins-1.0",
      },
    });
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("adoption does not misclassify an unrelated plugin.json", async () => {
    const root = await createTestFixtureRoot("skillset-unrelated-plugin-preview-");
    await writeJson(join(root, "plugin.json"), {
      apiVersion: 2,
      name: "unrelated-plugin",
    });

    const preview = await adoptSkillset(root);

    expect(preview.ok).toBe(true);
    expect(preview.candidates).not.toContainEqual(
      expect.objectContaining({ kind: "plugin", path: "." })
    );
    expect(preview.surveyDiagnostics).toEqual([]);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
  });

  test("adoption write imports the package through the surveyed standard identity", async () => {
    const root = await createTestFixtureRoot("skillset-agent-plugin-adopt-write-");
    await writeJson(join(root, "plugin.json"), {
      $schema: SCHEMA,
      description: "Adopted package.",
      name: "adopted-package",
      version: "1.2.3",
    });
    await write(
      join(root, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review.\n---\n\nReview.\n"
    );

    const report = await adoptSkillset(root, {
      targets: ["claude"],
      write: true,
    });

    expect(report.ok).toBe(true);
    expect(report.imports).toContainEqual(
      expect.objectContaining({
        candidate: expect.objectContaining({ kind: "plugin", path: "." }),
        ok: true,
        units: [
          {
            kind: "plugin",
            name: "adopted-package",
            sourcePath: ".",
          },
        ],
      })
    );
    expect(
      await Bun.file(
        join(root, ".skillset/plugins/adopted-package/skillset.yaml")
      ).exists()
    ).toBe(true);
  });

  test("adoption preview blocks extension-bearing packages before setup writes", async () => {
    const root = await createTestFixtureRoot("skillset-agent-plugin-adopt-blocked-");
    await writeJson(join(root, "plugin.json"), {
      $schema: SCHEMA,
      description: "Blocked package.",
      extensions: { "com.example": { enabled: true } },
      name: "blocked-package",
      version: "1.0.0",
    });

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "agent-plugin-import-blocked",
        message: expect.stringContaining(
          "manifest extensions cannot be mapped"
        ),
        severity: "error",
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("adoption preflight blocks POSIX backslash paths without setup writes", async () => {
    if (process.platform === "win32") return;
    const root = await createTestFixtureRoot("skillset-agent-plugin-path-blocked-");
    await writeJson(join(root, "plugin.json"), {
      $schema: SCHEMA,
      description: "Package with a non-portable source path.",
      name: "unsafe-source-path",
      version: "1.0.0",
    });
    const escapedName = `${basename(root)}-escaped.txt`;
    await write(
      join(root, "src", `..\\..\\${escapedName}`),
      "must remain outside the workspace\n"
    );

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "agent-plugin-import-blocked",
        message: expect.stringContaining("non-portable backslash path"),
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
    expect(await Bun.file(join(dirname(root), escapedName)).exists()).toBe(
      false
    );
  });

  test("adoption blocks nested Agent Plugins packages with the same declared identity", async () => {
    const root = await createTestFixtureRoot("skillset-agent-plugin-identity-collision-");
    for (const path of ["plugins/one", "plugins/two"]) {
      await writeJson(join(root, path, "plugin.json"), {
        $schema: SCHEMA,
        description: `Package at ${path}.`,
        name: "shared-tools",
        version: "1.0.0",
      });
    }

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "plugin", path: "plugins/one" }),
        expect.objectContaining({ kind: "plugin", path: "plugins/two" }),
      ])
    );
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "competing-plugin-sources",
        identity: "shared-tools",
        paths: ["plugins/one", "plugins/two"],
        providers: [],
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("adoption blocks Agent Plugins and native packages with the same declared identity", async () => {
    const root = await createTestFixtureRoot("skillset-cross-plugin-identity-collision-");
    await writeJson(join(root, "plugins/agent/plugin.json"), {
      $schema: SCHEMA,
      description: "Agent Plugins package.",
      name: "shared-tools",
      version: "1.0.0",
    });
    await writeJson(
      join(root, "plugins/native/.claude-plugin/plugin.json"),
      {
        description: "Claude package.",
        name: "shared-tools",
        version: "1.0.0",
      }
    );

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "competing-plugin-sources",
        identity: "shared-tools",
        paths: ["plugins/agent", "plugins/native"],
        providers: ["claude"],
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("adoption preflights native fallback destination identities", async () => {
    const root = await createTestFixtureRoot("skillset-effective-plugin-identity-collision-");
    await writeJson(join(root, "plugins/agent/plugin.json"), {
      $schema: SCHEMA,
      description: "Agent Plugins package.",
      name: "shared-tools",
      version: "1.0.0",
    });
    await writeJson(
      join(root, "plugins/shared-tools/.claude-plugin/plugin.json"),
      {
        description: "Claude package.",
        name: "Shared Tools",
        version: "1.0.0",
      }
    );

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "competing-plugin-sources",
        identity: "shared-tools",
        paths: ["plugins/agent", "plugins/shared-tools"],
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("adoption blocks co-located native and Agent Plugins packages", async () => {
    const root = await createTestFixtureRoot("skillset-colocated-plugin-authority-");
    await writeJson(join(root, "plugins/shared-tools/plugin.json"), {
      $schema: SCHEMA,
      description: "Agent Plugins package.",
      name: "shared-tools",
      version: "1.0.0",
    });
    await writeJson(
      join(root, "plugins/shared-tools/.claude-plugin/plugin.json"),
      {
        description: "Claude package.",
        name: "shared-tools",
        version: "1.0.0",
      }
    );

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(false);
    expect(preview.surveyDiagnostics).toContainEqual(
      expect.objectContaining({
        code: "agent-plugin-import-blocked",
        message: expect.stringContaining(
          "unmappable root paths: .claude-plugin"
        ),
        paths: ["plugins/shared-tools"],
      })
    );

    const writeAttempt = await adoptSkillset(root, { write: true });
    expect(writeAttempt.ok).toBe(false);
    expect(writeAttempt.write).toBe(false);
    expect(await Bun.file(join(root, "skillset.yaml")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("direct import rejects ambiguous co-located package formats", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "plugin.json"), {
      $schema: SCHEMA,
      description: "Agent Plugins package.",
      name: "shared-tools",
      version: "1.0.0",
    });
    await writeJson(join(external, ".claude-plugin/plugin.json"), {
      description: "Claude package.",
      name: "shared-tools",
      version: "1.0.0",
    });

    await expect(
      importSource({ kind: "plugin", rootPath: root, sourcePath: external })
    ).rejects.toThrow("unmappable root paths: .claude-plugin");
    expect(await Bun.file(join(root, ".skillset")).exists()).toBe(false);
  });

  test("adoption keeps distinct nested Agent Plugins identities independent", async () => {
    const root = await createTestFixtureRoot("skillset-agent-plugin-distinct-identities-");
    for (const [path, name] of [
      ["plugins/one", "one-tools"],
      ["plugins/two", "two-tools"],
    ] as const) {
      await writeJson(join(root, path, "plugin.json"), {
        $schema: SCHEMA,
        description: `Package ${name}.`,
        name,
        version: "1.0.0",
      });
    }

    const preview = await adoptSkillset(root);
    expect(preview.ok).toBe(true);
    expect(preview.surveyDiagnostics).toEqual([]);
    expect(preview.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "plugins/one",
          plugin: expect.objectContaining({ identity: "one-tools" }),
        }),
        expect.objectContaining({
          path: "plugins/two",
          plugin: expect.objectContaining({ identity: "two-tools" }),
        }),
      ])
    );
  });
});

async function roots(): Promise<{ external: string; root: string }> {
  const root = await createTestFixtureRoot("skillset-agent-plugin-import-root-");
  await write(
    join(root, "skillset.yaml"),
    "skillset:\n  name: import-root\nclaude: false\ncodex: false\ncursor: false\n"
  );
  return {
    external: await createTestFixtureRoot("skillset-agent-plugin-import-source-"),
    root,
  };
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function adopted(graph: BuildGraph): BuildGraph {
  return {
    ...graph,
    standardProjections: {
      adopted: ["agent-plugins-1.0"],
      adoptionReceiptHashes: {
        "agent-plugins-1.0": `sha256:${"a".repeat(64)}` as const,
      },
    },
  };
}

function paths(files: readonly RenderedFile[]): readonly string[] {
  return files.map((file) => file.path);
}

function text(files: readonly RenderedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path);
  expect(file).toBeDefined();
  return decoder.decode(file?.content);
}

function json(
  files: readonly RenderedFile[],
  path: string
): Record<string, unknown> {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`missing rendered file ${path}`);
  return JSON.parse(decoder.decode(file.content)) as Record<string, unknown>;
}
