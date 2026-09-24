/* eslint-disable func-style, no-use-before-define, unicorn/import-style -- Test scenarios precede their disposable fixture helpers. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isProviderProbeIsolationVariable,
  isProviderProbePassthroughVariable,
  PROVIDER_PROBE_ISOLATION_VARIABLES,
} from "../../../provider-probe-environment";
import { createTestFixtureRoot } from "../../../test-helpers/fixture-root";
import { runAgentInstructionsProbe } from "../agent-instructions";

const ROOT_SENTINEL = "SKILLSET_ROOT_INSTRUCTIONS_7BFC7A";
const NESTED_SENTINEL = "SKILLSET_NESTED_INSTRUCTIONS_D02DD1";
const FIXTURE_VERSION = "codex-cli 0.154.0-test-fixture";

describe("SET-411 Agent Instructions external probe", () => {
  test("verifies pinned Codex and observes distinct root and nested AGENTS.md", async () => {
    const fixture = await fakeCodex();
    const before = await probeDirectories();
    const rootInstructions = `# Root instructions\n\n${ROOT_SENTINEL}\n`;
    const nestedInstructions = `# Nested instructions\n\n${NESTED_SENTINEL}\n`;

    const previousSecret = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_SECRET_ACCESS_KEY = "aws-should-not-leak";
    let evidence: Awaited<ReturnType<typeof runAgentInstructionsProbe>>;
    try {
      evidence = await runAgentInstructionsProbe({
        codex: fixture,
        nestedInstructions,
        nestedSentinel: NESTED_SENTINEL,
        rootInstructions,
        rootSentinel: ROOT_SENTINEL,
      });
    } finally {
      if (previousSecret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
      else process.env.AWS_SECRET_ACCESS_KEY = previousSecret;
    }

    expect(evidence.consumer).toEqual({
      binarySha256: fixture.binarySha256,
      name: "Codex",
      version: FIXTURE_VERSION,
    });
    expect(evidence.assertions).toEqual({
      nestedExcludedRootSentinel: true,
      nestedIncludedNestedSentinel: true,
      rootExcludedNestedSentinel: true,
      rootIncludedRootSentinel: true,
    });
    expect(evidence.environment.temporaryWorkspaceRemoved).toBe(true);
    expect(evidence.profile).toBe("agent-instructions");
    expect(evidence.safety).toEqual({
      persistentRuntimeConfigurationWritten: false,
      temporaryWorkspaceRemoved: true,
    });
    expect(evidence.environment.isolatedVariables).toEqual(
      expect.arrayContaining([...PROVIDER_PROBE_ISOLATION_VARIABLES, "LANG", "PATH", "TERM"])
    );
    expect(evidence.environment.isolatedVariables).not.toContain(
      "AWS_SECRET_ACCESS_KEY"
    );
    expect(
      evidence.environment.isolatedVariables.every(
        (name) =>
          isProviderProbeIsolationVariable(name) ||
          isProviderProbePassthroughVariable(name) ||
          name === "LANG" ||
          name === "PATH" ||
          name === "TERM"
      )
    ).toBe(true);
    expect(evidence.invocations).toEqual([
      {
        argv: [
          "debug",
          "prompt-input",
          "Return the agent-instructions conformance probe context.",
        ],
        excludedSentinel: NESTED_SENTINEL,
        includedSentinel: ROOT_SENTINEL,
        instructionsSha256: sha256(rootInstructions),
        scope: "root",
      },
      {
        argv: [
          "debug",
          "prompt-input",
          "Return the agent-instructions conformance probe context.",
        ],
        excludedSentinel: ROOT_SENTINEL,
        includedSentinel: NESTED_SENTINEL,
        instructionsSha256: sha256(nestedInstructions),
        scope: "nested",
      },
    ]);
    expect(await probeDirectories()).toEqual(before);
  });

  test("fails closed when the binary does not match its pinned integrity", async () => {
    const fixture = await fakeCodex();
    const before = await probeDirectories();

    await expect(
      runAgentInstructionsProbe({
        codex: { ...fixture, binarySha256: "0".repeat(64) },
        nestedInstructions: NESTED_SENTINEL,
        nestedSentinel: NESTED_SENTINEL,
        rootInstructions: ROOT_SENTINEL,
        rootSentinel: ROOT_SENTINEL,
      })
    ).rejects.toThrow("pinned Codex integrity mismatch");
    expect(await probeDirectories()).toEqual(before);
  });

  test("rejects ambiguous scope sentinels before running Codex", async () => {
    await expect(
      runAgentInstructionsProbe({
        nestedInstructions: ROOT_SENTINEL,
        nestedSentinel: ROOT_SENTINEL,
        rootInstructions: ROOT_SENTINEL,
        rootSentinel: ROOT_SENTINEL,
      })
    ).rejects.toThrow("sentinels must be distinct");
  });
});

async function fakeCodex(): Promise<{
  readonly binaryPath: string;
  readonly binarySha256: string;
  readonly version: string;
}> {
  const root = await createTestFixtureRoot("skillset-fake-codex-");
  const binaryPath = join(root, "codex");
  await writeFile(
    binaryPath,
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then
  printf '%s\\n' '${FIXTURE_VERSION}'
  exit 0
fi
if [ "\${1:-}" != "debug" ] || [ "\${2:-}" != "prompt-input" ]; then
  printf '%s\\n' 'unexpected argv' >&2
  exit 2
fi
case "\${CODEX_HOME:-}" in *skillset-agent-instructions-*) ;; *) exit 3 ;; esac
case "\${HOME:-}" in *skillset-agent-instructions-*) ;; *) exit 4 ;; esac
case "\${XDG_CONFIG_HOME:-}" in *skillset-agent-instructions-*) ;; *) exit 5 ;; esac
case "\${TMPDIR:-}" in *skillset-agent-instructions-*) ;; *) exit 6 ;; esac
if [ -n "\${AWS_SECRET_ACCESS_KEY:-}" ]; then exit 9; fi
if [ "$(basename "$PWD")" = "docs" ]; then
  grep -q '${NESTED_SENTINEL}' AGENTS.md
  printf '%s\\n' '[{"type":"message","content":"${NESTED_SENTINEL}"}]'
else
  grep -q '${ROOT_SENTINEL}' AGENTS.md
  printf '%s\\n' '[{"type":"message","content":"${ROOT_SENTINEL}"}]'
fi
`,
    "utf-8"
  );
  await chmod(binaryPath, 0o755);
  return {
    binaryPath,
    binarySha256: sha256(await Bun.file(binaryPath).text()),
    version: FIXTURE_VERSION,
  };
}

async function probeDirectories(): Promise<readonly string[]> {
  const entries = await readdir(tmpdir());
  return entries
    .filter((name) => name.startsWith("skillset-agent-instructions-"))
    .toSorted();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}
