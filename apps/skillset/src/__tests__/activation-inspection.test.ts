import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { targetRecord } from "@skillset/core";
import type { BuildGraph, SourcePlugin } from "@skillset/core/internal/types";

import {
  ACTIVATION_INSPECTION_SCHEMA,
  inspectActivationReadiness,
} from "../activation-inspection";
import type { ActivationProviderCommandRunner } from "../activation-inspection";
import type { ProviderCommandExecutionResult } from "../provider-command";
import { runProviderCommand } from "../provider-command";

test("activation inspection consumes registry argv once per inspector and bounds claims", async () => {
  const calls: string[][] = [];
  const runner = fixtureRunner(calls, {
    "claude --version": "Claude Code 2.1.219\n",
    "claude mcp list": "github: ✓ Connected\n",
    "claude plugin list --json": JSON.stringify([
      { enabled: true, name: "shared" },
    ]),
    "codex --version": "codex-cli 0.146.0-alpha.3.1\n",
    "codex mcp list --json": JSON.stringify([{ name: "github" }]),
    "codex plugin list --json": JSON.stringify({
      installed: [{ enabled: true, name: "shared", pluginId: "shared" }],
    }),
    "cursor-agent --version": "2026.07.23-e383d2b\n",
    "cursor-agent mcp list": "github: connected\n",
    "cursor-agent status --format json": JSON.stringify({
      authenticated: true,
      email: "must-not-survive@example.com",
      token: "must-not-survive",
    }),
  });

  const report = await inspectActivationReadiness({
    allowActive: true,
    graph: graphFixture(),
    renderResults: [],
    rootPath: "/repo",
    runCommand: runner,
  });

  expect(report.schema).toBe(ACTIVATION_INSPECTION_SCHEMA);
  expect(calls.map((call) => call.join(" ")).toSorted()).toEqual([
    "claude --version",
    "claude mcp list",
    "claude plugin list --json",
    "codex --version",
    "codex mcp list --json",
    "codex plugin list --json",
    "cursor-agent --version",
    "cursor-agent mcp list",
    "cursor-agent status --format json",
  ]);
  expect(
    report.inspections.filter(({ effect }) => effect === "active")
  ).toHaveLength(2);
  expect(
    report.inspections.find(
      ({ inspectorId }) => inspectorId === "codex.mcp.list"
    )
  ).toMatchObject({
    binaryVersion: "0.146.0-alpha.3.1",
    effect: "passive",
    outcome: "ran",
  });
  expect(
    requirement(report, "codex", "mcp-server", "github", "discoverable")
  ).toMatchObject({ observationEffect: "passive", state: "satisfied" });
  expect(
    requirement(report, "codex", "mcp-server", "github", "connected")
  ).toMatchObject({ observationEffect: "none", state: "unverified" });
  expect(
    requirement(report, "cursor", "mcp-server", "github", "authenticated")
  ).toMatchObject({ observationEffect: "passive", state: "satisfied" });
  expect(JSON.stringify(report)).not.toContain("must-not-survive");
  expect(JSON.stringify(report)).not.toContain("example.com");
});

test("passive activation inspection skips active health checks", async () => {
  const calls: string[][] = [];
  const runner = fixtureRunner(calls, {
    "claude --version": "Claude Code 2.1.219\n",
    "claude plugin list --json": "[]",
    "codex --version": "codex-cli 0.146.0-alpha.3.1\n",
    "codex mcp list --json": "[]",
    "codex plugin list --json": '{"installed":[]}',
    "cursor-agent --version": "2026.07.23-e383d2b\n",
    "cursor-agent status --format json": '{"authenticated":false}',
  });

  const report = await inspectActivationReadiness({
    allowActive: false,
    graph: graphFixture(),
    renderResults: [],
    rootPath: "/repo",
    runCommand: runner,
  });

  expect(calls.some((call) => call.join(" ") === "claude mcp list")).toBe(
    false
  );
  expect(calls.some((call) => call.join(" ") === "cursor-agent mcp list")).toBe(
    false
  );
  expect(
    report.inspections.filter(({ outcome }) => outcome === "skipped")
  ).toEqual([
    expect.objectContaining({ inspectorId: "claude.mcp.list" }),
    expect.objectContaining({ inspectorId: "cursor.mcp.list" }),
  ]);
});

test("timeouts, unavailable binaries, and malformed output remain unverified", async () => {
  const runner: ActivationProviderCommandRunner = async (command) => {
    const display = command.cmd.join(" ");
    if (display.includes("plugin list")) {
      return execution({ stdout: '{"unexpected":true}' });
    }
    if (display === "codex mcp list --json") {
      return execution({ timedOut: true });
    }
    if (display === "claude --version") {
      return execution({ stdout: "Claude Code 2.1.219\n" });
    }
    if (display === "codex --version") {
      return execution({ stdout: "codex-cli 0.146.0-alpha.3.1\n" });
    }
    if (display === "cursor-agent --version") {
      return execution({ stdout: "2026.07.23-e383d2b\n" });
    }
    return execution({ exitCode: 1 });
  };

  const report = await inspectActivationReadiness({
    allowActive: true,
    graph: graphFixture(),
    renderResults: [],
    rootPath: "/repo",
    runCommand: runner,
  });

  expect(report.inspections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        inspectorId: "codex.mcp.list",
        outcome: "timed_out",
      }),
      expect.objectContaining({
        inspectorId: "codex.plugin.list",
        outcome: "malformed",
      }),
    ])
  );
  expect(
    requirement(report, "codex", "mcp-server", "github", "discoverable").state
  ).toBe("unverified");
  expect(
    requirement(report, "codex", "plugin-dependency", "shared", "discoverable")
      .state
  ).toBe("unverified");
});

test("unknown provider versions skip every inspector command", async () => {
  const calls: string[][] = [];
  const runner = fixtureRunner(calls, {
    "claude --version": "Claude Code 99.0.0\n",
    "claude mcp list": "github: connected\n",
    "claude plugin list --json": '[{"name":"shared","enabled":true}]',
    "codex --version": "codex-cli 99.0.0\n",
    "codex mcp list --json": '[{"name":"github"}]',
    "codex plugin list --json":
      '{"installed":[{"name":"shared","enabled":true}]}',
    "cursor-agent --version": "99.0.0\n",
    "cursor-agent mcp list": "github: connected\n",
    "cursor-agent status --format json": '{"authenticated":true}',
  });

  const report = await inspectActivationReadiness({
    allowActive: true,
    graph: graphFixture(),
    renderResults: [],
    rootPath: "/repo",
    runCommand: runner,
  });

  expect(
    report.inspections
      .filter(({ effect }) => effect !== "none")
      .every(({ outcome }) => outcome === "skipped")
  ).toBe(true);
  expect(calls.map((call) => call.join(" ")).sort()).toEqual([
    "claude --version",
    "codex --version",
    "cursor-agent --version",
  ]);
  expect(
    report.readiness.requirements
      .filter(({ stage }) => !["declared", "rendered"].includes(stage))
      .every(({ state }) => state === "unverified")
  ).toBe(true);
});

test("unavailable version executables stop provider inspection", async () => {
  for (const code of ["EACCES", "ENOENT", "ENOEXEC", "ENOTDIR"]) {
    const calls: string[][] = [];
    const runner: ActivationProviderCommandRunner = async (command) => {
      calls.push([...command.cmd]);
      if (command.cmd[1] !== "--version") {
        throw new Error("an inspector ran after its version probe failed");
      }
      throw Object.assign(new Error(`private ${code} fixture detail`), {
        code,
      });
    };

    const report = await inspectActivationReadiness({
      allowActive: true,
      graph: graphFixture(),
      renderResults: [],
      rootPath: "/repo",
      runCommand: runner,
    });

    expect(
      report.inspections.every(
        ({ binaryVersion, outcome }) =>
          binaryVersion === undefined && outcome === "unavailable"
      )
    ).toBe(true);
    expect(calls.map((call) => call.join(" ")).toSorted()).toEqual([
      "claude --version",
      "codex --version",
      "cursor-agent --version",
    ]);
    expect(
      report.readiness.requirements
        .filter(({ stage }) => !["declared", "rendered"].includes(stage))
        .every(({ state }) => state === "unverified")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(code);
    expect(JSON.stringify(report)).not.toContain("private");
  }
});

test("inspectors becoming unavailable after version checks remain advisory", async () => {
  for (const code of ["EACCES", "ENOENT", "ENOEXEC", "ENOTDIR"]) {
    const runner: ActivationProviderCommandRunner = async (command) => {
      const display = command.cmd.join(" ");
      if (display === "claude --version") {
        return execution({ stdout: "Claude Code 2.1.219\n" });
      }
      if (display === "codex --version") {
        return execution({ stdout: "codex-cli 0.146.0-alpha.3.1\n" });
      }
      if (display === "cursor-agent --version") {
        return execution({ stdout: "2026.07.23-e383d2b\n" });
      }
      throw Object.assign(new Error(`private ${code} fixture detail`), {
        code,
      });
    };

    const report = await inspectActivationReadiness({
      allowActive: true,
      graph: graphFixture(),
      renderResults: [],
      rootPath: "/repo",
      runCommand: runner,
    });

    const unavailable = report.inspections.filter(
      ({ effect, outcome }) => effect !== "none" && outcome === "unavailable"
    );
    expect(unavailable.length).toBeGreaterThan(0);
    expect(
      unavailable.every(({ binaryVersion }) => binaryVersion !== undefined)
    ).toBe(true);
    expect(
      report.inspections
        .filter(({ effect }) => effect !== "none")
        .every(({ outcome }) =>
          ["skipped", "unavailable"].includes(outcome)
        )
    ).toBe(true);
    expect(
      report.readiness.requirements
        .filter(({ stage }) => !["declared", "rendered"].includes(stage))
        .every(({ state }) => state === "unverified")
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain(code);
    expect(JSON.stringify(report)).not.toContain("private");
  }
});

test("provider evidence versions require a complete version token match", async () => {
  for (const suffix of ["0", "+build", "_extra", "/next"]) {
    const runner = fixtureRunner([], {
      "claude --version": `Claude Code 2.1.219${suffix}\n`,
      "claude mcp list": "github: connected\n",
      "claude plugin list --json": '[{"name":"shared","enabled":true}]',
      "codex --version": `codex-cli 0.146.0-alpha.3.1${suffix}\n`,
      "codex mcp list --json": '[{"name":"github"}]',
      "codex plugin list --json":
        '{"installed":[{"name":"shared","enabled":true}]}',
      "cursor-agent --version": `2026.07.23-e383d2b${suffix}\n`,
      "cursor-agent mcp list": "github: connected\n",
      "cursor-agent status --format json": '{"authenticated":true}',
    });

    const report = await inspectActivationReadiness({
      allowActive: true,
      graph: graphFixture(),
      renderResults: [],
      rootPath: "/repo",
      runCommand: runner,
    });

    expect(
      report.inspections
        .filter(({ effect }) => effect !== "none")
        .every(({ outcome }) => outcome === "skipped")
    ).toBe(true);
    expect(
      report.readiness.requirements
        .filter(({ stage }) => !["declared", "rendered"].includes(stage))
        .every(({ state }) => state === "unverified")
    ).toBe(true);
  }
});

test("provider receipts retain only the canonical evidence version", async () => {
  const runner = fixtureRunner([], {
    "claude --version":
      "Claude Code 2.1.219 /Users/alice/.config/provider-token\nignored\n",
    "claude mcp list": "github: connected\n",
    "claude plugin list --json": '[{"name":"shared","enabled":true}]',
    "codex --version": "codex-cli 0.146.0-alpha.3.1\n",
    "codex mcp list --json": '[{"name":"github"}]',
    "codex plugin list --json":
      '{"installed":[{"name":"shared","enabled":true}]}',
    "cursor-agent --version": "2026.07.23-e383d2b\n",
    "cursor-agent mcp list": "github: connected\n",
    "cursor-agent status --format json": '{"authenticated":true}',
  });

  const report = await inspectActivationReadiness({
    allowActive: true,
    graph: graphFixture(),
    renderResults: [],
    rootPath: "/repo",
    runCommand: runner,
  });

  expect(
    report.inspections
      .filter(({ target }) => target === "claude")
      .every(({ binaryVersion }) => binaryVersion === "2.1.219")
  ).toBe(true);
  expect(JSON.stringify(report)).not.toContain("/Users/alice");
  expect(JSON.stringify(report)).not.toContain("provider-token");
});

test("invalid activation timeouts fail before launching a provider", async () => {
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    const calls: string[][] = [];
    await expect(
      inspectActivationReadiness({
        allowActive: true,
        graph: graphFixture(),
        renderResults: [],
        rootPath: "/repo",
        runCommand: fixtureRunner(calls, {}),
        timeoutMs,
      })
    ).rejects.toThrow("activation timeout must be a positive safe integer");
    expect(calls).toEqual([]);
  }
});

test("provider adapter fixtures preserve workspace, HOME, XDG, and provider state", async () => {
  const harness = await mkdtemp(join(tmpdir(), "skillset-activation-adapter-"));
  const workspace = join(harness, "workspace");
  const home = join(harness, "home");
  const xdg = join(harness, "xdg");
  const providerState = join(harness, "provider-state");
  for (const root of [workspace, home, xdg, providerState]) {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "marker.txt"),
      `${root.split("/").at(-1)}\n`,
      "utf8"
    );
  }
  const fakeBin = join(harness, "bin", "provider-fixture");
  await mkdir(dirname(fakeBin), { recursive: true });
  await writeFile(
    fakeBin,
    `#!/bin/sh
provider="$1"
shift
case "$provider $*" in
  "claude --version") printf 'Claude Code 2.1.219\\n' ;;
  "claude plugin list --json") printf '[{"name":"shared","enabled":true}]\\n' ;;
  "claude mcp list") printf 'github: connected\\n' ;;
  "codex --version") printf 'codex-cli 0.146.0-alpha.3.1\\n' ;;
  "codex plugin list --json") printf '{"installed":[{"name":"shared","enabled":true}]}\\n' ;;
  "codex mcp list --json") printf '[{"name":"github"}]\\n' ;;
  "cursor-agent --version") printf '2026.07.23-e383d2b\\n' ;;
  "cursor-agent mcp list") printf 'github: connected\\n' ;;
  "cursor-agent status --format json") printf '{"authenticated":true}\\n' ;;
  *) exit 9 ;;
esac
`,
    "utf8"
  );
  await chmod(fakeBin, 0o755);

  const protectedRoots = [workspace, home, xdg, providerState];
  const before = await Promise.all(protectedRoots.map(hashTree));
  const runner: ActivationProviderCommandRunner = (command, options) =>
    runProviderCommand(
      { cmd: [fakeBin, ...command.cmd], cwd: command.cwd },
      {
        ...options,
        env: {
          ...options.env,
          HOME: home,
          SKILLSET_PROVIDER_STATE: providerState,
          XDG_CACHE_HOME: join(xdg, "cache"),
          XDG_CONFIG_HOME: join(xdg, "config"),
          XDG_DATA_HOME: join(xdg, "data"),
          XDG_STATE_HOME: join(xdg, "state"),
        },
      }
    );

  const report = await inspectActivationReadiness({
    allowActive: true,
    graph: graphFixture(),
    renderResults: [],
    rootPath: workspace,
    runCommand: runner,
  });
  const after = await Promise.all(protectedRoots.map(hashTree));

  expect(
    report.inspections.every(
      ({ outcome }) => outcome === "ran" || outcome === "unavailable"
    )
  ).toBe(true);
  expect(after).toEqual(before);
});

function fixtureRunner(
  calls: string[][],
  outputs: Readonly<Record<string, string>>
): ActivationProviderCommandRunner {
  return async (command) => {
    const cmd = [...command.cmd];
    calls.push(cmd);
    const stdout = outputs[cmd.join(" ")];
    if (stdout === undefined) {
      throw new Error(`unexpected activation fixture command ${cmd.join(" ")}`);
    }
    return execution({ stdout });
  };
}

function execution(
  overrides: Partial<ProviderCommandExecutionResult> = {}
): ProviderCommandExecutionResult {
  const stdout = overrides.stdout ?? "";
  const stderr = overrides.stderr ?? "";
  return {
    exitCode: 0,
    stderr,
    stderrBytes: Buffer.byteLength(stderr),
    stderrTruncated: false,
    stdout,
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutTruncated: false,
    timedOut: false,
    ...overrides,
  };
}

function graphFixture(): BuildGraph {
  return {
    plugins: [
      pluginFixture({
        dependencies: [
          {
            kind: "internal",
            name: "shared",
            sourceLabel: ".skillset/plugins/tools/skillset.yaml",
            unversioned: false,
          },
        ],
        features: [
          {
            key: "mcp",
            origin: "conventional",
            sourcePath: "/repo/.skillset/plugins/tools/.mcp.json",
            subjects: ["github"],
            targetPath: ".mcp.json",
          },
        ],
        id: "tools",
      }),
      pluginFixture({ id: "shared" }),
    ],
    projectIslands: [],
    root: {
      outputs: {
        plugins: targetRecord((target) => `plugins/{plugin}/${target}`),
        skills: targetRecord((target) => `.${target}/skills`),
        targetOutputs: targetRecord(() => ({
          plugins: true,
          skills: true,
        })),
      },
      targets: targetRecord(() => ({ enabled: true, options: {} })),
    },
    rootPath: "/repo",
  } as unknown as BuildGraph;
}

function pluginFixture(overrides: {
  readonly dependencies?: SourcePlugin["dependencies"];
  readonly features?: SourcePlugin["features"];
  readonly id: string;
}): SourcePlugin {
  return {
    adaptiveHooks: [],
    configPath: `/repo/.skillset/plugins/${overrides.id}/skillset.yaml`,
    dependencies: overrides.dependencies ?? [],
    features: overrides.features ?? [],
    hookAttachments: [],
    id: overrides.id,
    metadata: {},
    path: `/repo/.skillset/plugins/${overrides.id}`,
    skills: [],
    targets: targetRecord(() => ({ enabled: true, options: {} })),
  };
}

function requirement(
  report: Awaited<ReturnType<typeof inspectActivationReadiness>>,
  target: "claude" | "codex" | "cursor",
  capability: "app" | "mcp-server" | "plugin-dependency",
  subject: string,
  stage:
    | "authenticated"
    | "connected"
    | "declared"
    | "discoverable"
    | "enabled"
    | "proven"
    | "rendered"
) {
  const found = report.readiness.requirements.find(
    (candidate) =>
      candidate.target === target &&
      candidate.capability === capability &&
      candidate.subject === subject &&
      candidate.stage === stage
  );
  if (found === undefined) throw new Error("missing activation requirement");
  return found;
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  await hashDirectory(root, root, hash);
  return hash.digest("hex");
}

async function hashDirectory(
  root: string,
  path: string,
  hash: ReturnType<typeof createHash>
): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const fullPath = join(path, entry.name);
    hash.update(relative(root, fullPath));
    if (entry.isDirectory()) {
      hash.update("directory");
      await hashDirectory(root, fullPath, hash);
    } else {
      hash.update("file");
      hash.update(await readFile(fullPath));
    }
  }
}
