import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultChangesetBaseline,
  evaluateChangesetGuard,
  readChangedFilesFromGit,
  readChangedFilesFromPath,
} from "../apps/skillset/src/changeset-awareness";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const changedFilesOption = "--changed-files";
const baseOption = "--base";

async function main() {
  const args = Bun.argv.slice(2);
  const changedFilesPath = valueAfter(args, changedFilesOption);
  const base = valueAfter(args, baseOption) ?? (await defaultChangesetBaseline(rootDir));
  const changedFiles = changedFilesPath
    ? await readChangedFilesFromPath(changedFilesPath)
    : await readChangedFilesFromGit(rootDir, base);
  const result = evaluateChangesetGuard(changedFiles);

  if (result.packageFiles.length === 0 && result.changesetFiles.length === 0) {
    console.error("skillset: changeset guard found no package-facing changes");
  } else {
    console.error(
      `skillset: changeset guard found ${result.packageFiles.length} package-facing path(s) and ${result.changesetFiles.length} active changeset(s)`
    );
  }

  for (const diagnostic of result.diagnostics) {
    console.error(`skillset: ${diagnostic}`);
  }

  if (!result.ok) process.exit(1);
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
