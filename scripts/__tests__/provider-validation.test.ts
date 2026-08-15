import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  buildValidationCommands,
  buildNetworkIsolatedArgv,
  enumerateProviderArtifacts,
  executeValidationCommands,
  normalizeProviderValidationReport,
  ProviderValidationFailure,
  renderProviderValidationReport,
  runHostedProviderValidation,
  type ProviderArtifactInventory,
} from "../provider-validation";
import {
  formatAcquisitionFailureDiagnostic,
  stageValidationInputs,
} from "../provider-validation-hosted";

describe("SET-463 hosted provider validation orchestration", () => {
  test("formats acquisition failures with an actual newline", () => {
    const diagnostic = formatAcquisitionFailureDiagnostic(
      ["validator", "--check"],
      "first line\nsecond line\n"
    );

    expect(diagnostic).toBe(
      "skillset: acquisition command failed: validator --check\nfirst line\nsecond line\n"
    );
    expect(diagnostic).not.toContain("\\n");
  });

  test("enumerates canonical lock items and fixed root marketplaces without globs", async () => {
    const root = await fixtureRoot();
    const canonicalRoot = await realpath(root);
    const inventory = await enumerateProviderArtifacts(root);

    expect(inventory.claudePlugins).toEqual([
      join(canonicalRoot, "plugins/demo/claude"),
    ]);
    expect(inventory.codexPlugins).toEqual([
      join(canonicalRoot, "plugins/demo/codex"),
    ]);
    expect(inventory.cursorPlugins).toEqual([
      join(canonicalRoot, "plugins/demo/cursor"),
    ]);
    expect(inventory.skills).toEqual([
      join(canonicalRoot, ".agents/skills/standalone/SKILL.md"),
      join(canonicalRoot, "plugins/demo/claude/skills/demo/SKILL.md"),
      join(canonicalRoot, "plugins/demo/codex/skills/demo/SKILL.md"),
      join(canonicalRoot, "plugins/demo/cursor/skills/demo/SKILL.md"),
    ]);
    expect(inventory.claudeMarketplaces).toEqual([
      join(canonicalRoot, ".claude-plugin/marketplace.json"),
    ]);
    expect(inventory.cursorMarketplaces).toEqual([
      join(canonicalRoot, ".cursor-plugin/marketplace.json"),
    ]);
  });

  test("rejects symlink path components before resolving outside the repository", async () => {
    const root = await fixtureRoot();
    const outside = await mkdtemp(join(tmpdir(), "skillset-provider-outside-"));
    await writeFile(join(outside, "SKILL.md"), "outside");
    await symlink(outside, join(root, ".agents/skills/escape"));
    await writeLock(
      join(root, ".agents/skills/skillset.lock"),
      ".agents/skills",
      [{ kind: "standalone-skill", outputPath: "escape/SKILL.md" }]
    );

    await expect(enumerateProviderArtifacts(root)).rejects.toThrow(
      "rejects symlink path"
    );
  });

  test("rejects nested symlinks inside generated plugin and skill trees", async () => {
    const root = await fixtureRoot();
    await symlink(
      join(root, ".cursor-plugin/marketplace.json"),
      join(root, "plugins/demo/codex/nested-link")
    );

    await expect(enumerateProviderArtifacts(root)).rejects.toThrow(
      "rejects symlink"
    );
  });

  test("constructs fixed offline argv and one negative canary for every lane", () => {
    const inventory = sampleInventory();
    const commands = buildValidationCommands(
      inventory,
      {
        agentSkills: "/tmp/tools/skills-ref",
        claude: "/tmp/tools/claude",
        codexPython: "/tmp/tools/python",
        codexValidator: "/tmp/tools/validate_plugin.py",
        cursor: "/tmp/tools/cursor",
      },
      {
        agentCanary: "/tmp/stage/canary/agent",
        claudeCanary: "/tmp/stage/canary/claude",
        codexCanary: "/tmp/stage/canary/codex",
        cursorCanary: "/tmp/stage/canary/cursor",
        cursorRoots: ["/tmp/stage/cursor-real", "/tmp/stage/cursor-synthetic"],
      }
    );

    expect(
      commands
        .filter(({ expect }) => expect === "failure")
        .map(({ lane }) => lane)
        .toSorted()
    ).toEqual([
      "agent-skills-reference",
      "claude-product",
      "codex-authoring",
      "cursor-authoring",
    ]);
    expect(
      commands.every(({ argv }) => !["bash", "sh", "zsh"].includes(argv[0]))
    ).toBe(true);
    expect(
      commands.every(
        ({ env }) =>
          env?.npm_config_offline === "true" && env.PIP_NO_INDEX === "1"
      )
    ).toBe(true);
    expect(
      commands.every(({ cwd }) => cwd?.startsWith("/tmp/stage/") === true)
    ).toBe(true);
    expect(commands.some(({ cwd }) => cwd?.startsWith("/repo") === true)).toBe(
      false
    );
    expect(
      commands.find(
        ({ lane, expect }) => lane === "claude-product" && expect === "success"
      )?.argv
    ).toEqual([
      "node",
      "/tmp/tools/claude",
      "plugin",
      "validate",
      "/tmp/stage/plugins/demo/claude",
      "--strict",
    ]);
    expect(
      commands.find(({ lane }) => lane === "codex-authoring")?.argv
    ).toEqual([
      "/tmp/tools/python",
      "/tmp/tools/validate_plugin.py",
      "/tmp/stage/plugins/demo/codex",
    ]);
  });

  test("propagates valid failures, no-op canaries, and process launch failures", async () => {
    const commands = buildValidationCommands(
      sampleInventory(),
      {
        agentSkills: "/tools/skills-ref",
        claude: "/tools/claude",
        codexPython: "/tools/python",
        codexValidator: "/tools/validate.py",
        cursor: "/tools/cursor",
      },
      {
        agentCanary: "/stage/canary/agent",
        claudeCanary: "/stage/canary/claude",
        codexCanary: "/stage/canary/codex",
        cursorCanary: "/stage/canary/cursor",
        cursorRoots: ["/stage/cursor"],
      }
    );
    let calls = 0;
    try {
      await executeValidationCommands(commands, async (command) => {
        calls += 1;
        expect(command.cwd).toBeDefined();
        expect(command.cwd).not.toBe(process.cwd());
        if (
          command.lane === "codex-authoring" &&
          command.expect === "success"
        ) {
          return { exitCode: 1, stderr: "invalid", stdout: "" };
        }
        if (
          command.lane === "cursor-authoring" &&
          command.expect === "failure"
        ) {
          return { exitCode: 0, stderr: "", stdout: "no-op" };
        }
        if (
          command.lane === "agent-skills-reference" &&
          command.expect === "success"
        ) {
          throw new Error("spawn ENOENT");
        }
        return {
          exitCode: command.expect === "success" ? 0 : 1,
          stderr: "",
          stdout: "",
        };
      });
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderValidationFailure);
      const failure = error as ProviderValidationFailure;
      expect(failure.report.ok).toBe(false);
      expect(failure.failures.join(" ")).toContain("spawn ENOENT");
      expect(failure.failures.join(" ")).toContain("expected failure, exit 0");
      expect(renderProviderValidationReport(failure.report)).toContain(
        "| codex-authoring | codex |"
      );
    }
    expect(calls).toBe(commands.length);
  });

  test("bounds validator stdout and stderr with deterministic actionable evidence", async () => {
    const commands = [
      {
        argv: ["validator", "stderr"] as const,
        cwd: "/stage/stderr",
        env: {},
        expect: "success" as const,
        lane: "codex-authoring" as const,
        subject: "large stderr",
      },
      {
        argv: ["validator", "stdout"] as const,
        cwd: "/stage/stdout",
        env: {},
        expect: "success" as const,
        lane: "cursor-authoring" as const,
        subject: "large stdout",
      },
    ];
    const execute = async (): Promise<ProviderValidationFailure> => {
      try {
        await executeValidationCommands(commands, async ({ subject }) => ({
          exitCode: 1,
          stderr:
            subject === "large stderr"
              ? `stderr-start\n${"e".repeat(10_000)}\nstderr-tail-actionable`
              : "",
          stdout:
            subject === "large stdout"
              ? `stdout-start\n${"o".repeat(10_000)}\nstdout-tail-actionable`
              : "",
        }));
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderValidationFailure);
        return error as ProviderValidationFailure;
      }
      throw new Error("expected bounded validation failure");
    };

    const first = await execute();
    const second = await execute();
    expect(first.report.failures).toEqual(second.report.failures);
    expect(first.failures).toEqual(
      first.report.failures.map(({ diagnostic }) => diagnostic)
    );
    for (const { diagnostic } of first.report.failures) {
      expect(diagnostic.length).toBeLessThanOrEqual(500);
      expect(diagnostic).toContain("[truncated]");
      expect(diagnostic).not.toContain("\n");
    }
    expect(first.report.failures[0]?.diagnostic).toContain(
      "stderr-tail-actionable"
    );
    expect(first.report.failures[1]?.diagnostic).toContain(
      "stdout-tail-actionable"
    );
    const markdown = renderProviderValidationReport(first.report);
    expect(markdown).toContain("stderr-tail-actionable");
    expect(markdown).toContain("stdout-tail-actionable");
    expect(markdown).not.toContain("e".repeat(501));
    expect(markdown).not.toContain("o".repeat(501));
  });

  test("hard-wraps validators in a no-network namespace with a clean environment", () => {
    const argv = buildNetworkIsolatedArgv(
      {
        argv: ["node", "/tools/validator.js"],
        cwd: "/runner/temp/stage/plugin",
        env: {
          HOME: "/runner/temp/home",
          XDG_CONFIG_HOME: "/runner/temp/config",
        },
        expect: "success",
        lane: "claude-product",
        subject: "staged plugin",
      },
      1001,
      1002
    );

    expect(argv.slice(0, 8)).toEqual([
      "/usr/bin/sudo",
      "--non-interactive",
      "/usr/bin/unshare",
      "--net",
      "--setuid=1001",
      "--setgid=1002",
      "--",
      "/usr/bin/env",
    ]);
    expect(argv).toContain("-i");
    expect(argv).toContain("HOME=/runner/temp/home");
    expect(argv).toContain("XDG_CONFIG_HOME=/runner/temp/config");
  });

  test("stages every positive validator input outside the checkout", async () => {
    const root = await fixtureRoot();
    const inventory = await enumerateProviderArtifacts(root);
    const temp = await mkdtemp(join(tmpdir(), "skillset-provider-stage-"));
    const cursor = join(temp, "cursor-tool");
    for (const path of ["scripts", "schemas", "node_modules"])
      await mkdir(join(cursor, path), { recursive: true });
    for (const path of ["package.json", "package-lock.json"])
      await writeFile(join(cursor, path), "{}\n");
    await writeFile(
      join(cursor, "scripts/validate-plugins.mjs"),
      "verified-validator\n"
    );

    const staged = await stageValidationInputs(root, temp, inventory, {
      agentSkills: join(temp, "agent-tool"),
      claude: join(temp, "claude-tool"),
      codexPython: join(temp, "python"),
      codexValidator: join(temp, "codex-validator"),
      cursor,
    });

    for (const paths of Object.values(staged.inventory)) {
      for (const path of paths) {
        expect(path.startsWith(join(temp, "stage"))).toBe(true);
        expect(path.startsWith(root)).toBe(false);
      }
    }
    expect(staged.inventory.skills).toHaveLength(inventory.skills.length);
    for (const skill of staged.inventory.skills) {
      const source = await readFile(skill, "utf8");
      const frontmatterName = source.match(/^name:\s*(.+)$/mu)?.[1];
      expect(frontmatterName).toBe(basename(dirname(skill)));
    }
    expect(
      new Set(staged.inventory.skills.map((skill) => dirname(skill))).size
    ).toBe(staged.inventory.skills.length);
    const agentCanary = await readFile(
      join(staged.agentCanary, "SKILL.md"),
      "utf8"
    );
    expect(agentCanary.match(/^name:\s*(.+)$/mu)?.[1]).toBe(
      basename(staged.agentCanary)
    );
    expect(agentCanary).not.toMatch(/^description:/mu);
    for (const root of [...staged.cursorRoots, staged.cursorCanary]) {
      expect(
        await readFile(join(root, "scripts/validate-plugins.mjs"), "utf8")
      ).toBe("verified-validator\n");
    }
  });

  test("rejects Cursor marketplace sources that shadow the pinned validator", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(
      join(root, "scripts/validate-plugins.mjs"),
      "process.exit(0)\n"
    );
    await writeFile(
      join(root, ".cursor-plugin/marketplace.json"),
      `${JSON.stringify({
        name: "tamper",
        plugins: [{ name: "tamper", source: "scripts/validate-plugins.mjs" }],
      })}\n`
    );
    const inventory = await enumerateProviderArtifacts(root);
    const temp = await mkdtemp(join(tmpdir(), "skillset-provider-tamper-"));
    const cursor = join(temp, "cursor-tool");
    for (const path of ["scripts", "schemas", "node_modules"]) {
      await mkdir(join(cursor, path), { recursive: true });
    }
    for (const path of ["package.json", "package-lock.json"]) {
      await writeFile(join(cursor, path), "{}\n");
    }
    await writeFile(
      join(cursor, "scripts/validate-plugins.mjs"),
      "verified-validator\n"
    );

    await expect(
      stageValidationInputs(root, temp, inventory, {
        agentSkills: join(temp, "agent-tool"),
        claude: join(temp, "claude-tool"),
        codexPython: join(temp, "python"),
        codexValidator: join(temp, "codex-validator"),
        cursor,
      })
    ).rejects.toThrow("shadows the pinned validator");
  });

  test("rejects marketplace source paths that resolve differently under staging", async () => {
    for (const provider of ["claude", "cursor"] as const) {
      const root = await fixtureRoot();
      const marketplacePath = join(
        root,
        `.${provider}-plugin/marketplace.json`
      );
      const source = `nested/../../${basename(root)}/plugins/demo/${provider}`;
      await writeFile(
        marketplacePath,
        `${JSON.stringify({
          name: "escape",
          plugins: [{ name: "escape", source }],
        })}\n`
      );
      const inventory = await enumerateProviderArtifacts(root);
      const temp = await mkdtemp(join(tmpdir(), "skillset-provider-escape-"));
      const cursor = await fixtureCursorTool(temp);

      await expect(
        stageValidationInputs(root, temp, inventory, {
          agentSkills: join(temp, "agent-tool"),
          claude: join(temp, "claude-tool"),
          codexPython: join(temp, "python"),
          codexValidator: join(temp, "codex-validator"),
          cursor,
        })
      ).rejects.toThrow("portable repository-relative path");
      expect(await Bun.file(join(temp, "stage", basename(root))).exists()).toBe(
        false
      );
    }
  });

  test("rejects platform-specific marketplace source separators", async () => {
    for (const provider of ["claude", "cursor"] as const) {
      for (const source of ["plugins\\\\demo\\\\plugin", "C:plugin"]) {
        const root = await fixtureRoot();
        await writeFile(
          join(root, `.${provider}-plugin/marketplace.json`),
          `${JSON.stringify({
            name: "platform-specific",
            plugins: [{ name: "platform-specific", source }],
          })}\n`
        );
        const inventory = await enumerateProviderArtifacts(root);
        const temp = await mkdtemp(
          join(tmpdir(), "skillset-provider-platform-")
        );

        await expect(
          stageValidationInputs(root, temp, inventory, {
            agentSkills: join(temp, "agent-tool"),
            claude: join(temp, "claude-tool"),
            codexPython: join(temp, "python"),
            codexValidator: join(temp, "codex-validator"),
            cursor: await fixtureCursorTool(temp),
          })
        ).rejects.toThrow("portable repository-relative path");
      }
    }
  });

  test("normalizes the deepest temporary path before RUNNER_TEMP", () => {
    const report = normalizeProviderValidationReport(
      {
        failures: [
          {
            diagnostic:
              "/runner/temp/skillset-provider-validation-random/downloads/tool.tgz",
            lane: "all",
            stage: "acquisition",
          },
        ],
        limitations: [],
        ok: false,
        rows: [],
      },
      [
        ["/runner/temp", "$RUNNER_TEMP"],
        [
          "/runner/temp/skillset-provider-validation-random",
          "$VALIDATION_TEMP",
        ],
      ]
    );

    expect(report.failures[0]?.diagnostic).toBe(
      "$VALIDATION_TEMP/downloads/tool.tgz"
    );
    expect(report.failures[0]?.diagnostic).not.toContain("random");
  });

  test("writes deterministic failure evidence for inventory failures", async () => {
    const runnerTemp = await mkdtemp(
      join(tmpdir(), "skillset-provider-report-")
    );
    const root = await mkdtemp(join(tmpdir(), "skillset-provider-invalid-"));
    const reportPath = join(runnerTemp, "provider-validation.md");
    const previousActions = process.env.GITHUB_ACTIONS;
    const previousTemp = process.env.RUNNER_TEMP;
    process.env.GITHUB_ACTIONS = "true";
    process.env.RUNNER_TEMP = runnerTemp;
    try {
      await expect(
        runHostedProviderValidation(root, reportPath)
      ).rejects.toThrow();
      const report = await readFile(reportPath, "utf8");
      expect(report).toContain("## Failure evidence");
      expect(report).toContain("**inventory / all:**");
      expect(report).toContain("| not-run |");
    } finally {
      restoreEnvironment("GITHUB_ACTIONS", previousActions);
      restoreEnvironment("RUNNER_TEMP", previousTemp);
    }
  });

  test("rejects an existing symlink report target", async () => {
    const runnerTemp = await mkdtemp(
      join(tmpdir(), "skillset-provider-report-")
    );
    const root = await mkdtemp(join(tmpdir(), "skillset-provider-invalid-"));
    const outside = join(
      await mkdtemp(join(tmpdir(), "skillset-outside-")),
      "report"
    );
    await writeFile(outside, "unchanged");
    const reportPath = join(runnerTemp, "provider-validation.md");
    await symlink(outside, reportPath);
    const previousActions = process.env.GITHUB_ACTIONS;
    const previousTemp = process.env.RUNNER_TEMP;
    process.env.GITHUB_ACTIONS = "true";
    process.env.RUNNER_TEMP = runnerTemp;
    try {
      await expect(
        runHostedProviderValidation(root, reportPath)
      ).rejects.toThrow("rejects symlink report target");
      expect(await readFile(outside, "utf8")).toBe("unchanged");
    } finally {
      restoreEnvironment("GITHUB_ACTIONS", previousActions);
      restoreEnvironment("RUNNER_TEMP", previousTemp);
    }
  });
});

function sampleInventory(): ProviderArtifactInventory {
  return {
    claudeMarketplaces: ["/tmp/stage/.claude-plugin/marketplace.json"],
    claudePlugins: ["/tmp/stage/plugins/demo/claude"],
    codexPlugins: ["/tmp/stage/plugins/demo/codex"],
    cursorMarketplaces: ["/tmp/stage/.cursor-plugin/marketplace.json"],
    cursorPlugins: ["/tmp/stage/plugins/demo/cursor"],
    skills: ["/tmp/stage/.agents/skills/demo/SKILL.md"],
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-validation-"));
  for (const path of [
    ".agents/skills/standalone",
    ".claude-plugin",
    ".cursor-plugin",
    "plugins/demo/claude/.claude-plugin",
    "plugins/demo/claude/skills/demo",
    "plugins/demo/codex/.codex-plugin",
    "plugins/demo/codex/skills/demo",
    "plugins/demo/cursor/.cursor-plugin",
    "plugins/demo/cursor/skills/demo",
  ])
    await mkdir(join(root, path), { recursive: true });
  for (const path of [
    ".agents/skills/standalone/SKILL.md",
    "plugins/demo/claude/.claude-plugin/plugin.json",
    "plugins/demo/claude/skills/demo/SKILL.md",
    "plugins/demo/codex/.codex-plugin/plugin.json",
    "plugins/demo/codex/skills/demo/SKILL.md",
    "plugins/demo/cursor/.cursor-plugin/plugin.json",
    "plugins/demo/cursor/skills/demo/SKILL.md",
  ])
    await writeFile(
      join(root, path),
      path.endsWith(".json")
        ? '{"name":"demo","version":"1.0.0"}\n'
        : `---\nname: ${basename(dirname(path))}\ndescription: demo\n---\n`
    );
  await writeFile(
    join(root, ".claude-plugin/marketplace.json"),
    `${JSON.stringify({
      name: "demo",
      plugins: [{ name: "demo", source: "./plugins/demo/claude" }],
    })}\n`
  );
  await writeFile(
    join(root, ".cursor-plugin/marketplace.json"),
    `${JSON.stringify({
      name: "demo",
      plugins: [{ name: "demo", source: "plugins/demo/cursor" }],
    })}\n`
  );
  await writeLock(
    join(root, ".agents/skills/skillset.lock"),
    ".agents/skills",
    [{ kind: "standalone-skill", outputPath: "standalone/SKILL.md" }]
  );
  await writeLock(join(root, "plugins/skillset.lock"), "plugins", [
    { kind: "plugin", outputPath: "demo/claude/.claude-plugin/plugin.json" },
    { kind: "plugin-skill", outputPath: "demo/claude/skills/demo/SKILL.md" },
    { kind: "plugin", outputPath: "demo/codex/.codex-plugin/plugin.json" },
    { kind: "plugin-skill", outputPath: "demo/codex/skills/demo/SKILL.md" },
    { kind: "plugin", outputPath: "demo/cursor/.cursor-plugin/plugin.json" },
    { kind: "plugin-skill", outputPath: "demo/cursor/skills/demo/SKILL.md" },
  ]);
  for (const path of [
    ".claude/skills/skillset.lock",
    ".cursor/skills/skillset.lock",
  ]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeLock(join(root, path), path.split("/skillset.lock")[0]!, []);
  }
  return root;
}

async function fixtureCursorTool(temp: string): Promise<string> {
  const cursor = join(temp, "cursor-tool");
  for (const path of ["scripts", "schemas", "node_modules"]) {
    await mkdir(join(cursor, path), { recursive: true });
  }
  for (const path of ["package.json", "package-lock.json"]) {
    await writeFile(join(cursor, path), "{}\n");
  }
  await writeFile(
    join(cursor, "scripts/validate-plugins.mjs"),
    "verified-validator\n"
  );
  return cursor;
}

async function writeLock(
  path: string,
  outputRoot: string,
  items: readonly unknown[]
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({ generatedBy: "skillset@0.1.0", items, outputRoot }, null, 2)}\n`
  );
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
