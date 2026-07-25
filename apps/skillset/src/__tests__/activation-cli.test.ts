import { expect, spyOn, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildSkillset } from "@skillset/core";

import type { ActivationProviderCommandRunner } from "../activation-inspection";
import { inspectWorkspaceActivation } from "../activation-workflow";
import { runExplainCommand, runStatusCommand } from "../inspect-cli";
import type { ProviderCommandExecutionResult } from "../provider-command";

test("SET-392: bare status and explain do not launch provider inspectors", async () => {
  const root = await activationFixture();
  const calls: string[][] = [];
  const runCommand = fixtureRunner(calls);

  await captureStdout(() =>
    runStatusCommand(
      { activation: false, jsonOutput: true, options: {}, rootPath: root },
      { runCommand }
    )
  );
  await captureStdout(() =>
    runExplainCommand(
      {
        activation: false,
        jsonOutput: true,
        options: {},
        path: ".skillset/plugins/alpha/.mcp.json",
        rootPath: root,
      },
      { runCommand }
    )
  );

  expect(calls).toEqual([]);
});

test("SET-392: activation with no requirements remains ready without provider calls", async () => {
  const root = await emptyActivationFixture();
  const calls: string[][] = [];
  const stdout = await captureStdout(() =>
    runStatusCommand(
      { activation: true, jsonOutput: true, options: {}, rootPath: root },
      { runCommand: fixtureRunner(calls) }
    )
  );
  const result = JSON.parse(stdout) as {
    readonly data: {
      readonly activation: {
        readonly inspections: readonly unknown[];
        readonly readiness: {
          readonly counts: Readonly<Record<string, number>>;
          readonly summary: string;
        };
      };
    };
  };

  expect(calls).toEqual([]);
  expect(result.data.activation.inspections).toEqual([]);
  expect(result.data.activation.readiness.summary).toBe("ready");
  expect(
    Object.values(result.data.activation.readiness.counts).every(
      (count) => count === 0
    )
  ).toBe(true);
});

test("SET-392: status activation preserves a finite graph failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-activation-invalid-"));
  await Bun.write(
    join(root, "skillset.yaml"),
    `skillset:
  name: activation-invalid
`
  );
  await Bun.write(
    join(root, ".skillset/plugins/wrong/skillset.yaml"),
    `skillset:
  name: mismatch
`
  );
  const calls: string[][] = [];
  const priorExitCode = process.exitCode;
  let stdout: string;
  try {
    stdout = await captureStdout(() =>
      runStatusCommand(
        { activation: true, jsonOutput: true, options: {}, rootPath: root },
        { runCommand: fixtureRunner(calls) }
      )
    );
  } finally {
    process.exitCode = priorExitCode ?? 0;
  }
  const result = JSON.parse(stdout) as {
    readonly data: {
      readonly activation?: unknown;
      readonly buildError?: string;
    };
    readonly ok: boolean;
  };

  expect(result.ok).toBe(false);
  expect(result.data.buildError).toContain(
    "plugin directory wrong does not match skillset.name mismatch"
  );
  expect(result.data).not.toHaveProperty("activation");
  expect(calls).toEqual([]);
});

test("SET-392: status activation is opt-in, bounded, and exit-code neutral", async () => {
  const root = await activationFixture();
  const calls: string[][] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const runCommand = fixtureRunner(calls, signals);

  const stdout = await captureStdout(() =>
    runStatusCommand(
      { activation: true, jsonOutput: true, options: {}, rootPath: root },
      { runCommand }
    )
  );
  const result = JSON.parse(stdout) as {
    readonly data: {
      readonly activation: {
        readonly inspections: readonly {
          readonly effect: string;
          readonly outcome: string;
        }[];
        readonly readiness: {
          readonly summary: string;
        };
      };
      readonly ok: boolean;
    };
    readonly exitCode: number;
  };

  expect(calls).toEqual([
    ["codex", "--version"],
    ["codex", "mcp", "list", "--json"],
    ["codex", "plugin", "list", "--json"],
  ]);
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(result.data.ok).toBe(true);
  expect(result.data.activation.readiness.summary).toBe("ready_unverified");
  expect(result.data.activation.inspections).toHaveLength(2);
  expect(result.data.activation.inspections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        effect: "passive",
        inspectorId: "codex.mcp.list",
        outcome: "ran",
      }),
      expect.objectContaining({
        effect: "passive",
        inspectorId: "codex.plugin.list",
        outcome: "ran",
      }),
    ])
  );
  expect(result.exitCode).toBe(0);

  const human = await captureStdout(() =>
    runStatusCommand(
      { activation: true, jsonOutput: false, options: {}, rootPath: root },
      { runCommand }
    )
  );
  expect(human).toContain("activation: ready with unverified requirements");
  expect(human).toContain("inspector [codex] codex.mcp.list: passive, ran");
});

test("SET-392: generated-output drift keeps rendered readiness unsatisfied", async () => {
  const root = await activationFixture();
  await Bun.write(join(root, "plugins/alpha/codex/.mcp.json"), "{}\n");
  const priorExitCode = process.exitCode;
  let stdout: string;
  try {
    stdout = await captureStdout(() =>
      runStatusCommand(
        { activation: true, jsonOutput: true, options: {}, rootPath: root },
        { runCommand: fixtureRunner([]) }
      )
    );
  } finally {
    process.exitCode = priorExitCode ?? 0;
  }
  const result = JSON.parse(stdout) as {
    readonly data: {
      readonly activation: {
        readonly readiness: {
          readonly requirements: readonly {
            readonly capability: string;
            readonly stage: string;
            readonly state: string;
            readonly subject: string;
          }[];
          readonly summary: string;
        };
      };
    };
  };

  expect(result.data.activation.readiness.summary).toBe("attention");
  expect(result.data.activation.readiness.requirements).toContainEqual(
    expect.objectContaining({
      capability: "mcp-server",
      stage: "rendered",
      state: "missing",
      subject: "alpha",
    })
  );
});

test("SET-392: explain activation keeps only matching source provenance", async () => {
  const root = await activationFixture();
  await Bun.write(
    join(root, ".skillset/plugins/beta/.mcp.json"),
    `${JSON.stringify({
      mcpServers: { alpha: { command: "beta-mcp" } },
    })}\n`
  );
  await buildSkillset(root);
  await Bun.write(
    join(root, ".skillset/plugins/beta/bin/tool"),
    "#!/bin/sh\n"
  );
  await Bun.write(
    join(root, ".skillset/plugins/beta/skillset.yaml"),
    `skillset:
  name: beta
mcp: true
bin: true
dependencies:
  plugins:
    - name: external-beta
      range: "^1.0.0"
`
  );
  const calls: string[][] = [];
  const stdout = await captureStdout(() =>
    runExplainCommand(
      {
        activation: true,
        jsonOutput: true,
        options: {},
        path: ".skillset/plugins/alpha/.mcp.json",
        rootPath: root,
      },
      { runCommand: fixtureRunner(calls) }
    )
  );
  const result = JSON.parse(stdout) as {
    readonly data: {
      readonly activation: {
        readonly inspections: readonly {
          readonly subjects: readonly string[];
        }[];
        readonly readiness: {
          readonly requirements: readonly {
            readonly sourcePaths: readonly string[];
            readonly sourceUnits: readonly string[];
            readonly subject: string;
          }[];
        };
      };
    };
  };

  expect(
    result.data.activation.readiness.requirements.map(
      (requirement) => requirement.subject
    )
  ).toEqual(["alpha", "alpha", "alpha", "alpha", "alpha", "alpha"]);
  expect(
    result.data.activation.readiness.requirements.every((requirement) =>
      requirement.sourcePaths.every(
        (path) => path === ".skillset/plugins/alpha/.mcp.json"
      )
    )
  ).toBe(true);
  expect(
    result.data.activation.readiness.requirements.every((requirement) =>
      requirement.sourceUnits.every(
        (sourceUnit) => sourceUnit === "plugin.alpha.feature:mcp"
      )
    )
  ).toBe(true);
  expect(result.data.activation.inspections).toEqual([
    expect.objectContaining({
      subjects: ["alpha"],
      summary:
        "provider observation completed for the selected activation subjects",
    }),
  ]);
  expect(result.data.activation.inspections[0]).not.toHaveProperty(
    "stdoutBytes"
  );
  expect(calls).toEqual([
    ["codex", "--version"],
    ["codex", "mcp", "list", "--json"],
  ]);
  expect(JSON.stringify(result.data.activation)).not.toContain('"beta"');
  expect(JSON.stringify(result.data.activation)).not.toContain(
    "parsed 2 configured"
  );
});

test("SET-392: directory activation scopes retain descendant source requirements", async () => {
  const root = await activationFixture();
  const report = await inspectWorkspaceActivation({
    options: {},
    renderResults: [],
    rootPath: root,
    runCommand: fixtureRunner([]),
    sourcePaths: [".skillset/plugins/alpha"],
  });

  expect(
    report.readiness.requirements.map((requirement) => requirement.subject)
  ).toEqual(["alpha", "alpha", "alpha", "alpha", "alpha", "alpha"]);
  expect(
    report.readiness.requirements.every((requirement) =>
      requirement.sourcePaths.every(
        (path) => path === ".skillset/plugins/alpha/.mcp.json"
      )
    )
  ).toBe(true);
});

test("SET-392: expected provider transport failures remain advisory", async () => {
  const root = await activationFixture();
  const error = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });

  const stdout = await captureStdout(() =>
    runStatusCommand(
      { activation: true, jsonOutput: true, options: {}, rootPath: root },
      {
        runCommand: async () => {
          throw error;
        },
      }
    )
  );
  const result = JSON.parse(stdout) as {
    readonly data: {
      readonly activation: {
        readonly inspections: readonly { readonly outcome: string }[];
      };
      readonly ok: boolean;
    };
    readonly exitCode: number;
  };

  expect(result.data.ok).toBe(true);
  expect(
    result.data.activation.inspections.every(
      ({ outcome }) => outcome === "skipped" || outcome === "unavailable"
    )
  ).toBe(true);
  expect(result.exitCode).toBe(0);
});

test("SET-392: activation cancellation reaches provider runners", async () => {
  const root = await activationFixture();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  let enteredRunner: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enteredRunner = resolve;
  });
  const run = runStatusCommand(
    { activation: true, jsonOutput: true, options: {}, rootPath: root },
    {
      runCommand: async (_command, options) => {
        receivedSignal = options.signal;
        enteredRunner?.();
        await new Promise<void>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true }
          );
        });
        throw new Error("unreachable");
      },
      signal: controller.signal,
    }
  );

  await entered;
  controller.abort();

  await expect(run).rejects.toMatchObject({ name: "AbortError" });
  expect(receivedSignal).toBe(controller.signal);
});

test("SET-392: activation routes preserve provider effect asymmetry", async () => {
  const root = await activationFixture("[claude]");
  const calls: string[][] = [];
  const stdout = await captureStdout(() =>
    runStatusCommand(
      { activation: true, jsonOutput: true, options: {}, rootPath: root },
      { runCommand: fixtureRunner(calls) }
    )
  );
  const result = JSON.parse(stdout) as {
    readonly data: {
      readonly activation: {
        readonly inspections: readonly {
          readonly effect: string;
          readonly inspectorId: string;
        }[];
      };
    };
  };

  expect(calls).toEqual([
    ["claude", "--version"],
    ["claude", "mcp", "list"],
    ["claude", "plugin", "list", "--json"],
  ]);
  expect(result.data.activation.inspections).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        effect: "active",
        inspectorId: "claude.mcp.list",
      }),
      expect.objectContaining({
        effect: "passive",
        inspectorId: "claude.plugin.list",
      }),
    ])
  );
});

async function activationFixture(targets = "[codex]"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-activation-cli-"));
  const files = {
    ".skillset/plugins/alpha/.mcp.json": JSON.stringify({
      mcpServers: { alpha: { command: "alpha-mcp" } },
    }),
    ".skillset/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
mcp: true
`,
    ".skillset/plugins/beta/.mcp.json": JSON.stringify({
      mcpServers: { beta: { command: "beta-mcp" } },
    }),
    ".skillset/plugins/beta/skillset.yaml": `
skillset:
  name: beta
mcp: true
dependencies:
  plugins:
    - name: external-beta
      range: "^1.0.0"
`,
    ".skillset/plugins/beta/skills/beta/SKILL.md": `
---
name: beta
description: Carries the beta dependency notice.
---

Beta.
`,
    "skillset.yaml": `
skillset:
  name: activation-cli
compile:
  targets: ${targets}
`,
  };
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      Bun.write(join(root, path), `${content.trim()}\n`)
    )
  );
  await buildSkillset(root);
  return root;
}

async function emptyActivationFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-activation-empty-"));
  await Bun.write(
    join(root, "skillset.yaml"),
    `skillset:
  name: activation-empty
compile:
  targets: [codex]
`
  );
  await Bun.write(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Activation-free fixture.
---

Demo.
`
  );
  await buildSkillset(root);
  return root;
}

function fixtureRunner(
  calls: string[][],
  signals: (AbortSignal | undefined)[] = []
): ActivationProviderCommandRunner {
  return async (command, options) => {
    const cmd = [...command.cmd];
    calls.push(cmd);
    signals.push(options.signal);
    switch (cmd.join(" ")) {
      case "claude --version":
        return execution("Claude Code 2.1.219\n");
      case "claude mcp list":
        return execution("alpha: connected\nbeta: connected\n");
      case "claude plugin list --json":
        return execution(
          JSON.stringify([
            { enabled: true, name: "external-beta" },
          ])
        );
      case "codex --version":
        return execution("codex-cli 0.146.0-alpha.3.1\n");
      case "codex mcp list --json":
        return execution(JSON.stringify([{ name: "alpha" }, { name: "beta" }]));
      case "codex plugin list --json":
        return execution(
          JSON.stringify({
            installed: [{ enabled: true, name: "external-beta" }],
          })
        );
      default:
        throw new Error(`unexpected activation command ${cmd.join(" ")}`);
    }
  };
}

function execution(stdout: string): ProviderCommandExecutionResult {
  return {
    exitCode: 0,
    stderr: "",
    stderrBytes: 0,
    stderrTruncated: false,
    stdout,
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutTruncated: false,
    timedOut: false,
  };
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
  let output = "";
  const write = spyOn(process.stdout, "write").mockImplementation((value) => {
    output += String(value);
    return true;
  });
  try {
    await run();
  } finally {
    write.mockRestore();
  }
  return output;
}
