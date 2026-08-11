import { resolve } from "node:path";

import { checkFeatureRegistryDrift } from "../packages/core/src";
import { generateDocsReferenceArtifacts } from "./docs-reference";
import {
  checkDocumentation,
  renderDocsCheckResult,
  writeDocsBaseline,
} from "./docs/check";
import { checkInvariantLinks, checkReadmeCommands } from "./docs/front-door";
import { runDocsGoldenPath } from "./docs/golden-path";
import { readmeMetadataDiagnostics } from "./package-metadata";
import { generateSchemaArtifacts } from "./schema-artifacts";

export async function runDocsCommand(
  args: readonly string[],
  root = process.cwd()
): Promise<number> {
  const command = args[0];
  if (
    args.length !== 1 ||
    !["baseline", "check", "generate"].includes(command ?? "")
  ) {
    throw new Error(
      "skillset: expected docs command generate, check, or baseline"
    );
  }

  if (command === "generate") {
    await withWorkingDirectory(root, () => generateSchemaArtifacts());
    await generateDocsReferenceArtifacts(resolve(root));
    await assertFeatureRegistryClean(resolve(root));
    process.stdout.write("skillset: generated documentation projections\n");
    return 0;
  }

  if (command === "baseline") {
    await writeDocsBaseline(resolve(root));
    process.stdout.write(
      "skillset: wrote docs/docs-check-baseline.json; inspect the shrink-only debt before committing\n"
    );
    return 0;
  }

  await withWorkingDirectory(root, () =>
    generateSchemaArtifacts({ check: true })
  );
  await generateDocsReferenceArtifacts(resolve(root), { check: true });
  await assertFeatureRegistryClean(resolve(root));
  await assertReadmeFrontDoorClean(resolve(root));
  await runDocsGoldenPath(resolve(root));
  const result = await checkDocumentation(resolve(root));
  process.stdout.write(renderDocsCheckResult(result));
  return result.ok ? 0 : 1;
}

async function assertReadmeFrontDoorClean(root: string): Promise<void> {
  const diagnostics = [
    ...(await readmeMetadataDiagnostics(root)),
    ...(await checkReadmeCommands(root)),
    ...(await checkInvariantLinks(root)),
  ];
  if (diagnostics.length === 0) return;
  throw new Error(
    [
      "skillset: README front door is stale",
      ...diagnostics.map((item) => `- ${item}`),
    ].join("\n")
  );
}

async function assertFeatureRegistryClean(root: string): Promise<void> {
  const report = await checkFeatureRegistryDrift(root);
  if (report.ok) return;
  throw new Error(
    [
      "skillset: feature registry documentation is stale",
      ...report.issues.map(
        (issue) =>
          `- ${issue.code}: ${issue.ref ?? issue.featureId}: ${issue.message}`
      ),
    ].join("\n")
  );
}

async function withWorkingDirectory<T>(
  root: string,
  action: () => Promise<T>
): Promise<T> {
  const previous = process.cwd();
  process.chdir(root);
  try {
    return await action();
  } finally {
    process.chdir(previous);
  }
}

if (import.meta.main) {
  runDocsCommand(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
