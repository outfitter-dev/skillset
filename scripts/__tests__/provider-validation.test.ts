import { describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  validateHostedCodexMarketplaceConsumers,
  type ProviderArtifactInventory,
} from "../provider-validation";
import { validateCodexMarketplaceConsumer } from "../provider-validation-artifacts";
import { validateAgentPluginConformance } from "../provider-validation-agent-plugins";
import {
  formatAcquisitionFailureDiagnostic,
  stageValidationInputs,
} from "../provider-validation-hosted";
import { validateChatGptPluginConformance } from "../provider-validation-chatgpt";
import {
  stageCursorHookConformanceInputs,
  validateCursorHookConformance,
} from "../provider-validation-hooks";
import { createTestFixtureRoot } from "../test-helpers/fixture-root";

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

    expect(inventory.pluginPackages).toEqual([
      join(canonicalRoot, "plugins/demo"),
    ]);
    expect(inventory.claudePlugins).toEqual([
      join(canonicalRoot, "plugins/demo"),
    ]);
    expect(inventory.codexPlugins).toEqual([]);
    expect(inventory.cursorPlugins).toEqual([
      join(canonicalRoot, "plugins/demo"),
    ]);
    expect(inventory.skills).toEqual([
      join(canonicalRoot, ".agents/skills/standalone/SKILL.md"),
      join(canonicalRoot, "plugins/demo/skills/demo/SKILL.md"),
    ]);
    expect(inventory.claudeMarketplaces).toEqual([
      join(canonicalRoot, ".claude-plugin/marketplace.json"),
    ]);
    expect(inventory.codexMarketplaces).toEqual([
      join(canonicalRoot, ".agents/plugins/marketplace.json"),
    ]);
    expect(inventory.cursorMarketplaces).toEqual([
      join(canonicalRoot, ".cursor-plugin/marketplace.json"),
    ]);
  });

  test("runs the pinned Codex marketplace consumer with isolated ephemeral config", async () => {
    const root = await fixtureRoot();
    const codex = join(root, "fake-codex");
    await writeFile(
      codex,
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("codex-cli 0.154.0");
  process.exit(0);
}
if (!args.includes("--available") || !args.includes("marketplaces.skillset_validation.source_type=\\\"local\\\"")) {
  console.error("missing read-only marketplace consumer arguments");
  process.exit(2);
}
for (const key of ["CODEX_HOME", "HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
  if (!process.env[key]?.includes("skillset-codex-marketplace-consumer-")) {
    console.error(\`unisolated environment: \${key}\`);
    process.exit(3);
  }
}
for (const key of ["AWS_SECRET_ACCESS_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
  if (process.env[key]) {
    console.error(\`leaked secret: \${key}\`);
    process.exit(9);
  }
}
console.log(JSON.stringify({ available: [{ pluginId: "demo@demo" }], installed: [] }));
`
    );
    await chmod(codex, 0o755);
    const previousSecrets = plantUnrelatedSecrets();

    try {
    await expect(
      validateCodexMarketplaceConsumer(root, codex)
    ).resolves.toEqual({
      catalogName: "demo",
      codexVersion: "codex-cli 0.154.0",
      pluginIds: ["demo@demo"],
    });
    } finally {
      restoreUnrelatedSecrets(previousSecrets);
    }
  });

  test("runs staged Codex marketplace consumption through hosted production orchestration and records the receipt", async () => {
    const root = await fixtureRoot();
    const temp = await createTestFixtureRoot("skillset-codex-hosted-");
    const codex = join(temp, "fake-codex");
    await writeFile(
      codex,
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("codex-cli 0.154.0");
  process.exit(0);
}
const source = args.find((arg) => arg.startsWith("marketplaces.skillset_validation.source="));
const root = JSON.parse(source.split("=").slice(1).join("="));
const catalog = await Bun.file(root + "/.agents/plugins/marketplace.json").json();
const plugin = catalog.plugins[0];
if (!(await Bun.file(root + "/" + plugin.source.path + "/plugin.json").exists())) {
  console.error("local marketplace source was not staged");
  process.exit(2);
}
console.log(JSON.stringify({ available: [{ pluginId: plugin.name + "@" + catalog.name }] }));
`
    );
    await chmod(codex, 0o755);
    const tools = {
      agentSkills: join(temp, "agent-tool"),
      claude: join(temp, "claude-tool"),
      codex,
      codexPython: join(temp, "python"),
      codexValidator: join(temp, "codex-validator"),
      cursor: await fixtureCursorTool(temp),
    };
    const staged = await stageValidationInputs(
      root,
      temp,
      await enumerateProviderArtifacts(root),
      tools
    );

    const receipts = await validateHostedCodexMarketplaceConsumers(
      staged.codexMarketplaceRoots,
      tools.codex
    );
    const report = await executeValidationCommands(
      [],
      async () => {
        throw new Error("no validator command expected");
      },
      "2026-09-12T00:02:00.000Z",
      [],
      receipts
    );

    expect(receipts).toEqual([
      {
        catalogName: "demo",
        codexVersion: "codex-cli 0.154.0",
        pluginIds: ["demo@demo"],
      },
    ]);
    expect(
      report.rows.find(({ lane }) => lane === "codex-authoring")?.count
    ).toBe(1);
    expect(renderProviderValidationReport(report)).toContain(
      "| demo | codex-cli 0.154.0 | demo@demo |"
    );
  });

  test("rejects symlink path components before resolving outside the repository", async () => {
    const root = await fixtureRoot();
    const outside = await createTestFixtureRoot("skillset-provider-outside-");
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
      join(root, "plugins/demo/nested-link")
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
        codex: "/tmp/tools/codex",
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
        codex: "/tools/codex",
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
      const markdown = renderProviderValidationReport(failure.report);
      expect(markdown).toContain("| codex-authoring | codex |");
      expect(markdown).toContain("## Pin freshness");
      expect(markdown).toContain("| validation-current |");
    }
    expect(calls).toBe(commands.length);
  });

  test("validates every staged ChatGPT root manifest as internal authoring conformance", async () => {
    const temp = await createTestFixtureRoot("skillset-chatgpt-hosted-");
    const valid = join(temp, "valid");
    const invalid = join(temp, "invalid");
    await mkdir(valid, { recursive: true });
    await mkdir(invalid, { recursive: true });
    await writeFile(
      join(valid, "plugin.json"),
      `${JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        description: "Valid plugin.",
        extensions: { "com.openai": { interface: {} } },
        name: "valid",
        version: "1.0.0",
      })}\n`
    );
    await writeFile(
      join(invalid, "plugin.json"),
      `${JSON.stringify({ name: "invalid", unexpected: true })}\n`
    );

    const checks = await validateChatGptPluginConformance([valid, invalid]);

    expect(checks).toEqual([
      expect.objectContaining({
        id: "chatgpt-plugin-generated-manifest",
        result: "passed",
        target: "codex",
      }),
      expect.objectContaining({
        diagnostic: expect.stringContaining("unexpected"),
        id: "chatgpt-plugin-generated-manifest",
        result: "failed",
        target: "codex",
      }),
    ]);
  });

  test("reports generated Cursor hooks and the malformed-handler canary as internal authoring conformance", async () => {
    const temp = await createTestFixtureRoot("skillset-cursor-hooks-hosted-");
    const inputs = await stageCursorHookConformanceInputs(temp);
    const checks = await validateCursorHookConformance(inputs);

    expect(inputs.valid).toStartWith(join(temp, "stage"));
    expect(inputs.invalid).toStartWith(join(temp, "stage"));
    expect(JSON.parse(await readFile(inputs.valid, "utf8"))).toEqual({
      version: 1,
      hooks: {
        workspaceOpen: [
          { command: "echo hosted-hook-conformance", type: "command" },
        ],
      },
    });
    expect(checks).toEqual([
      {
        attribution: "Skillset internal",
        id: "cursor-hooks-generated-native",
        result: "passed",
        surface: "generated version:1 flat native hook file",
        target: "cursor",
      },
      {
        attribution: "Skillset internal",
        id: "cursor-hooks-malformed-flat",
        result: "passed",
        surface: "malformed flat handler rejection canary",
        target: "cursor",
      },
    ]);

    const report = await executeValidationCommands(
      [],
      async () => {
        throw new Error("no external command expected");
      },
      "2026-09-12T00:02:00.000Z",
      checks
    );
    const markdown = renderProviderValidationReport(report);
    expect(markdown).toContain("## Skillset internal authoring conformance");
    expect(markdown).toContain(
      "portable Agent Plugins manifests, ChatGPT root manifests, and Cursor hook files"
    );
    expect(markdown).toContain("not product or runtime proof");
    expect(markdown).toContain(
      "| cursor-hooks-generated-native | Skillset internal | cursor | generated version:1 flat native hook file | passed |"
    );
    expect(markdown).toContain(
      "| cursor-hooks-malformed-flat | Skillset internal | cursor | malformed flat handler rejection canary | passed |"
    );

    await writeFile(inputs.invalid, await readFile(inputs.valid));
    const failedChecks = await validateCursorHookConformance(inputs);
    await expect(
      executeValidationCommands(
        [],
        async () => {
          throw new Error("no external command expected");
        },
        "2026-09-12T00:02:00.000Z",
        failedChecks
      )
    ).rejects.toMatchObject({
      report: {
        failures: [
          expect.objectContaining({
            diagnostic: expect.stringContaining(
              "Skillset accepted a Cursor handler with a non-string command field"
            ),
            lane: "skillset-internal-authoring",
            stage: "validation",
          }),
        ],
        ok: false,
      },
    });
  });

  test("validates generated Agent Plugins manifests with a rejection canary", async () => {
    const root = await fixtureRoot();
    const checks = await validateAgentPluginConformance([
      join(root, "plugins/demo"),
    ]);

    expect(checks).toEqual([
      {
        attribution: "Skillset internal",
        id: "agent-plugins-generated-native",
        result: "passed",
        surface: "1 generated plugin.json file",
        target: "agent-plugins-1.0",
      },
      {
        attribution: "Skillset internal",
        id: "agent-plugins-unknown-field",
        result: "passed",
        surface: "unknown top-level field rejection canary",
        target: "agent-plugins-1.0",
      },
    ]);
  });

  test("rejects plugin manifests below the immediate package root", async () => {
    const root = await fixtureRoot();
    const lockPath = join(root, "plugins/skillset.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      items: { kind: string; outputPath: string }[];
    };
    await mkdir(join(root, "plugins/demo/nested"), { recursive: true });
    await writeFile(join(root, "plugins/demo/nested/plugin.json"), "{}\n");
    lock.items.push({
      kind: "plugin",
      outputPath: "demo/nested/plugin.json",
    });
    await writeFile(lockPath, `${JSON.stringify(lock)}\n`);

    await expect(enumerateProviderArtifacts(root)).rejects.toThrow(
      "unsupported generated plugin manifest plugins/demo/nested/plugin.json"
    );
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
    const temp = await createTestFixtureRoot("skillset-provider-stage-");
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
      codex: join(temp, "codex"),
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
    expect(staged.inventory.pluginPackages).toHaveLength(1);
    const [chatGptChecks, agentPluginChecks] = await Promise.all([
      validateChatGptPluginConformance(staged.inventory.pluginPackages),
      validateAgentPluginConformance(staged.inventory.pluginPackages),
    ]);
    expect(chatGptChecks).toEqual([
      expect.objectContaining({
        id: "chatgpt-plugin-generated-manifest",
        result: "passed",
      }),
    ]);
    expect(agentPluginChecks).toContainEqual(
      expect.objectContaining({
        id: "agent-plugins-generated-native",
        result: "passed",
      })
    );
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

  test("stages validator environments without unrelated secret-shaped ambient variables", async () => {
    const root = await fixtureRoot();
    const inventory = await enumerateProviderArtifacts(root);
    const temp = await mkdtemp(join(tmpdir(), "skillset-provider-stage-env-"));
    const previousSecrets = plantUnrelatedSecrets();
    try {
      const staged = await stageValidationInputs(root, temp, inventory, {
        agentSkills: join(temp, "agent-tool"),
        claude: join(temp, "claude-tool"),
        codex: join(temp, "codex"),
        codexPython: join(temp, "python"),
        codexValidator: join(temp, "codex-validator"),
        cursor: await fixtureCursorTool(temp),
      });
      expect(staged.environment.HOME).toBe(
        join(temp, "validation-environment", "home")
      );
      expect(staged.environment.CODEX_HOME).toBe(
        join(temp, "validation-environment", "config", "codex")
      );
      expect(staged.environment.CLAUDE_CONFIG_DIR).toBe(
        join(temp, "validation-environment", "config", "claude")
      );
      expect(staged.environment.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(staged.environment.ANTHROPIC_API_KEY).toBeUndefined();
      expect(staged.environment.GITHUB_TOKEN).toBeUndefined();
    } finally {
      restoreUnrelatedSecrets(previousSecrets);
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
    const temp = await createTestFixtureRoot("skillset-provider-tamper-");
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
        codex: join(temp, "codex"),
        codexPython: join(temp, "python"),
        codexValidator: join(temp, "codex-validator"),
        cursor,
      })
    ).rejects.toThrow("shadows the pinned validator");
  });

  test("rejects Codex marketplace catalogs that omit generated plugin sources", async () => {
    const root = await fixtureRoot();
    await writeFile(
      join(root, ".agents/plugins/marketplace.json"),
      `${JSON.stringify({ interface: { displayName: "Demo" }, name: "demo", plugins: [] })}\n`
    );
    const temp = await createTestFixtureRoot("skillset-provider-codex-gap-");

    await expect(
      stageValidationInputs(
        root,
        temp,
        await enumerateProviderArtifacts(root),
        {
          agentSkills: join(temp, "agent-tool"),
          claude: join(temp, "claude-tool"),
          codex: join(temp, "codex"),
          codexPython: join(temp, "python"),
          codexValidator: join(temp, "codex-validator"),
          cursor: await fixtureCursorTool(temp),
        }
      )
    ).rejects.toThrow("Codex marketplace omits generated plugins");
  });

  test("rejects Codex marketplace sources outside the generated package inventory", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "plugins/other"), { recursive: true });
    await writeFile(join(root, "plugins/other/plugin.json"), "{}\n");
    await writeFile(
      join(root, ".agents/plugins/marketplace.json"),
      `${JSON.stringify({
        interface: { displayName: "Demo" },
        name: "demo",
        plugins: [
          {
            name: "other",
            source: { path: "./plugins/other", source: "local" },
          },
        ],
      })}\n`
    );
    const temp = await createTestFixtureRoot("skillset-provider-codex-extra-");

    await expect(
      stageValidationInputs(
        root,
        temp,
        await enumerateProviderArtifacts(root),
        {
          agentSkills: join(temp, "agent-tool"),
          claude: join(temp, "claude-tool"),
          codex: join(temp, "codex"),
          codexPython: join(temp, "python"),
          codexValidator: join(temp, "codex-validator"),
          cursor: await fixtureCursorTool(temp),
        }
      )
    ).rejects.toThrow("Codex marketplace source is not a generated plugin");
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
      const temp = await createTestFixtureRoot("skillset-provider-escape-");
      const cursor = await fixtureCursorTool(temp);

      await expect(
        stageValidationInputs(root, temp, inventory, {
          agentSkills: join(temp, "agent-tool"),
          claude: join(temp, "claude-tool"),
          codex: join(temp, "codex"),
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
        const temp = await createTestFixtureRoot("skillset-provider-platform-");

        await expect(
          stageValidationInputs(root, temp, inventory, {
            agentSkills: join(temp, "agent-tool"),
            claude: join(temp, "claude-tool"),
            codex: join(temp, "codex"),
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
        checkedAt: "2026-09-12T00:02:00.000Z",
        codexMarketplaceConsumers: [],
        failures: [
          {
            diagnostic:
              "/runner/temp/skillset-provider-validation-random/downloads/tool.tgz",
            lane: "all",
            stage: "acquisition",
          },
        ],
        internalAuthoringConformance: [],
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
    const runnerTemp = await createTestFixtureRoot("skillset-provider-report-");
    const root = await createTestFixtureRoot("skillset-provider-invalid-");
    const reportPath = join(runnerTemp, "provider-validation.md");
    const previousActions = process.env.GITHUB_ACTIONS;
    const previousTemp = process.env.RUNNER_TEMP;
    process.env.GITHUB_ACTIONS = "true";
    process.env.RUNNER_TEMP = runnerTemp;
    try {
      await expect(
        runHostedProviderValidation(
          root,
          reportPath,
          "2026-09-12T00:02:00.000Z"
        )
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

  test("writes stale verification as freshness failure evidence", async () => {
    const runnerTemp = await createTestFixtureRoot("skillset-provider-report-");
    const root = await createTestFixtureRoot("skillset-provider-stale-");
    const reportPath = join(runnerTemp, "provider-validation.md");
    const previousActions = process.env.GITHUB_ACTIONS;
    const previousTemp = process.env.RUNNER_TEMP;
    process.env.GITHUB_ACTIONS = "true";
    process.env.RUNNER_TEMP = runnerTemp;
    try {
      await expect(
        runHostedProviderValidation(
          root,
          reportPath,
          "2026-10-13T00:01:37.001Z"
        )
      ).rejects.toThrow("provider validation evidence is stale");
      const report = await readFile(reportPath, "utf8");
      expect(report).toContain("**freshness / all:**");
      expect(report).toContain("31 days old; maximum 30");
      expect(report).toContain("| not-run |");
    } finally {
      restoreEnvironment("GITHUB_ACTIONS", previousActions);
      restoreEnvironment("RUNNER_TEMP", previousTemp);
    }
  });

  test("rejects an existing symlink report target", async () => {
    const runnerTemp = await createTestFixtureRoot("skillset-provider-report-");
    const root = await createTestFixtureRoot("skillset-provider-invalid-");
    const outside = join(
      await createTestFixtureRoot("skillset-outside-"),
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
        runHostedProviderValidation(
          root,
          reportPath,
          "2026-09-12T00:02:00.000Z"
        )
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
    codexMarketplaces: ["/tmp/stage/.agents/plugins/marketplace.json"],
    codexPlugins: ["/tmp/stage/plugins/demo/codex"],
    cursorMarketplaces: ["/tmp/stage/.cursor-plugin/marketplace.json"],
    cursorPlugins: ["/tmp/stage/plugins/demo/cursor"],
    pluginPackages: ["/tmp/stage/plugins/demo"],
    skills: ["/tmp/stage/.agents/skills/demo/SKILL.md"],
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await createTestFixtureRoot("skillset-provider-validation-");
  for (const path of [
    ".agents/plugins",
    ".agents/skills/standalone",
    ".claude-plugin",
    ".cursor-plugin",
    "plugins/demo/.claude-plugin",
    "plugins/demo/.cursor-plugin",
    "plugins/demo/skills/demo",
  ])
    await mkdir(join(root, path), { recursive: true });
  for (const path of [
    ".agents/skills/standalone/SKILL.md",
    "plugins/demo/plugin.json",
    "plugins/demo/.claude-plugin/plugin.json",
    "plugins/demo/.cursor-plugin/plugin.json",
    "plugins/demo/skills/demo/SKILL.md",
  ])
    await writeFile(
      join(root, path),
      path === "plugins/demo/plugin.json"
        ? `${JSON.stringify({
            $schema:
              "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
            description: "demo",
            extensions: { "com.openai": { interface: {} } },
            name: "demo",
            version: "1.0.0",
          })}\n`
        : path.endsWith(".json")
        ? '{"name":"demo","version":"1.0.0"}\n'
        : `---\nname: ${basename(dirname(path))}\ndescription: demo\n---\n`
    );
  await writeFile(
    join(root, ".agents/plugins/marketplace.json"),
    `${JSON.stringify({
      interface: { displayName: "Demo" },
      name: "demo",
      plugins: [
        {
          name: "demo",
          policy: {
            authentication: "ON_INSTALL",
            installation: "AVAILABLE",
          },
          source: { path: "./plugins/demo", source: "local" },
        },
      ],
    })}\n`
  );
  await writeFile(
    join(root, ".claude-plugin/marketplace.json"),
    `${JSON.stringify({
      name: "demo",
      plugins: [{ name: "demo", source: "./plugins/demo" }],
    })}\n`
  );
  await writeFile(
    join(root, ".cursor-plugin/marketplace.json"),
    `${JSON.stringify({
      name: "demo",
      plugins: [{ name: "demo", source: "plugins/demo" }],
    })}\n`
  );
  await writeLock(
    join(root, ".agents/skills/skillset.lock"),
    ".agents/skills",
    [{ kind: "standalone-skill", outputPath: "standalone/SKILL.md" }]
  );
  await writeLock(join(root, "skillset.lock"), "plugins", [
    { kind: "plugin", outputPath: "demo/plugin.json" },
  ]);
  await writeLock(join(root, "plugins/skillset.lock"), "plugins", [
    { kind: "plugin", outputPath: "demo/plugin.json" },
    { kind: "plugin", outputPath: "demo/.claude-plugin/plugin.json" },
    { kind: "plugin", outputPath: "demo/.cursor-plugin/plugin.json" },
    { kind: "plugin-skill", outputPath: "demo/skills/demo/SKILL.md" },
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

const UNRELATED_SECRETS = [
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "GITHUB_TOKEN",
] as const;

function plantUnrelatedSecrets(): Record<string, string | undefined> {
  const previous = Object.fromEntries(
    UNRELATED_SECRETS.map((name) => [name, process.env[name]])
  );
  for (const name of UNRELATED_SECRETS) {
    process.env[name] = `${name}-should-not-leak`;
  }
  return previous;
}

function restoreUnrelatedSecrets(
  previous: Record<string, string | undefined>
): void {
  for (const [name, value] of Object.entries(previous)) {
    restoreEnvironment(name, value);
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
