import { relative, resolve } from "node:path";

import { sourceUnitDisplay } from "@skillset/core/internal/source-unit-selector";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { printCliJsonData } from "./cli-output";
import { ImportBatchError, importSources } from "./import";
import type { ImportReport } from "./import";
import type { ImportKind, ImportProvider } from "./source-arg-values";
import { scaffoldSourceUnit } from "./new-source";
import type {
  NewSourceKind,
  NewSourceReport,
  NewSourceScope,
} from "./new-source";

export interface ImportCommandRequest {
  readonly importKind: ImportKind | undefined;
  readonly importName: string | undefined;
  readonly sourcePath: string | undefined;
  readonly importProvider: ImportProvider | undefined;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export async function runImportCommand({
  importKind,
  importName,
  sourcePath,
  importProvider,
  jsonOutput,
  options,
  rootPath,
}: ImportCommandRequest): Promise<void> {
  let result;
  try {
    result = await importSources({
      ...(importKind === undefined ? {} : { kind: importKind }),
      ...(importName === undefined ? {} : { name: importName }),
      ...(sourcePath === undefined ? {} : { sourcePath }),
      ...(importProvider === undefined ? {} : { provider: importProvider }),
      rootPath,
      ...(options.sourceDir === undefined
        ? {}
        : { sourceDir: options.sourceDir }),
    });
  } catch (error) {
    if (!jsonOutput || !(error instanceof ImportBatchError)) {
      throw error;
    }
    const writes = importWritePaths(rootPath, error.imports);
    printCliJsonData(
      "import",
      {
        imports: error.imports,
        state: writes.length > 0 ? "written" : "planned",
        writes,
      },
      1,
      "diagnostics",
      [
        {
          code: "import.partial",
          message: error.message,
          severity: "error",
        },
      ]
    );
    return;
  }
  if (jsonOutput) {
    printCliJsonData("import", {
      result,
      state: "written",
      writes: importWritePaths(rootPath, result.imports),
    });
  } else if (result.imports.length === 1) {
    const [single] = result.imports;
    if (single !== undefined) {
      printImportReport(single);
    }
  } else {
    console.log(
      `skillset: imported ${result.imports.length} ${result.kind} (${result.files} files)`
    );
    console.log(`  source: ${result.sourcePath}`);
    for (const imported of result.imports) {
      console.log(
        `  - ${imported.kind} ${imported.name}: ${imported.targetPath} (${imported.files} files)`
      );
    }
  }
  if (!jsonOutput) {
    for (const warning of result.warnings)
      console.warn(`  warning: ${warning}`);
  }
  return;
}

export interface NewCommandRequest {
  readonly positionalName: string | undefined;
  readonly jsonOutput: boolean;
  readonly newContainer: string | undefined;
  readonly newId: string | undefined;
  readonly newKind: NewSourceKind | undefined;
  readonly newName: string | undefined;
  readonly newPresets: readonly string[] | undefined;
  readonly newScope: NewSourceScope | undefined;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runNewCommand({
  positionalName,
  jsonOutput,
  newContainer,
  newId,
  newKind,
  newName,
  newPresets,
  newScope,
  options,
  rootPath,
  yes,
}: NewCommandRequest): Promise<void> {
  if (newKind === undefined) {
    throw new Error("skillset: expected new kind skill, agent, or hook");
  }
  const report = await scaffoldSourceUnit(rootPath, {
    ...(newContainer === undefined ? {} : { container: newContainer }),
    ...(newId === undefined ? {} : { id: newId }),
    kind: newKind,
    ...(newName === undefined ? {} : { displayName: newName }),
    ...(positionalName === undefined ? {} : { name: positionalName }),
    ...(newPresets === undefined ? {} : { presets: newPresets }),
    ...(newScope === undefined ? {} : { scope: newScope }),
    skillsetOptions: options,
    write: yes,
  });
  if (jsonOutput) {
    printCliJsonData("new", {
      report,
      state: report.write ? "written" : "planned",
      writes: report.write ? report.files.map((file) => file.path) : [],
    });
  } else {
    printNewSourceReport(
      report,
      yes ? "written" : "write confirmation required"
    );
    if (!yes) {
      console.log("skillset: rerun new with --yes to write source files");
    }
  }
  return;
}

function importWritePaths(
  rootPath: string,
  imports: readonly ImportReport[]
): readonly string[] {
  return [
    ...new Set(
      imports.flatMap((entry) => [
        workspaceRelativePath(rootPath, entry.targetPath),
        ...(entry.baselinePath === undefined
          ? []
          : [workspaceRelativePath(rootPath, entry.baselinePath)]),
      ])
    ),
  ];
}

function workspaceRelativePath(rootPath: string, path: string): string {
  return relative(resolve(rootPath), resolve(rootPath, path)).replaceAll(
    "\\",
    "/"
  );
}

function printImportReport(result: ImportReport): void {
  console.log(
    `skillset: imported ${result.kind} ${result.name} (${result.files} files)`
  );
  console.log(`  target: ${result.targetPath}`);
  if (result.inferredSourceFields.length > 0) {
    console.log(`  source fields: ${result.inferredSourceFields.join(", ")}`);
  }
  if (result.preservedTargetNativeFields.length > 0) {
    console.log(
      `  preserved target-native: ${result.preservedTargetNativeFields.join(", ")}`
    );
  }
  if (result.unsupportedFields.length > 0) {
    console.log(
      `  unsupported (kept verbatim): ${result.unsupportedFields.join(", ")}`
    );
  }
  for (const baseline of result.baselines) {
    if (baseline.status === "create") {
      console.log(
        `  baseline: ${sourceUnitDisplay(baseline.scope)} ${baseline.version}`
      );
    }
  }
  for (const warning of result.warnings) {
    console.warn(`  warning: ${warning}`);
  }
  console.log(`  next: ${result.nextChecks.join(", ")}`);
}

function printNewSourceReport(result: NewSourceReport, reason: string): void {
  for (const file of result.files) {
    console.log(`  + ${file.path}`);
  }
  const action = result.write ? "created" : "planned";
  console.log(`skillset: ${action} ${result.kind} ${result.id} (${reason})`);
  console.log(`  source: ${result.sourceRoot}`);
  console.log(`  name: ${result.displayName}`);
  if (result.write) {
    console.log("  next: skillset build --yes");
    console.log("  next: skillset check");
  }
}
