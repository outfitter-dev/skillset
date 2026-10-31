import { resolve } from "node:path";
import { ImportBatchError, planImports, prepareImportSource, type ImportSourcesOptions, type ImportBatchReport, type PreparedImportSource } from "./import";

export interface PreparedImportBatch {
  readonly units: readonly PreparedImportSource[];
  commit(): Promise<ImportBatchReport>;
  dispose(): Promise<void>;
}

/** Adoption prepares every selected unit before deciding whether any may be claimed. */
export async function prepareImportBatch(options: ImportSourcesOptions & { readonly sourcePath: string; readonly excludeSources?: ReadonlySet<string> }): Promise<PreparedImportBatch> {
  const sourcePath = resolve(options.sourcePath);
  const plan = await planImports(sourcePath, options.kind);
  if (options.name !== undefined && plan.items.length !== 1) throw new Error("skillset: --name can only be used when importing one skill or plugin");
  const units: PreparedImportSource[] = [];
  const dispose = async () => { for (const unit of units) await unit.dispose(); };
  try {
    for (const item of plan.items.filter((item) => !options.excludeSources?.has(item.sourcePath))) units.push(await prepareImportSource({ ...options, kind: item.kind, sourcePath: item.sourcePath }));
    return {
      units, dispose,
      async commit() {
        const imports = [];
        for (const unit of units) {
          try { imports.push(await unit.commit()); }
          catch (error) { throw new ImportBatchError(error instanceof Error ? error.message : String(error), [...imports, ...(error instanceof ImportBatchError ? error.imports : [])]); }
        }
        return {
          sourcePath, kind: plan.kind, imports,
          files: imports.reduce((sum, entry) => sum + entry.files, 0),
          warnings: [...plan.warnings, ...imports.flatMap((entry) => entry.warnings)],
          renderResults: imports.flatMap((entry) => entry.renderResults),
          normalizations: imports.flatMap((entry) => entry.normalizations ?? []),
          capabilityAssessments: imports.flatMap((entry) => entry.capabilityAssessments ?? []),
          ...(options.provider === undefined ? {} : { provider: options.provider }),
        };
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
