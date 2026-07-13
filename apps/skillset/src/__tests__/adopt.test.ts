import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdir, mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";

import { ADOPT_REPORT_DIR, adoptCandidateId, adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { ISOLATED_OUT_ROOT } from "@skillset/core";
import { gitSafeEnv } from "../git-env";
import { readInitAdoptionSelection } from "../cli-core";

const AGENTS_CONTENT = "# Demo agents\n\nHandwritten instructions.\n";

const MARKETPLACE_FIXTURE: Record<string, string> = {
  ".claude-plugin/marketplace.json": JSON.stringify({
    name: "demo-marketplace",
    plugins: [{ name: "demo", source: "./plugins/demo" }],
  }),
  ".claude/commands/x.md": "---\ndescription: Project command.\n---\n\nDo x.\n",
  "AGENTS.md": AGENTS_CONTENT,
  "README.md": "# Demo repo\n",
  "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({
    name: "demo",
    version: "1.0.0",
  }),
  "plugins/demo/commands/hello.md": "---\ndescription: Say hello.\n---\n\nSay hello.\n",
  "plugins/demo/skills/demo-skill/SKILL.md":
    "---\nname: demo-skill\ndescription: Demo skill.\n---\n\nBody.\n",
};

test("SET-277: interactive init selection supports all, individual candidates, and scaffold-only", () => {
  const candidates = [
    { kind: "plugin", path: "plugins/demo" },
    { kind: "skills", path: ".agents/skills" },
  ];
  expect(readInitAdoptionSelection("all", candidates)).toEqual(["plugin:plugins/demo", "skills:.agents/skills"]);
  expect(readInitAdoptionSelection("skills:.agents/skills", candidates)).toEqual(["skills:.agents/skills"]);
  expect(readInitAdoptionSelection("none", candidates)).toEqual([]);
  expect(() => readInitAdoptionSelection("plugin:missing", candidates)).toThrow("unknown adoption candidate plugin:missing");
});

test("SET-277: removed setup commands have no aliases", async () => {
  const create = await runSkillsetCli("create");
  const adopt = await runSkillsetCli("adopt", ".");
  expect(create.exitCode).toBe(1);
  expect(adopt.exitCode).toBe(1);
  expect(create.stderr).toContain("expected command");
  expect(adopt.stderr).toContain("expected command");
  const packageJson = JSON.parse(await readFile(join(import.meta.dir, "../../package.json"), "utf8")) as { readonly bin: Record<string, string> };
  expect(packageJson.bin).not.toHaveProperty("create-skillset");
});

test("SET-277: non-interactive init adoption can select one stable candidate", async () => {
  const root = await fixture({
    ".agents/skills/one/SKILL.md": "---\nname: one\ndescription: One.\n---\n\nOne.\n",
    ".claude/skills/two/SKILL.md": "---\nname: two\ndescription: Two.\n---\n\nTwo.\n",
  });
  const plan = await adoptSkillset(root);
  const selected = plan.candidates.find((candidate) => candidate.path === ".agents/skills");
  expect(selected).toBeDefined();
  const report = await adoptSkillset(root, { candidates: [adoptCandidateId(selected!)], write: true });
  expect(report.imports).toHaveLength(1);
  expect(report.imports[0]?.candidate.path).toBe(".agents/skills");
  expect(await Bun.file(join(root, ".skillset/skills/one/SKILL.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".skillset/skills/two/SKILL.md")).exists()).toBe(false);
});

test("adopt plan mode surveys only and writes nothing", async () => {
  const root = await fixture(MARKETPLACE_FIXTURE);
  const before = await walkFiles(root);

  const report = await adoptSkillset(root);

  expect(report.write).toBe(false);
  expect(report.ok).toBe(true);
  expect(report.acquisition).toEqual({ input: root, kind: "path", rootPath: root });
  expect(report.alreadyAdopted).toBe(false);
  expect(report.candidates).toEqual([
    { kind: "instructions", path: "AGENTS.md" },
    { kind: "plugin", path: "plugins/demo" },
  ]);
  expect(report.surveySkips.map((skip) => skip.path)).toEqual([".claude/commands"]);
  expect(report.renderResults).toContainEqual(
    expect.objectContaining({
      featureId: "target-native-islands",
      sourceUnit: "claude.commands:commands",
      status: "intentionally_skipped",
      target: "claude",
    })
  );
  expect(report.imports).toEqual([]);
  expect(report.builtFiles).toBe(0);
  expect(report.cutover).toEqual([]);
  expect(await walkFiles(root)).toEqual(before);
});

test("adopt reports current and dedicated workspaces as already adopted", async () => {
  const ordinary = await fixture({
    "skillset.yaml": "compile:\n  targets:\n    - claude\n",
    ".skillset/skills/existing/SKILL.md":
      "---\nname: existing\ndescription: Existing skill.\n---\n\nBody.\n",
  });
  const dedicated = await fixture({
    "skillset.yaml": "compile:\n  targets:\n    - claude\n",
    ".skillset/skills/existing/SKILL.md":
      "---\nname: existing\ndescription: Existing skill.\n---\n\nBody.\n",
  });

  const ordinaryReport = await adoptSkillset(ordinary);
  const dedicatedReport = await adoptSkillset(dedicated);

  expect(ordinaryReport.alreadyAdopted).toBe(true);
  expect(dedicatedReport.alreadyAdopted).toBe(true);
  const cli = await runSkillsetCli("init", "--from", ordinary, "--adopt", "all");
  expect(cli.stdout).toContain("repo already has a Skillset workspace marker");
  expect(cli.stdout).not.toContain("repo already has skillset.yaml");
  const markdown = renderAdoptReportMarkdown(ordinaryReport, { rootPath: ordinary });
  expect(markdown).toContain("repo already had a Skillset workspace marker");
  expect(markdown).not.toContain("repo already had `skillset.yaml`");
});

test("adopt accepts git remotes by shallow cloning before running the existing flow", async () => {
  const source = await gitFixture(MARKETPLACE_FIXTURE);
  const remote = pathToFileURL(source).href;

  const report = await adoptSkillset(remote, { write: true });

  expect(report.ok).toBe(true);
  expect(report.rootPath).not.toBe(source);
  expect(report.acquisition.kind).toBe("git");
  if (report.acquisition.kind === "git") {
    expect(report.acquisition.repo).toBe(remote);
    expect(report.acquisition.rootPath).toBe(report.rootPath);
    expect(report.acquisition.ref).toMatch(/^[0-9a-f]{40}$/);
  }
  expect(report.imports.map((result) => [result.candidate.kind, result.ok])).toEqual([
    ["instructions", true],
    ["plugin", true],
  ]);

  const markdown = await readFile(cachePath(report.rootPath, join(ADOPT_REPORT_DIR, "report.md")), "utf8");
  expect(markdown).toContain("## Acquisition");
  expect(markdown).toContain("- source: git remote");
  expect(markdown).toContain(`- repo: \`${remote}\``);
  if (report.acquisition.kind === "git") {
    const ref = report.acquisition.ref;
    const pluginLock = JSON.parse(
      await readFile(cachePath(report.rootPath, join(ISOLATED_OUT_ROOT, "plugins/skillset.lock")), "utf8")
    ) as {
      items: readonly {
        kind: string;
        name: string;
        sourceOrigin?: { path: string; ref?: string; repo?: string };
      }[];
    };
    expect(pluginLock.items.find((item) => item.kind === "plugin" && item.name === "demo")?.sourceOrigin).toEqual({
      path: "plugins/demo",
      ref,
      repo: remote,
    });
    const explain = await runSkillsetCli("explain", ".skillset/plugins/demo", "--root", report.rootPath);
    expect(explain.exitCode).toBe(0);
    expect(explain.stdout).toContain(`source origin: ${remote} @ ${ref} path plugins/demo`);
  }

  const cli = await runSkillsetCli("init", "--from", remote, "--adopt", "all", "--yes");
  expect(cli.exitCode).toBe(0);
  expect(cli.stdout).toContain(`source: git ${remote} @ `);
  expect(cli.stdout).toContain("adopt passed");
});

test("SET-277: local and remote init --from write the same adoption plan into a destination", async () => {
  const source = await gitFixture(MARKETPLACE_FIXTURE);
  const parent = await mkdtemp(join(tmpdir(), "skillset-init-from-"));
  const localDestination = join(parent, "local");
  const remoteDestination = join(parent, "remote");
  const before = await walkFiles(source);

  const local = await runSkillsetCli("init", localDestination, "--from", source, "--adopt", "all", "--yes");
  const remote = await runSkillsetCli("init", remoteDestination, "--from", pathToFileURL(source).href, "--adopt", "all", "--yes");

  expect(local.exitCode).toBe(0);
  expect(remote.exitCode).toBe(0);
  expect(await Bun.file(join(localDestination, ".skillset/plugins/demo/skillset.yaml")).exists()).toBe(true);
  expect(await Bun.file(join(remoteDestination, ".skillset/plugins/demo/skillset.yaml")).exists()).toBe(true);
  expect(await exists(join(localDestination, ".git"))).toBe(true);
  expect(await exists(join(remoteDestination, ".git"))).toBe(true);
  expect(await readFile(join(remoteDestination, ".git", "config"), "utf8")).not.toContain('[remote "origin"]');
  expect(await exists(join(remoteDestination, ".git", "shallow"))).toBe(false);
  expect(await walkFiles(source)).toEqual(before);
});

test("SET-277: init adoption honors an explicit workspace name", async () => {
  const source = await fixture(MARKETPLACE_FIXTURE);
  const parent = await mkdtemp(join(tmpdir(), "skillset-init-name-"));
  const destination = join(parent, "destination");

  const result = await runSkillsetCli(
    "init", destination, "--from", source, "--adopt", "all", "--name", "team", "--yes"
  );

  expect(result.exitCode).toBe(0);
  expect(await readFile(join(destination, "skillset.yaml"), "utf8")).toContain("name: team");
});

test("SET-277: init adoption resolves the repo root from a subdirectory", async () => {
  const root = await gitFixture(MARKETPLACE_FIXTURE);
  const nested = join(root, "packages", "demo");
  await mkdir(nested, { recursive: true });

  const result = await runSkillsetCliIn(nested, "init", "--adopt", "all", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await exists(join(root, ".skillset", "plugins", "demo", "skillset.yaml"))).toBe(true);
  expect(await exists(join(nested, "skillset.yaml"))).toBe(false);
});

test("SET-277: init adoption preserves its positional destination without --from", async () => {
  const source = await gitFixture(MARKETPLACE_FIXTURE);
  const destinationName = `${source.split("/").at(-1)}-migrated`;
  const destination = join(source, "..", destinationName);
  const before = await walkFiles(source);

  const result = await runSkillsetCliIn(source, "init", `../${destinationName}`, "--adopt", "all", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await exists(join(destination, ".skillset", "plugins", "demo", "skillset.yaml"))).toBe(true);
  expect(await walkFiles(source)).toEqual(before);
});

test("SET-277: init adoption can copy into a destination nested below its source", async () => {
  const source = await gitFixture(MARKETPLACE_FIXTURE);
  const destination = join(source, "migrated");

  const result = await runSkillsetCliIn(source, "init", "migrated", "--from", ".", "--adopt", "all", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await exists(join(destination, ".skillset", "plugins", "demo", "skillset.yaml"))).toBe(true);
  expect(await exists(join(destination, "migrated"))).toBe(false);
});

test("SET-277: init --from previews without creating its destination", async () => {
  const source = await fixture(MARKETPLACE_FIXTURE);
  const parent = await mkdtemp(join(tmpdir(), "skillset-init-preview-"));
  const destination = join(parent, "preview");

  const preview = await runSkillsetCli("init", destination, "--from", source, "--adopt", "all");

  expect(preview.exitCode).toBe(0);
  expect(await exists(destination)).toBe(false);
});

test("SET-277: init --from validates adoption before copying its destination", async () => {
  const source = await fixture(MARKETPLACE_FIXTURE);
  const parent = await mkdtemp(join(tmpdir(), "skillset-init-preflight-"));
  const destination = join(parent, "invalid-selection");

  const result = await runSkillsetCli(
    "init",
    destination,
    "--from",
    source,
    "--adopt",
    "plugin:missing",
    "--yes"
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("unknown adoption candidate");
  expect(await exists(destination)).toBe(false);
});

test("adopt write mode imports everything, builds the mirror, and writes the report", async () => {
  const root = await fixture(MARKETPLACE_FIXTURE);
  const before = await walkFiles(root);

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(true);
  expect(report.write).toBe(true);
  expect(report.imports.map((result) => [result.candidate.kind, result.ok])).toEqual([
    ["instructions", true],
    ["plugin", true],
  ]);
  expect(report.builtFiles).toBeGreaterThan(0);
  expect(report.buildError).toBeUndefined();
  expect(report.cutover).toEqual(["AGENTS.md"]);

  // Imported source lands in canonical .skillset/ homes with source-origin metadata.
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("targets:");
  expect(await exists(join(root, ".skillset/plugins/demo/skillset.yaml"))).toBe(true);
  const importedInstructions = await readFile(join(root, ".skillset/rules/agents.md"), "utf8");
  expect(importedInstructions).toContain("skillset:\n  origin:\n    path: AGENTS.md");
  expect(importedInstructions).toContain(AGENTS_CONTENT.trimEnd());
  expect(await readFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "utf8")).toContain(
    "path: plugins/demo"
  );
  expect(await readFile(join(root, ".skillset/plugins/demo/skills/demo-skill/SKILL.md"), "utf8")).toContain(
    "path: plugins/demo/skills/demo-skill/SKILL.md"
  );

  // The build is isolated: the projection lives in the mirror, not the live tree.
  expect(await exists(cachePath(root, ISOLATED_OUT_ROOT))).toBe(true);
  expect(await exists(join(root, "plugins-claude"))).toBe(false);

  // The migration report persists in both shapes.
  const markdown = await readFile(cachePath(root, join(ADOPT_REPORT_DIR, "report.md")), "utf8");
  expect(markdown).toBe(renderAdoptReportMarkdown(report, { rootPath: root }));
  expect(markdown).toContain("## Summary");
  expect(markdown).toContain("## Cutover");
  expect(markdown).toContain("### Render results");
  expect(markdown).toContain("claude intentionally_skipped:");
  expect(markdown).toContain("codex rendered:");
  expect(markdown).toContain("`AGENTS.md`");
  expect(markdown).toContain("unmanaged");
  const json = JSON.parse(await readFile(cachePath(root, join(ADOPT_REPORT_DIR, "report.json")), "utf8")) as {
    renderResults: readonly {
      featureId: string;
      sourceUnit: string;
      status: string;
      target?: string;
    }[];
    ok: boolean;
  };
  expect(json.ok).toBe(true);
  expect(json.renderResults).toContainEqual(
    expect.objectContaining({
      featureId: "plugin-skills",
      sourceUnit: "plugin.demo.skill:demo-skill",
      status: "rendered",
      target: "codex",
    })
  );
  expect(json.renderResults).toContainEqual(
    expect.objectContaining({
      featureId: "target-native-islands",
      sourceUnit: "claude.commands:commands",
      status: "intentionally_skipped",
      target: "claude",
    })
  );
  expect(JSON.stringify(json.renderResults)).not.toContain(root);

  const explain = await runSkillsetCli("explain", ".skillset/plugins/demo", "--root", root);
  expect(explain.exitCode).toBe(0);
  expect(explain.stdout).toContain("source origin: path plugins/demo");

  // Purity: adoption only creates the root config plus paths under .skillset/.
  const added = [...(await walkFiles(root))].filter((path) => !before.has(path));
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((path) => path === "skillset.yaml" || path.startsWith(".skillset/"))).toBe(true);
});

test("adopt elevates a root native plugin without copying workspace config into plugin source", async () => {
  const root = await fixture({
    ".claude-plugin/plugin.json": JSON.stringify({
      description: "Root plugin.",
      name: "root-native",
      version: "1.2.3",
    }),
    "README.md": "# Root native plugin\n",
    "commands/hello.md": "---\ndescription: Say hello.\n---\n\nSay hello.\n",
    "skills/helper/SKILL.md": "---\nname: helper\ndescription: Helper skill.\n---\n\nBody.\n",
  });

  const report = await adoptSkillset(root, { targets: ["claude"], write: true });

  expect(report.ok).toBe(true);
  expect(report.candidates).toContainEqual({ kind: "plugin", path: "." });
  expect(report.imports.find((result) => result.candidate.kind === "plugin")?.ok).toBe(true);

  const workspaceConfig = await readFile(join(root, "skillset.yaml"), "utf8");
  expect(workspaceConfig).toContain("compile:");
  const pluginConfig = await readFile(join(root, ".skillset/plugins/root-native/skillset.yaml"), "utf8");
  expect(pluginConfig).not.toContain("compile:");
  expect(pluginConfig).toContain("name: root-native");
  expect(pluginConfig).toContain("path: .");
  expect(await exists(join(root, ".skillset/plugins/root-native/.claude-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/root-native/commands/hello.md"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/root-native/skills/helper/SKILL.md"))).toBe(true);
});

test("adopt elevates a root Cursor native plugin", async () => {
  const root = await fixture({
    ".cursor-plugin/plugin.json": JSON.stringify({
      description: "Root Cursor plugin.",
      name: "cursor-native",
      version: "1.2.3",
    }),
    "README.md": "# Root Cursor plugin\n",
    "skills/helper/SKILL.md": "---\nname: helper\ndescription: Helper skill.\n---\n\nBody.\n",
  });

  const report = await adoptSkillset(root, { targets: ["cursor"], write: true });

  expect(report.ok).toBe(true);
  expect(report.candidates).toContainEqual({ kind: "plugin", path: "." });
  expect(report.imports.find((result) => result.candidate.kind === "plugin")?.ok).toBe(true);

  const workspaceConfig = await readFile(join(root, "skillset.yaml"), "utf8");
  expect(workspaceConfig).toContain("- cursor");
  const pluginConfig = await readFile(join(root, ".skillset/plugins/cursor-native/skillset.yaml"), "utf8");
  expect(pluginConfig).toContain("name: cursor-native");
  expect(pluginConfig).toContain("path: .");
  expect(await exists(join(root, ".skillset/plugins/cursor-native/.cursor-plugin/plugin.json"))).toBe(true);
  expect(await exists(join(root, ".skillset/plugins/cursor-native/skills/helper/SKILL.md"))).toBe(true);
});

test("adopt carries import render results into the persisted report", async () => {
  const root = await fixture({
    ".claude/skills/native/SKILL.md":
      "---\nname: native\ndescription: Native skill.\nallowed-tools:\n  - Read\ndisable-model-invocation: true\n---\n\nBody.\n",
  });

  const report = await adoptSkillset(root, { targets: ["claude"], write: true });
  const importOutcome = expect.objectContaining({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: "import-preserved-target-native-frontmatter",
        path: ".skillset/skills/native/SKILL.md",
      }),
    ]),
    featureId: "tools-policy",
    sourceUnit: "skill:native",
    status: "target_native",
    target: "claude",
  });

  expect(report.ok).toBe(true);
  expect(report.imports[0]?.renderResults).toContainEqual(importOutcome);
  expect(report.renderResults).toContainEqual(importOutcome);

  const json = JSON.parse(await readFile(cachePath(root, join(ADOPT_REPORT_DIR, "report.json")), "utf8")) as {
    renderResults: readonly unknown[];
  };
  expect(json.renderResults).toContainEqual(importOutcome);
});

test("adopt carries native hook lift diagnostics into the persisted report", async () => {
  const hooks = {
    hooks: {
      SessionStart: [
        {
          hooks: [{ command: "echo session", type: "command" }],
        },
      ],
    },
  };
  const root = await fixture({
    ".claude-plugin/plugin.json": JSON.stringify({
      name: "native-hooks",
      version: "1.0.0",
    }),
    "hooks/hooks.json": JSON.stringify(hooks, null, 2),
  });

  const report = await adoptSkillset(root, { targets: ["claude"], write: true });
  const importOutcome = expect.objectContaining({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: "import-native-hook-lift-candidate",
        message: expect.stringContaining("lossless-adaptive for claude"),
        path: ".skillset/plugins/native-hooks/hooks/hooks.json#/SessionStart/0",
      }),
    ]),
    featureId: "plugin-hooks",
    sourceUnit: "plugin.native-hooks.feature:hooks",
    status: "target_native",
    target: "claude",
  });

  expect(report.ok).toBe(true);
  expect(report.imports.find((result) => result.candidate.kind === "plugin")?.renderResults).toContainEqual(importOutcome);
  expect(report.renderResults).toContainEqual(importOutcome);

  const json = JSON.parse(await readFile(cachePath(root, join(ADOPT_REPORT_DIR, "report.json")), "utf8")) as {
    renderResults: readonly unknown[];
  };
  expect(json.renderResults).toContainEqual(importOutcome);
});

test("adopt preserves survey skip outcomes when imported source cannot load", async () => {
  const root = await fixture({
    ".claude/commands/x.md": "---\ndescription: Project command.\n---\n\nDo x.\n",
    ".claude/skills/bad/SKILL.md":
      "---\nname: bad\ndescription: Uses a missing partial.\n---\n\n{{> missing}}\n",
  });

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(false);
  expect(report.buildError).toBeUndefined();
  expect(report.imports[0]?.detail).toContain("named partial missing");
  expect(report.surveySkips.map((skip) => skip.path)).toEqual([".claude/commands"]);
  expect(report.renderResults).toContainEqual(
    expect.objectContaining({
      featureId: "target-native-islands",
      sourceUnit: "claude.commands:commands",
      status: "intentionally_skipped",
      target: "claude",
    })
  );

  const markdown = await readFile(cachePath(root, join(ADOPT_REPORT_DIR, "report.md")), "utf8");
  expect(markdown).toContain("### Render results");
  expect(markdown).toContain("claude intentionally_skipped:");
});

test("adopt records an instructions collision as a failed import without throwing", async () => {
  const root = await fixture({
    ...MARKETPLACE_FIXTURE,
    ".skillset/rules/agents.md": "pre-existing\n",
  });

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(false);
  const failed = report.imports.find((result) => result.candidate.kind === "instructions");
  expect(failed?.ok).toBe(false);
  expect(failed?.detail).toContain("already exists");
  expect(await readFile(join(root, ".skillset/rules/agents.md"), "utf8")).toBe(
    "pre-existing\n"
  );
  // The collision must not block the rest of the migration.
  expect(report.imports.find((result) => result.candidate.kind === "plugin")?.ok).toBe(true);
  expect(report.cutover).toEqual([]);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("## Failed imports");
});

test("adopt fails on lint errors and the CLI exits nonzero", async () => {
  const files = {
    ".claude/skills/bad/SKILL.md":
      "---\nname: bad\ndescription: Uses Claude dynamic context.\n---\n\nUse ${CLAUDE_SKILL_DIR} here.\n",
  };

  const report = await adoptSkillset(await fixture(files), { write: true });
  expect(report.ok).toBe(false);
  expect(
    report.lintIssues.some(
      (issue) => issue.severity === "error" && issue.code === "codex-claude-dynamic-context"
    )
  ).toBe(true);
  const markdown = renderAdoptReportMarkdown(report, { rootPath: "ignored" });
  expect(markdown).toContain("- result: fail");
  expect(markdown).toContain("codex-claude-dynamic-context");

  const cliRoot = await fixture(files);
  const result = await runSkillsetCli("init", "--from", cliRoot, "--adopt", "all", "--yes");
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("FAIL lint");
  expect(result.stdout).toContain("adopt found problems");
});

test("adopt previews transforms and declares dialect on transformable imports", async () => {
  const skillBody =
    "Skills live in .claude/skills/x today.\n\nPass $ARGUMENTS along, then ask @reviewer.\n";
  const root = await fixture({
    ".claude/skills/x/SKILL.md": `---\nname: x\ndescription: Transform preview fixture.\n---\n\n${skillBody}`,
  });

  const report = await adoptSkillset(root, { write: true });

  const preview = report.transformPreviews.find(
    (entry) => entry.path === ".skillset/skills/x/SKILL.md"
  );
  expect(preview).toBeDefined();
  expect(
    preview?.matches.map((match) => [match.intent, match.text, match.lowering, match.codexForm])
  ).toEqual([
    ["path.skills-dir", ".claude/skills", "bidirectional", ".agents/skills"],
    ["invoke.subagent", "@reviewer", "to-codex", "the `reviewer` agent"],
  ]);

  // Transformable matches present -> the imported frontmatter declares the
  // dialect; raw Claude arguments are normalized to Skillset source markers.
  expect(preview?.dialectDeclared).toBe(true);
  const imported = await readFile(join(root, ".skillset/skills/x/SKILL.md"), "utf8");
  expect(imported).toStartWith("---\ndialect: claude\n");
  expect(imported).toContain("Skills live in .claude/skills/x today.");
  expect(imported).toContain("Pass {{$ARGUMENTS}} along, then ask @reviewer.");

  const markdown = renderAdoptReportMarkdown(report, { rootPath: root });
  expect(markdown).toContain("## Transforms (preview)");
  expect(markdown).toContain("`dialect: claude` declared.");
  expect(markdown).toContain("`.claude/skills` -> `.agents/skills` (path.skills-dir)");
  expect(markdown).not.toContain("No faithful Codex lowering:");
  expect(markdown).not.toContain("`$ARGUMENTS` (dynamic.arguments)");

  // No recognized constructs -> the section is omitted entirely.
  const quietReport = await adoptSkillset(await fixture(MARKETPLACE_FIXTURE), { write: true });
  expect(quietReport.transformPreviews).toEqual([]);
  expect(renderAdoptReportMarkdown(quietReport, { rootPath: "ignored" })).not.toContain(
    "## Transforms (preview)"
  );
});

test("adopt leaves files with only no-lowering matches undeclared", async () => {
  const skillSource =
    "---\nname: env-only\ndescription: Only dynamic context.\n---\n\nPass ${CLAUDE_SKILL_DIR} along.\n";
  const root = await fixture({
    ".claude/skills/env-only/SKILL.md": skillSource,
  });

  const report = await adoptSkillset(root, { write: true });

  const preview = report.transformPreviews.find(
    (entry) => entry.path === ".skillset/skills/env-only/SKILL.md"
  );
  expect(preview?.dialectDeclared).toBe(false);
  expect(preview?.matches.every((match) => match.lowering === "none")).toBe(true);
  // Nothing would translate, so no dialect is declared; source-origin metadata
  // is still recorded and the body stays untouched.
  const imported = await readFile(join(root, ".skillset/skills/env-only/SKILL.md"), "utf8");
  expect(imported).not.toContain("dialect: claude");
  expect(imported).toContain("path: .claude/skills/env-only/SKILL.md");
  expect(imported).toContain("Pass ${CLAUDE_SKILL_DIR} along.");
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).not.toContain(
    "`dialect: claude` declared."
  );
});

test("adopt normalizes Claude arguments to Skillset prompt argument placeholders", async () => {
  const root = await fixture({
    ".claude/skills/args/SKILL.md":
      "---\nname: args\ndescription: Uses $ARGUMENTS literally in metadata.\n---\n\nRun $ARGUMENTS, $ARGUMENTS[0], $ARGUMENTS[1], and $ARGUMENTS.limit.\nKeep {{$ARGUMENTS}} literal.\n",
  });

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(true);
  expect(report.transformPreviews).toEqual([]);
  const imported = await readFile(join(root, ".skillset/skills/args/SKILL.md"), "utf8");
  expect(imported).toContain("description: Uses $ARGUMENTS literally in metadata.");
  expect(imported).toContain("Run {{$ARGUMENTS}}, {{$ARGUMENTS[0]}}, {{$ARGUMENTS[1]}}, and {{$ARGUMENTS.limit}}.");
  expect(imported).toContain("Keep {{$ARGUMENTS}} literal.");
  expect(imported).not.toContain("{{{{$ARGUMENTS}}}}");
});

test("adopt leaves unsupported Claude argument bracket forms raw", async () => {
  const root = await fixture({
    ".claude/skills/args/SKILL.md":
      "---\nname: args\ndescription: Uses unsupported command arguments.\n---\n\nRun $ARGUMENTS[foo].\n",
  });

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(false);
  expect(
    report.lintIssues.some(
      (issue) => issue.severity === "error" && issue.code === "codex-claude-dynamic-context"
    )
  ).toBe(true);
  const imported = await readFile(join(root, ".skillset/skills/args/SKILL.md"), "utf8");
  expect(imported).toContain("Run $ARGUMENTS[foo].");
  expect(imported).not.toContain("{{$ARGUMENTS[foo]}}");
});

test("adopt prepends a frontmatter block to transformable instruction imports", async () => {
  const instructions = "# Conventions\n\nKeep CLAUDE.md current.\n";
  const root = await fixture({ "CLAUDE.md": instructions });

  const report = await adoptSkillset(root, { write: true });

  const preview = report.transformPreviews.find(
    (entry) => entry.path === ".skillset/rules/claude.md"
  );
  expect(preview?.dialectDeclared).toBe(true);
  expect(await readFile(join(root, ".skillset/rules/claude.md"), "utf8")).toBe(
    `---\ndialect: claude\nskillset:\n  origin:\n    path: CLAUDE.md\n---\n\n${instructions}`
  );
  expect(report.buildError).toBeUndefined();
});

test("adopt CLI without --yes prints the survey and writes nothing", async () => {
  const root = await fixture(MARKETPLACE_FIXTURE);
  const before = await walkFiles(root);

  const result = await runSkillsetCli("init", "--from", root, "--adopt", "all");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("import candidate instructions AGENTS.md");
  expect(result.stdout).toContain("import candidate plugin plugins/demo");
  expect(result.stdout).toContain("skipped commands .claude/commands");
  expect(result.stdout).toContain("rerun init with --adopt and --yes");
  expect(await walkFiles(root)).toEqual(before);
});

test("adopt CLI rejects isolation and build-shape flags", async () => {
  const isolated = await runSkillsetCli("init", "--from", ".", "--adopt", "all", "--isolated");
  expect(isolated.exitCode).toBe(1);
  expect(isolated.stderr).toContain("--isolated is only supported with build, diff, or verify");

  const scoped = await runSkillsetCli("init", "--from", ".", "--adopt", "all", "--scope", "plugins");
  expect(scoped.exitCode).toBe(1);
  expect(scoped.stderr).toContain("not supported with adopt");

  const updated = await runSkillsetCli("init", "--from", ".", "--adopt", "all", "--updated");
  expect(updated.exitCode).toBe(1);
  expect(updated.stderr).toContain("not supported with adopt");

  const include = await runSkillsetCli("init", "--from", ".", "--adopt", "all", "--include", "ci");
  expect(include.exitCode).toBe(0);
  expect(include.stdout).toContain(".github/workflows/skillset-ci.yml");
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-adopt-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), content);
  }
  return root;
}

async function gitFixture(files: Record<string, string>): Promise<string> {
  const root = await fixture(files);
  await runGit(root, ["init"]);
  await runGit(root, ["add", "."]);
  await runGit(root, [
    "-c",
    "user.name=Skillset Test",
    "-c",
    "user.email=skillset@example.com",
    "commit",
    "-m",
    "fixture",
  ]);
  return root;
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${stdout}${stderr}`.trim());
  }
}

async function walkFiles(root: string): Promise<ReadonlySet<string>> {
  const files = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.add(relative(root, path).replaceAll("\\", "/"));
    }
  };
  await walk(root);
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

async function runSkillsetCliIn(cwd: string, ...args: readonly string[]): ReturnType<typeof runSkillsetCli> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

function cachePath(root: string, logicalPath: string): string {
  return resolveOperationalPath(createOperationalPathContext(root), logicalPath);
}
