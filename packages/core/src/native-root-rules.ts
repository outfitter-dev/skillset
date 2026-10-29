import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseGeneratedLock } from "./generated-lock";
import { readCurrentGeneratedLockFromDisk } from "./generated-lock-read";
import { updateYamlSourceDocument } from "./source-document";
import { isJsonRecord } from "./yaml";

/** Authored inputs retained separately from the generated-output plan. */
export interface NativeRootRuleSource {
  readonly configContent: string;
  readonly configPath: string;
  readonly effectiveConfigContent: string;
  readonly lockContent?: string;
  readonly sourceContent: string;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Resolve without writing, so preview and apply derive the same graph. */
export async function resolveNativeRootRuleSource(
  rootPath: string,
  configPath: string,
  configContent: string,
  declared: boolean
): Promise<NativeRootRuleSource | undefined> {
  const path = join(rootPath, "AGENTS.md");
  const entry = await lstat(path).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (entry === undefined) {
    if (declared) throw new Error("skillset: workspace.nativeAgents requires authored root AGENTS.md");
    return undefined;
  }
  const lockContent = await readOptional(join(rootPath, "skillset.lock"));
  if (lockContent !== undefined) {
    const inspected = await readCurrentGeneratedLockFromDisk(join(rootPath, "skillset.lock"), {
      logicalPath: "skillset.lock", provenance: "inspect", readText: async () => lockContent,
    });
    if (inspected.kind !== "present") throw new Error("skillset: ownership lock disappeared");
    const { lock, raw: rawLock } = inspected;
    const owned = lock.items.some((item) => item.files.includes("AGENTS.md"));
    if (owned) {
      if (declared) throw new Error("skillset: native AGENTS.md is still claimed by skillset.lock; reconcile its managed ownership before selecting native mode");
      return undefined;
    }
    // Untrusted evidence may preserve a managed claim but cannot prove absence of ownership.
    parseGeneratedLock(rawLock, "skillset.lock");
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error("skillset: native root AGENTS.md must be a regular file, not a symlink or directory");
  }
  if (await readOptional(join(rootPath, ".skillset/RULES.md")) !== undefined) {
    throw new Error("skillset: native AGENTS.md and RULES.md are mutually exclusive; keep one front-page source");
  }
  const rootRules = await readdir(join(rootPath, ".skillset/rules"), { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  if (rootRules.some((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md"))) {
    throw new Error("skillset: native mode rejects unscoped root rules; put that guidance in AGENTS.md");
  }
  const sourceContent = await readFile(path, "utf8");
  const effectiveConfigContent = declared ? configContent : updateYamlSourceDocument(
    configContent,
    configPath,
    (record) => ({
      ...record,
      workspace: {
        ...(isJsonRecord(record.workspace) ? record.workspace : {}),
        nativeAgents: true,
      },
    })
  );
  return {
    configContent,
    configPath,
    effectiveConfigContent,
    ...(lockContent === undefined ? {} : { lockContent }),
    sourceContent,
  };
}

/** Revalidate the authored file and ownership evidence before applying output. */
export async function assertNativeRootRuleSource(
  rootPath: string,
  source: NativeRootRuleSource
): Promise<void> {
  const current = await resolveNativeRootRuleSource(rootPath, source.configPath, source.configContent, true);
  if (
    current?.sourceContent !== source.sourceContent ||
    current.lockContent !== source.lockContent ||
    await readFile(source.configPath, "utf8") !== source.configContent
  ) {
    throw new Error("skillset: native AGENTS.md source, configuration, or ownership changed during build; rerun the build");
  }
}
