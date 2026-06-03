#!/usr/bin/env bun

import { resolve } from "node:path";

import { buildSkillset, checkSkillset } from "./build";
import { importSource, type ImportKind } from "./import";
import { lintSkillset } from "./lint";
import type { SkillsetOptions } from "./types";

type Command = "build" | "check" | "import" | "lint";

async function main(): Promise<void> {
  const { command, importKind, importPath, importName, options, rootPath } = parseArgs(process.argv.slice(2));

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

  if (command === "import") {
    if (importKind === undefined || importPath === undefined) {
      throw new Error("skillset: expected import kind and path");
    }
    const result = await importSource({
      kind: importKind,
      rootPath,
      sourcePath: importPath,
      ...(importName === undefined ? {} : { name: importName }),
      ...(options.sourceDir === undefined ? {} : { sourceDir: options.sourceDir }),
    });
    console.log(`skillset: imported ${importKind} ${result.name} (${result.files} files)`);
    console.log(`  target: ${result.targetPath}`);
    if (result.inferredSourceFields.length > 0) {
      console.log(`  source fields: ${result.inferredSourceFields.join(", ")}`);
    }
    if (result.preservedTargetNativeFields.length > 0) {
      console.log(`  preserved target-native: ${result.preservedTargetNativeFields.join(", ")}`);
    }
    if (result.unsupportedFields.length > 0) {
      console.log(`  unsupported (kept verbatim): ${result.unsupportedFields.join(", ")}`);
    }
    for (const warning of result.warnings) {
      console.warn(`  warning: ${warning}`);
    }
    console.log(`  next: ${result.nextChecks.join(", ")}`);
    return;
  }

  const result = await checkSkillset(rootPath, options);
  console.log(`skillset: checked ${result.checkedFiles} generated files`);
}

interface ParsedArgs {
  readonly command: Command;
  readonly importKind?: ImportKind;
  readonly importName?: string;
  readonly importPath?: string;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const command = args[0];
  if (command !== "build" && command !== "check" && command !== "import" && command !== "lint") {
    throw new Error(
      "skillset: expected command build, check, import, or lint\n" +
        "usage: skillset <build|check|lint> [--root <path>] [--source <dir>] [--dist <dir>]\n" +
        "       skillset import <skill|plugin> <path> [--name <name>] [--root <path>] [--source <dir>]"
    );
  }

  let importKind: ImportKind | undefined;
  let importName: string | undefined;
  let importPath: string | undefined;
  let rootPath = process.cwd();
  let sourceDir: string | undefined;
  let distDir: string | undefined;
  let index = 1;

  if (command === "import") {
    const rawKind = args[index];
    if (rawKind !== "plugin" && rawKind !== "skill") {
      throw new Error("skillset: expected import kind skill or plugin");
    }
    importKind = rawKind;
    const rawPath = args[index + 1];
    if (rawPath === undefined || rawPath.startsWith("--")) {
      throw new Error("skillset: expected import path");
    }
    importPath = rawPath;
    index += 2;
  }

  for (; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) break;
    const equalsIndex = arg.indexOf("=");
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    if (flag !== "--root" && flag !== "--source" && flag !== "--dist" && flag !== "--name") {
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
    if (flag === "--name") importName = value;
  }

  const options: SkillsetOptions = {
    ...(sourceDir === undefined ? {} : { sourceDir }),
    ...(distDir === undefined ? {} : { distDir }),
  };

  return {
    command,
    ...(importKind === undefined ? {} : { importKind }),
    ...(importName === undefined ? {} : { importName }),
    ...(importPath === undefined ? {} : { importPath }),
    options,
    rootPath: resolve(rootPath),
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
