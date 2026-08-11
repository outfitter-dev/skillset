import { join } from "node:path";

import {
  buildNativeArtifacts,
  nativeOutputSummary,
  selectNativeTargets,
  verifyNativeArtifacts,
} from "./native-artifacts";
import { smokeNativeExecutable } from "./native-smoke";
import { getNativeTarget } from "./native-targets";

interface ParsedArgs {
  readonly all: boolean;
  readonly allowPartial: boolean;
  readonly allowReserved: boolean;
  readonly command: string;
  readonly outputDir: string | undefined;
  readonly reproducible: boolean;
  readonly required: boolean;
  readonly suffixes: readonly string[];
}

function usage(): string {
  return [
    "usage: bun scripts/native.ts build (--required|--all|--target <suffix>...) [--reproducible] [--out-dir <path>]",
    "       bun scripts/native.ts verify [--allow-partial] [--allow-reserved] [--out-dir <path>]",
    "       bun scripts/native.ts smoke --target <suffix> [--out-dir <path>]",
  ].join("\n");
}

function readValue(
  args: readonly string[],
  index: number,
  flag: string
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

export function parseNativeArgs(args: readonly string[]): ParsedArgs {
  const command = args[0] ?? "";
  let all = false;
  let allowPartial = false;
  let allowReserved = false;
  let outputDir: string | undefined;
  let reproducible = false;
  let required = false;
  const suffixes: string[] = [];

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--all":
        all = true;
        break;
      case "--allow-partial":
        allowPartial = true;
        break;
      case "--allow-reserved":
        allowReserved = true;
        break;
      case "--out-dir":
        outputDir = readValue(args, index, arg);
        index += 1;
        break;
      case "--reproducible":
        reproducible = true;
        break;
      case "--required":
        required = true;
        break;
      case "--target":
        suffixes.push(readValue(args, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown native argument: ${arg}`);
    }
  }

  return {
    all,
    allowPartial,
    allowReserved,
    command,
    outputDir,
    reproducible,
    required,
    suffixes,
  };
}

async function main(): Promise<void> {
  const parsed = parseNativeArgs(process.argv.slice(2));
  switch (parsed.command) {
    case "build": {
      const targets = selectNativeTargets(parsed);
      await buildNativeArtifacts({
        outputDir: parsed.outputDir,
        reproducible: parsed.reproducible,
        targets,
      });
      console.error(await nativeOutputSummary(parsed.outputDir));
      return;
    }
    case "verify":
      await verifyNativeArtifacts({
        allowPartial: parsed.allowPartial,
        allowReserved: parsed.allowReserved,
        outputDir: parsed.outputDir,
      });
      console.error(await nativeOutputSummary(parsed.outputDir));
      return;
    case "smoke": {
      if (
        parsed.all ||
        parsed.required ||
        parsed.reproducible ||
        parsed.allowPartial ||
        parsed.allowReserved ||
        parsed.suffixes.length !== 1
      ) {
        throw new Error("Native smoke requires exactly one --target value");
      }
      const target = getNativeTarget(parsed.suffixes[0]!);
      const outputDir = parsed.outputDir ?? ".skillset/cache/native";
      await smokeNativeExecutable(
        join(outputDir, "bin", target.suffix, target.executable),
        target.suffix
      );
      console.error(`skillset: native smoke passed for ${target.suffix}`);
      return;
    }
    default:
      throw new Error(
        `Expected native command build, verify, or smoke\n${usage()}`
      );
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`skillset: ${(error as Error).message}`);
    process.exit(1);
  }
}
