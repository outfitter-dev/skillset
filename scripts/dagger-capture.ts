/** Retain command diagnostics before a Dagger caller evaluates the verdict. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:os";
import { join } from "node:path";

import { isPathInside, resolveInside } from "../packages/core/src/path";
import { runProcess, type ProcessResult } from "./test-shard-process";
import { prepareShardOutput } from "./test-shard-workspace";

export interface CommandEvidence {
  readonly schemaVersion: 1;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly runtime: {
    readonly bun: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly result: ProcessResult | null;
  readonly error: string | null;
  readonly artifacts: readonly {
    readonly path: string;
    readonly sha256: string | null;
  }[];
}

export async function captureCommand(options: {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly out: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly artifacts?: readonly string[];
}): Promise<CommandEvidence> {
  if (!options.command[0]) throw new Error("command is empty");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error("timeout must be a positive integer");
  const cwd = await realpath(options.cwd);
  const out = await prepareShardOutput(cwd, options.out);
  const paths = options.artifacts ?? [];
  for (const path of paths) resolveInside(out, path);
  const startedAt = new Date().toISOString();
  let result: ProcessResult | null = null;
  let error: string | null = null;
  try {
    result = await runProcess(
      options.command[0],
      options.command.slice(1),
      cwd,
      options.env,
      join(out, "command.log"),
      options.timeoutMs,
      options.signal
    );
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const artifacts = await Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: await artifactDigest(out, path),
    }))
  );
  const evidence: CommandEvidence = {
    schemaVersion: 1,
    command: [...options.command],
    cwd,
    startedAt,
    endedAt: new Date().toISOString(),
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
    },
    result,
    error,
    artifacts,
  };
  await writeFile(
    join(out, "command-result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx" }
  );
  return evidence;
}

/** A successful export is not a successful command. Preserve signals in JSON. */
export function commandVerdict(evidence: CommandEvidence): number {
  const result = evidence.result;
  if (evidence.schemaVersion !== 1 || evidence.error || !result) return 1;
  if (result.timedOut) return 124;
  if (result.signal) return 128 + (constants.signals[result.signal] ?? 1);
  return Number.isInteger(result.exitCode) &&
    result.exitCode !== null &&
    result.exitCode >= 0 &&
    result.exitCode <= 255
    ? result.exitCode
    : 1;
}

export async function verifyCommandEvidence(
  out: string
): Promise<CommandEvidence> {
  const evidence = JSON.parse(
    await readFile(join(out, "command-result.json"), "utf8")
  ) as CommandEvidence;
  if (
    evidence.schemaVersion !== 1 ||
    !Array.isArray(evidence.command) ||
    evidence.command.length === 0 ||
    !Array.isArray(evidence.artifacts) ||
    evidence.command.some((arg) => typeof arg !== "string") ||
    typeof evidence.cwd !== "string" ||
    typeof evidence.startedAt !== "string" ||
    typeof evidence.endedAt !== "string" ||
    !evidence.runtime ||
    typeof evidence.runtime.bun !== "string" ||
    (evidence.error !== null && typeof evidence.error !== "string") ||
    !completeProcessResult(evidence.result) ||
    !(await lstat(join(out, "command.log"))).isFile()
  )
    throw new Error("incomplete command evidence");
  for (const artifact of evidence.artifacts) {
    if (
      typeof artifact.path !== "string" ||
      !(artifact.sha256 === null || /^[0-9a-f]{64}$/.test(artifact.sha256))
    )
      throw new Error("incomplete artifact evidence");
    if ((await artifactDigest(out, artifact.path)) !== artifact.sha256)
      throw new Error(`artifact changed after capture: ${artifact.path}`);
    if (commandVerdict(evidence) === 0 && artifact.sha256 === null)
      throw new Error(`successful command omitted artifact: ${artifact.path}`);
  }
  return evidence;
}

function completeProcessResult(result: ProcessResult | null): boolean {
  return (
    result === null ||
    (typeof result === "object" &&
      result !== undefined &&
      (result.exitCode === null ||
        (Number.isInteger(result.exitCode) &&
          result.exitCode >= 0 &&
          result.exitCode <= 255)) &&
      (result.signal === null ||
        Object.hasOwn(constants.signals, result.signal)) &&
      typeof result.timedOut === "boolean" &&
      Number.isFinite(result.wallMs) &&
      result.wallMs >= 0)
  );
}

async function artifactDigest(
  root: string,
  path: string
): Promise<string | null> {
  const file = resolveInside(root, path);
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  if (
    !stat.isFile() ||
    !isPathInside(await realpath(root), await realpath(file))
  )
    throw new Error(`artifact is not a contained regular file: ${path}`);
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === "verify" && args.length === 2) {
      process.exitCode = commandVerdict(await verifyCommandEvidence(args[1]!));
    } else {
      const separator = args.indexOf("--");
      const out = args[0];
      if (!out || separator !== 1 || args.length < 3)
        throw new Error(
          "usage: bun scripts/dagger-capture.ts <out> -- <command> [args...] | verify <out>"
        );
      // Capture intentionally exits zero so diagnostics can be exported. The
      // host MUST run `verify` after export; that verdict is the test gate.
      await captureCommand({
        command: args.slice(2),
        cwd: process.cwd(),
        out,
        env: process.env,
        timeoutMs: 15 * 60_000,
        signal: new AbortController().signal,
      });
    }
  } catch (error) {
    console.error(
      `dagger-capture: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
