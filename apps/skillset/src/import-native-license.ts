import { lstat, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JsonRecord, TargetName } from "@skillset/core/internal/types";
import { validateImportNormalizations, type ImportNormalization } from "@skillset/schema";

/** Preserve notice content only where native import is synthesizing canonical source. */
export async function normalizeNativePluginLicense(args: {
  readonly sourcePath: string;
  readonly stagingPath: string;
  readonly configDestination: string;
  readonly copiedFiles: string[];
  readonly manifests: ReadonlyMap<TargetName, JsonRecord>;
}): Promise<readonly ImportNormalization[]> {
  if (args.manifests.size === 0) return [];
  const notices: string[] = [];
  for (const file of ["LICENSE", "LICENSE.txt"]) {
    const original = await lstat(join(args.sourcePath, file)).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (original === undefined) continue;
    // Copying skips symlinks, so staged-file inspection alone would silently omit them.
    if (!original.isFile()) throw new Error(`skillset: native plugin ${file} must be a regular file, not a symbolic link or directory; provide an explicit source license before importing`);
    const staged = await lstat(join(args.stagingPath, file));
    if (!staged.isFile() || !args.copiedFiles.includes(file)) throw new Error(`skillset: native plugin ${file} was not preserved as a regular staged file`);
    notices.push(file);
  }
  if (notices.length > 1) throw new Error("skillset: native plugin contains both LICENSE and LICENSE.txt; choose one notice in an explicit source configuration before importing");
  if (notices.length === 0) return [];
  if ([...args.manifests.values()].some((manifest) => manifest.license !== undefined)) {
    throw new Error(`skillset: native plugin license metadata and bundled license text (${notices[0]}) cannot both be mapped to canonical source without replacing the notice; provide an explicit source configuration before importing`);
  }
  if (notices[0] === "LICENSE.txt") return [];
  const entries: ImportNormalization[] = [...args.manifests.keys()].map((dialect) => ({
    code: "native.license-path", dialect,
    source: { path: "LICENSE", pointer: "" },
    destination: { path: join(dirname(args.configDestination), "LICENSE.txt").replaceAll("\\", "/"), pointer: "" },
    occurrences: 1, fidelity: "unknown",
    evidence: [
      "Copied native plugin notice renamed to the canonical same-scope LICENSE.txt; content is preserved without inferring a license identifier or legal equivalence.",
      "https://github.com/outfitter-dev/skillset/blob/main/docs/configuration/frontmatter.md",
    ],
  }));
  const validation = validateImportNormalizations(entries);
  if (!validation.ok) throw new Error(`skillset: native license normalization evidence is not representable: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
  await rename(join(args.stagingPath, "LICENSE"), join(args.stagingPath, "LICENSE.txt"));
  args.copiedFiles[args.copiedFiles.indexOf("LICENSE")] = "LICENSE.txt";
  return entries;
}
