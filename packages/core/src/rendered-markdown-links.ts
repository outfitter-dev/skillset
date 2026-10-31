import { Parser } from "commonmark";
import { basename, dirname, join, resolve } from "node:path";
import { SkillsetFeatureDiagnosticError } from "./operation-result";
import { isPathInside, logicalDiagnosticPath } from "./path";
import { pluginBundleRoot } from "./plugin-output";
import type { LockRoot } from "./render-support";
import type { BuildGraph, RenderedFile } from "./types";

interface PrimaryMarkdown {
  readonly file: RenderedFile;
  readonly source: string;
  readonly boundary: string;
  readonly feature: string;
}

/** Validate complete distribution units before scoping or writing any output. */
export function assertRenderedMarkdownLinks(
  graph: BuildGraph,
  files: readonly RenderedFile[],
  lockRoots: ReadonlyMap<string, LockRoot>
): void {
  const inventory = new Map(files.map((file) => [resolve(graph.rootPath, file.path), file]));
  const primaries = new Map<string, PrimaryMarkdown>();
  for (const [root, lock] of lockRoots) {
    for (const item of lock.items) {
      const output = resolve(graph.rootPath, root, item.outputPath);
      const file = inventory.get(output);
      const source = resolve(graph.rootPath, item.sourcePath);
      if ((item.kind === "standalone-skill" || item.kind === "plugin-skill") &&
        basename(output) === "SKILL.md" && file?.sourcePath !== undefined &&
        resolve(graph.rootPath, file.sourcePath) === source) {
        primaries.set(output, { file, source, boundary: dirname(output), feature: "resources" });
      }
      if (item.kind !== "plugin") continue;
      const plugin = graph.plugins.find((entry) => entry.id === item.name);
      if (plugin === undefined) continue;
      // Standard package records have workspace ownership and the same shared root.
      const boundary = resolve(graph.rootPath, pluginBundleRoot(root,
        lock.target === "workspace" ? "codex" : lock.target, plugin));
      for (const member of item.files) {
        const path = resolve(graph.rootPath, root, member);
        const rendered = inventory.get(path);
        if (rendered === undefined) continue;
        if (path === join(boundary, "README.md")) {
          primaries.set(path, { file: rendered, source: join(plugin.path, "README.md"), boundary, feature: "plugin-readme" });
        } else if (rendered.sourcePath !== undefined && path.endsWith(".md") &&
          isPathInside(join(plugin.path, "subagents"), resolve(graph.rootPath, rendered.sourcePath))) {
          primaries.set(path, { file: rendered, source: resolve(graph.rootPath, rendered.sourcePath), boundary, feature: "plugin-agents" });
        }
      }
    }
  }
  const parser = new Parser();
  for (const [output, primary] of primaries) {
    const text = typeof primary.file.content === "string" ? primary.file.content : new TextDecoder().decode(primary.file.content);
    // Copied README frontmatter is opaque; remove delimiters without interpreting YAML.
    const body = text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u, "");
    const walker = parser.parse(body).walker();
    for (let event = walker.next(); event !== null; event = walker.next()) {
      if (!event.entering || (event.node.type !== "link" && event.node.type !== "image")) continue;
      const raw = event.node.destination ?? "";
      const local = localDestination(raw);
      if (local === undefined) continue;
      const target = resolve(dirname(output), local);
      const contained = isPathInside(primary.boundary, target, { allowEqual: true });
      // Directories exist only when the planned package contains a descendant file.
      const exists = inventory.has(target) || [...inventory.keys()].some((path) => isPathInside(target, path) && isPathInside(primary.boundary, path));
      if (contained && exists) continue;
      throw new SkillsetFeatureDiagnosticError({
        code: "bundle-markdown-link-missing",
        featureId: primary.feature,
        path: logicalDiagnosticPath(graph.rootPath, primary.source),
        message: `skillset: bundle Markdown link ${JSON.stringify(raw)} in ${logicalDiagnosticPath(graph.rootPath, primary.source)} resolves outside or is missing from its emitted distribution (${logicalDiagnosticPath(graph.rootPath, output)})`,
      });
    }
  }
}

function localDestination(raw: string): string | undefined {
  if (raw === "" || raw.startsWith("#") || raw.startsWith("//") || /^[a-z][a-z\d+.-]*:/iu.test(raw)) return undefined;
  // Dynamic paths are not statically verifiable and must not be mistaken for missing files.
  if (/[${}<>`]/u.test(raw)) return undefined;
  const path = raw.split(/[?#]/u, 1)[0] ?? "";
  if (path === "") return undefined;
  try {
    const decoded = decodeURIComponent(path);
    return /[${}<>`]/u.test(decoded) ? undefined : decoded;
  } catch {
    return undefined;
  }
}
