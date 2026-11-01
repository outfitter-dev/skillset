import { posix, relative, resolve } from "node:path";
import { readFile } from "./workspace-fs";
import { parseGeneratedLock } from "./generated-lock";
import { skillsetDiagnostic, type SkillsetDiagnostic } from "./operation-result";
import type { BuildGraph, RenderedFile } from "./types";

// Product advisories, not provider limits. Count the bytes that travel with a
// skill, and flag shared rule dependencies well before a multi-MiB context.
const SKILL_RESOURCE_WARNING_BYTES = 1024 * 1024;
const RULE_IMPORT_WARNING_BYTES = 256 * 1024;
const GENERATED_SKILL_CONTROLS = new Set(["LICENSE.txt", ".skillset.tools.yaml", "agents/openai.yaml"]);

export async function diagnosePreprocessSizes(
  graph: BuildGraph,
  rendered: readonly RenderedFile[]
): Promise<readonly SkillsetDiagnostic[]> {
  const files = new Map(rendered.map(file => [file.path, file]));
  const diagnostics: SkillsetDiagnostic[] = [];
  const visited = new Set<string>();
  const sharedPrefix = `${relative(graph.rootPath, resolve(graph.sourceRootPath, "shared")).replaceAll("\\", "/")}/`;
  const dependencySizes = new Map<string, number>();
  for (const lockFile of rendered) {
    if (lockFile.path !== "skillset.lock" && !lockFile.path.endsWith("/skillset.lock")) continue;
    const lock = parseGeneratedLock(JSON.parse(new TextDecoder().decode(lockFile.content)), lockFile.path);
    // The physical lock placement follows scoped/mirrored output. Its stored
    // outputRoot remains the logical destination and must not undo mirroring.
    const outputRoot = posix.dirname(lockFile.path);
    for (const item of lock.items) {
      if (item.outputPath === undefined) continue;
      const outputPath = posix.join(outputRoot, item.outputPath);
      if (visited.has(outputPath)) continue;
      const primary = files.get(outputPath);
      if (primary === undefined) continue;
      if ((item.kind === "standalone-skill" || item.kind === "plugin-skill") && posix.basename(outputPath) === "SKILL.md") {
        visited.add(outputPath);
        const skillDir = posix.dirname(outputPath);
        const copiedBytes = [...new Set(item.files)].reduce((bytes, entry) => {
          const path = posix.join(outputRoot, entry);
          if (path === outputPath || GENERATED_SKILL_CONTROLS.has(posix.relative(skillDir, path))) return bytes;
          return bytes + (files.get(path)?.content.byteLength ?? 0);
        }, 0);
        if (copiedBytes > SKILL_RESOURCE_WARNING_BYTES) diagnostics.push(skillsetDiagnostic({
          code: "skill-resource-size",
          message: `generated ${outputPath} carries ${copiedBytes} bytes of supporting files, over Skillset's ${SKILL_RESOURCE_WARNING_BYTES}-byte advisory threshold. Prefer copying only the resources this skill needs.`,
          outputPath,
          ...(item.sourcePath === undefined ? {} : { path: item.sourcePath }),
          severity: "warning",
        }));
      }
      if (item.kind !== "rule") continue;
      const dependencies = [...new Set(item.preprocessDependencies ?? [])].filter(file => file.startsWith(sharedPrefix));
      if (dependencies.length === 0) continue;
      visited.add(outputPath);
      let dependencyBytes = 0;
      for (const dependency of dependencies) {
        let bytes = dependencySizes.get(dependency);
        if (bytes === undefined) {
          bytes = (await readFile(resolve(graph.rootPath, dependency))).byteLength;
          dependencySizes.set(dependency, bytes);
        }
        dependencyBytes += bytes;
      }
      if (dependencyBytes <= RULE_IMPORT_WARNING_BYTES && primary.content.byteLength <= RULE_IMPORT_WARNING_BYTES) continue;
      diagnostics.push(skillsetDiagnostic({
        code: "rule-import-size",
        featureId: "project-instructions",
        message: `generated ${outputPath} has ${primary.content.byteLength} rendered bytes and ${dependencyBytes} shared dependency bytes; at least one exceeds Skillset's ${RULE_IMPORT_WARNING_BYTES}-byte advisory threshold. These measurements overlap for inlined content and are not added together. Keep eagerly loaded rules and imports concise.`,
        outputPath,
        ...(item.sourcePath === undefined ? {} : { path: item.sourcePath }),
        severity: "warning",
      }));
    }
  }
  return diagnostics;
}
