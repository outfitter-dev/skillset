import { pathExists } from "@skillset/core/internal/fs-existence";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getStandardProfile } from "@skillset/registry";
import { validateImportNormalizations, type ImportNormalization } from "@skillset/schema";
import { updateMarkdownSourceDocument } from "@skillset/core/internal/source-document";
import { agentPluginCanonicalSkillFrontmatter } from "./agent-plugin-import";

export function agentPluginUnitObservation(
  code: ImportNormalization["code"],
  source: ImportNormalization["source"],
  destination: ImportNormalization["destination"]
): ImportNormalization {
  const profiles = [getStandardProfile("agent-plugins-1.0"), getStandardProfile("agent-skills")];
  const entry: ImportNormalization = {
    code, dialect: "agent-plugins", source, destination, occurrences: 1, fidelity: "unknown",
    evidence: [
      "Observed Agent Plugins source conversion or file binding; this does not establish provider runtime equivalence or tool enforcement.",
      "https://github.com/outfitter-dev/skillset/blob/main/docs/configuration/frontmatter.md",
      ...profiles.flatMap((profile) => profile?.provenance.snapshots.map((snapshot) => snapshot.url) ?? []),
    ],
  };
  const validation = validateImportNormalizations([entry]);
  if (!validation.ok) throw new Error(`skillset: Agent Plugins normalization evidence is not representable: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
  return entry;
}

/** Normalize only the already validated portable package in its unclaimed staging directory. */
export async function normalizeImportedAgentPluginPackage(
  targetPath: string,
  copiedFiles: string[],
  destinationDirectory: string
): Promise<readonly ImportNormalization[]> {
  const observations: ImportNormalization[] = [];
  const destination = (file: string) => join(destinationDirectory, file).replaceAll("\\", "/");
  const licenseIndex = copiedFiles.indexOf("LICENSE");
  if (licenseIndex !== -1) {
    const canonicalLicense = join(targetPath, "LICENSE.txt");
    if (await pathExists(canonicalLicense, { probe: "stat", missing: ["ENOENT"] })) throw new Error("skillset: Agent Plugins package contains both LICENSE and LICENSE.txt; remove one before importing");
    await rename(join(targetPath, "LICENSE"), canonicalLicense);
    copiedFiles[licenseIndex] = "LICENSE.txt";
    observations.push(agentPluginUnitObservation("agent-plugins.license-path", { path: "LICENSE", pointer: "" }, { path: destination("LICENSE.txt"), pointer: "" }));
  }
  for (const file of copiedFiles) {
    if (!/^skills\/[^/]+\/SKILL\.md$/u.test(file)) continue;
    const skillPath = join(targetPath, file);
    const source = await readFile(skillPath, "utf8");
    const converted = updateMarkdownSourceDocument(source, skillPath, (parts) => {
      const result = agentPluginCanonicalSkillFrontmatter(parts.frontmatter);
      for (const conversion of result.conversions) {
        observations.push(agentPluginUnitObservation(conversion.code,
          { path: file, pointer: conversion.source },
          { path: destination(conversion.file === undefined ? file : join(dirname(file), conversion.file)), pointer: conversion.destination }));
      }
      return { ...parts, frontmatter: result.frontmatter };
    });
    await writeFile(skillPath, converted);
  }
  return observations;
}
