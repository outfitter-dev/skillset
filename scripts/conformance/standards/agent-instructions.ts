/* eslint-disable func-style, no-use-before-define, unicorn/import-style -- The exported probe reads top-down; hoisted private phases keep the orchestration legible. */
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProviderProbeEnvironment } from "../../provider-probe-environment";

const TEMP_PREFIX = "skillset-agent-instructions-";
const PROBE_PROMPT = "Return the agent-instructions conformance probe context.";

export interface AgentInstructionsCodexPin {
  readonly binaryPath: string;
  readonly binarySha256: string;
  readonly version: string;
}

/**
 * The app-bundled Codex build used for the accepted Agent Instructions
 * evidence. The hash prevents a different binary with the same version text
 * from silently satisfying the probe.
 */
export const AGENT_INSTRUCTIONS_CODEX_PIN: AgentInstructionsCodexPin = {
  binaryPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
  binarySha256:
    "ecad78dbf98adb89ec475edac86630406cbe59d9f3070b17d88065f136b94bcb",
  version: "codex-cli 0.154.0-alpha.6.2",
};

export interface AgentInstructionsProbeInput {
  /** Test seam; the maintainer runner uses the built-in pin. */
  readonly codex?: AgentInstructionsCodexPin;
  readonly nestedInstructions: string;
  readonly nestedSentinel: string;
  readonly rootInstructions: string;
  readonly rootSentinel: string;
}

export interface AgentInstructionsProbeInvocation {
  readonly argv: readonly string[];
  readonly excludedSentinel: string;
  readonly includedSentinel: string;
  readonly instructionsSha256: string;
  readonly scope: "nested" | "root";
}

export interface AgentInstructionsProbeEvidence {
  readonly assertions: {
    readonly nestedExcludedRootSentinel: true;
    readonly nestedIncludedNestedSentinel: true;
    readonly rootExcludedNestedSentinel: true;
    readonly rootIncludedRootSentinel: true;
  };
  readonly consumer: {
    readonly binarySha256: string;
    readonly name: "Codex";
    readonly version: string;
  };
  readonly environment: {
    readonly isolatedVariables: readonly string[];
    readonly temporaryWorkspaceRemoved: true;
  };
  readonly invocations: readonly AgentInstructionsProbeInvocation[];
  readonly limitations: readonly string[];
  readonly profile: "agent-instructions";
  readonly safety: {
    readonly persistentRuntimeConfigurationWritten: false;
    readonly temporaryWorkspaceRemoved: true;
  };
}

interface CompletedCommand {
  readonly stderr: string;
  readonly stdout: string;
}

/**
 * Prove Codex discovers root and directory-local AGENTS.md independently.
 *
 * The probe owns a fresh workspace and process environment, performs no
 * installation or activation, and removes every file it creates before
 * returning evidence to the standards conformance runner.
 */
export async function runAgentInstructionsProbe(
  input: AgentInstructionsProbeInput
): Promise<AgentInstructionsProbeEvidence> {
  assertProbeInput(input);
  const pin = input.codex ?? AGENT_INSTRUCTIONS_CODEX_PIN;
  const temp = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  let removed = false;

  try {
    const workspace = join(temp, "workspace");
    const nestedWorkspace = join(workspace, "docs");
    const environmentRoot = join(temp, "environment");
    const { env: environment } = await createProviderProbeEnvironment({
      extras: {
        LANG: "C",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TERM: "dumb",
      },
      root: environmentRoot,
    });
    await mkdir(nestedWorkspace, { recursive: true });
    await Promise.all([
      writeFile(join(workspace, "AGENTS.md"), input.rootInstructions, "utf-8"),
      writeFile(
        join(nestedWorkspace, "AGENTS.md"),
        input.nestedInstructions,
        "utf-8"
      ),
    ]);

    const binaryPath = await verifyCodexPin(pin, environment, temp);
    const [root, nested] = await Promise.all([
      invokePromptInput(binaryPath, workspace, environment),
      invokePromptInput(binaryPath, nestedWorkspace, environment),
    ]);
    assertPromptInput(
      root.stdout,
      input.rootSentinel,
      input.nestedSentinel,
      "root"
    );
    assertPromptInput(
      nested.stdout,
      input.nestedSentinel,
      input.rootSentinel,
      "nested"
    );

    const invocations: readonly AgentInstructionsProbeInvocation[] = [
      invocationEvidence(
        "root",
        input.rootInstructions,
        input.rootSentinel,
        input.nestedSentinel
      ),
      invocationEvidence(
        "nested",
        input.nestedInstructions,
        input.nestedSentinel,
        input.rootSentinel
      ),
    ];

    await removeProbeTemp(temp);
    removed = true;
    return {
      assertions: {
        nestedExcludedRootSentinel: true,
        nestedIncludedNestedSentinel: true,
        rootExcludedNestedSentinel: true,
        rootIncludedRootSentinel: true,
      },
      consumer: {
        binarySha256: pin.binarySha256,
        name: "Codex",
        version: pin.version,
      },
      environment: {
        isolatedVariables: Object.keys(environment).toSorted(),
        temporaryWorkspaceRemoved: true,
      },
      invocations,
      limitations: [
        "Codex debug prompt-input proves AGENTS.md discovery and scope, not model behavior.",
        "The probe uses an isolated ephemeral Codex home and does not install or activate generated output.",
      ],
      profile: "agent-instructions",
      safety: {
        persistentRuntimeConfigurationWritten: false,
        temporaryWorkspaceRemoved: true,
      },
    };
  } finally {
    if (!removed) {
      await removeProbeTemp(temp);
    }
  }
}

function assertProbeInput(input: AgentInstructionsProbeInput): void {
  for (const [label, value] of [
    ["root instructions", input.rootInstructions],
    ["nested instructions", input.nestedInstructions],
    ["root sentinel", input.rootSentinel],
    ["nested sentinel", input.nestedSentinel],
  ] as const) {
    if (value.length === 0 || value.includes("\0")) {
      throw new Error(
        `skillset: Agent Instructions ${label} must be non-empty`
      );
    }
  }
  if (input.rootSentinel === input.nestedSentinel) {
    throw new Error("skillset: Agent Instructions sentinels must be distinct");
  }
  if (!input.rootInstructions.includes(input.rootSentinel)) {
    throw new Error(
      "skillset: root Agent Instructions do not contain their sentinel"
    );
  }
  if (!input.nestedInstructions.includes(input.nestedSentinel)) {
    throw new Error(
      "skillset: nested Agent Instructions do not contain their sentinel"
    );
  }
  if (
    input.rootInstructions.includes(input.nestedSentinel) ||
    input.nestedInstructions.includes(input.rootSentinel)
  ) {
    throw new Error(
      "skillset: Agent Instructions sentinels must identify only their own scope"
    );
  }
}


async function verifyCodexPin(
  pin: AgentInstructionsCodexPin,
  environment: Readonly<Record<string, string>>,
  cwd: string
): Promise<string> {
  if (!/^[0-9a-f]{64}$/u.test(pin.binarySha256)) {
    throw new Error("skillset: pinned Codex SHA-256 is invalid");
  }
  const binaryPath = await realpath(pin.binaryPath);
  const metadata = await stat(binaryPath);
  if (!metadata.isFile()) {
    throw new Error("skillset: pinned Codex binary is not executable");
  }
  await access(binaryPath, constants.X_OK);
  const actualHash = await sha256File(binaryPath);
  if (actualHash !== pin.binarySha256) {
    throw new Error(
      `skillset: pinned Codex integrity mismatch: expected ${pin.binarySha256}, received ${actualHash}`
    );
  }
  const version = await runCommand(binaryPath, ["--version"], cwd, environment);
  if (
    version.stdout.trim() !== pin.version ||
    version.stderr.trim().length > 0
  ) {
    throw new Error(
      `skillset: pinned Codex version mismatch: expected ${pin.version}, received ${version.stdout.trim() || "no version"}`
    );
  }
  return binaryPath;
}

function invokePromptInput(
  binaryPath: string,
  cwd: string,
  environment: Readonly<Record<string, string>>
): Promise<CompletedCommand> {
  return runCommand(
    binaryPath,
    ["debug", "prompt-input", PROBE_PROMPT],
    cwd,
    environment
  );
}

async function runCommand(
  binaryPath: string,
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>
): Promise<CompletedCommand> {
  const process = Bun.spawn([binaryPath, ...args], {
    cwd,
    env: environment,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `skillset: Codex Agent Instructions probe failed (${exitCode}): ${stderr.trim() || "no diagnostic"}`
    );
  }
  return { stderr, stdout };
}

function assertPromptInput(
  stdout: string,
  includedSentinel: string,
  excludedSentinel: string,
  scope: "nested" | "root"
): void {
  let promptInput: unknown;
  try {
    promptInput = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `skillset: Codex ${scope} prompt input was not valid JSON`,
      { cause: error }
    );
  }
  const visibleText = collectStrings(promptInput).join("\n");
  if (!visibleText.includes(includedSentinel)) {
    throw new Error(
      `skillset: Codex ${scope} prompt input omitted its AGENTS.md sentinel`
    );
  }
  if (visibleText.includes(excludedSentinel)) {
    throw new Error(
      `skillset: Codex ${scope} prompt input included the other AGENTS.md sentinel`
    );
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.values(value).flatMap(collectStrings);
}

function invocationEvidence(
  scope: "nested" | "root",
  instructions: string,
  includedSentinel: string,
  excludedSentinel: string
): AgentInstructionsProbeInvocation {
  return {
    argv: ["debug", "prompt-input", PROBE_PROMPT],
    excludedSentinel,
    includedSentinel,
    instructionsSha256: sha256Text(instructions),
    scope,
  };
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

async function removeProbeTemp(path: string): Promise<void> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!name.startsWith(TEMP_PREFIX)) {
    throw new Error("skillset: refusing to remove an invalid probe directory");
  }
  await rm(path, { force: true, recursive: true });
}
