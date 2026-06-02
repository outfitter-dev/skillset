#!/usr/bin/env bun

import { resolve } from "node:path";

import { buildSkillset, checkSkillset } from "./build";
import { lintSkillset } from "./lint";
import type { SkillsetOptions } from "./types";

type Command = "build" | "check" | "lint";

async function main(): Promise<void> {
  const { command, options, rootPath } = parseArgs(process.argv.slice(2));

  if (command === "build") {
    const rendered = await buildSkillset(rootPath, options);
    console.log(`skillset: wrote ${rendered.length} generated files`);
    return;
  }

  if (command === "lint") {
    const result = await lintSkillset(rootPath, options);
    console.log(`skillset: linted ${result.checkedSkills} source skills`);
    return;
  }

  const result = await checkSkillset(rootPath, options);
  console.log(`skillset: checked ${result.checkedFiles} generated files`);
}

interface ParsedArgs {
  readonly command: Command;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const command = args[0];
  if (command !== "build" && command !== "check" && command !== "lint") {
    throw new Error(
      "skillset: expected command build, check, or lint\n" +
        "usage: skillset <build|check|lint> [--root <path>] [--source <dir>] [--dist <dir>]"
    );
  }

  let rootPath = process.cwd();
  let sourceDir: string | undefined;
  let distDir: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) break;
    const equalsIndex = arg.indexOf("=");
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    if (flag !== "--root" && flag !== "--source" && flag !== "--dist") {
      throw new Error(`skillset: unknown option ${arg}`);
    }

    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`skillset: expected value after ${flag}`);
    }
    if (inlineValue === undefined) index += 1;

    if (flag === "--root") rootPath = value;
    if (flag === "--source") sourceDir = value;
    if (flag === "--dist") distDir = value;
  }

  const options: SkillsetOptions = {
    ...(sourceDir === undefined ? {} : { sourceDir }),
    ...(distDir === undefined ? {} : { distDir }),
  };

  return {
    command,
    options,
    rootPath: resolve(rootPath),
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
