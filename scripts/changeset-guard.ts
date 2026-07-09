import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultChangesetBaseline,
  evaluateChangesetGuard,
  findMixedChangesetReleaseEntries,
  readChangedFilesFromGit,
  readChangedFilesFromPath,
} from "../apps/skillset/src/changeset-awareness";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const changedFilesOption = "--changed-files";
const baseOption = "--base";

export type ChangesetGuardCommandOptions = {
  readonly rootPath?: string;
  readonly writeLine?: (line: string) => void;
};

export async function runChangesetGuard(
  args: readonly string[],
  options: ChangesetGuardCommandOptions = {}
) {
  const rootPath = options.rootPath ?? rootDir;
  const writeLine = options.writeLine ?? ((line: string) => console.error(line));
  const changedFilesPath = valueAfter(args, changedFilesOption);
  const changedFiles = changedFilesPath
    ? await readChangedFilesFromPath(changedFilesPath)
    : await readChangedFilesFromGit(
      rootPath,
      valueAfter(args, baseOption) ?? (await defaultChangesetBaseline(rootPath))
    );
  const result = evaluateChangesetGuard(changedFiles);
  const mixedChangesets = await findMixedChangesetReleaseEntries(rootPath);

  if (result.packageFiles.length === 0 && result.changesetFiles.length === 0) {
    writeLine("skillset: changeset guard found no package-facing changes");
  } else {
    writeLine(
      `skillset: changeset guard found ${result.packageFiles.length} package-facing path(s) and ${result.changesetFiles.length} active changeset(s)`
    );
  }

  for (const diagnostic of result.diagnostics) {
    writeLine(`skillset: ${diagnostic}`);
  }

  for (const entry of mixedChangesets) {
    writeLine(
      `skillset: ${entry.changesetPath} mixes ignored package(s) ${entry.ignoredPackages.join(", ")} with published package(s) ${entry.publishedPackages.join(", ")}; remove ignored package entries from this public Changeset`
    );
  }

  return result.ok && mixedChangesets.length === 0 ? 0 : 1;
}

async function main() {
  const exitCode = await runChangesetGuard(Bun.argv.slice(2));
  if (exitCode !== 0) process.exit(exitCode);
}

function valueAfter(args: readonly string[], option: string) {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
