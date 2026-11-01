import { assertHookReferenceQuote } from "./hook-reference-quote";
import { getProviderHookEvidence } from "@skillset/registry";
import { join, posix, relative, resolve } from "node:path";
import { lstat } from "./workspace-fs";
import { isMissingPathError } from "./fs-existence";
import { SkillsetFeatureDiagnosticError } from "./operation-result";
import { isPathInside } from "./path";
import { formatPreprocessDependency } from "./preprocess";
import { createResourceContentPlan } from "./resource-content-plan";
import { copyPath } from "./render-support";
import { withSkillContent } from "./skill-content-plan";
import type { BuildGraph, RenderedFile, SourcePlugin, TargetName } from "./types";

/** Plan emitted plugin Markdown and explicit marked hook/script arguments. */
export function createPluginContentPlan(
  graph: BuildGraph,
  plugin: SourcePlugin,
  packageRoot: string,
  target?: TargetName
) {
  const plan = createResourceContentPlan(graph, plugin, [], plugin.configPath, target, {
    resourcePrefix: "shared",
    validateReference: async (reference) => {
      if (reference.scheme !== "shared") return;
      const sharedRelative = relative(join(graph.sourceRootPath, "shared"), reference.resolvedPath);
      const authored = join(plugin.path, "shared", sharedRelative);
      try {
        await lstat(authored);
      } catch (error) {
        if (isMissingPathError(error)) return;
        throw error;
      }
      const source = relative(graph.rootPath, reference.resolvedPath).replaceAll("\\", "/");
      const local = relative(graph.rootPath, authored).replaceAll("\\", "/");
      throw new SkillsetFeatureDiagnosticError({
        code: "shared-reference-collision",
        featureId: "resources",
        path: local,
        message: `skillset: ${local} and ${source} both map to ${packageRoot}/shared/${sharedRelative.replaceAll("\\", "/")}; promote the plugin copy with skillset move plugins/${plugin.id}/shared/${sharedRelative.replaceAll("\\", "/")} shared/${sharedRelative.replaceAll("\\", "/")}`,
      });
    },
  });
  async function processHookCommand(command: string, source: string): Promise<string> {
    if (!command.includes("@{{")) return command;
    if (target === undefined) throw new Error("skillset: hook command planning requires a provider target");
    const rootVariables = getProviderHookEvidence(target).pluginRuntime.rootEnvironment;
    const pluginRoot = rootVariables.includes("CLAUDE_PLUGIN_ROOT") ? "CLAUDE_PLUGIN_ROOT" : rootVariables[0];
    if (pluginRoot === undefined) throw new Error(`skillset: ${target} has no documented plugin root for marked hook arguments`);
    return plan.processBody(command, {}, source, "hooks/hooks.json", undefined, {
      markedLinksOnly: true,
      validateMarkedReference: offset => assertHookReferenceQuote(command, offset, source),
      renderPath: destination => "${" + pluginRoot + "}/" + scriptReferencePath(destination, source),
    });
  }
  async function finish(files: readonly RenderedFile[]) {
    const scripts = new Map<string, Uint8Array>();
    const hookScripts = new Set(graph.adaptiveHooks.flatMap(hook => hook.scriptReferences.map(reference => reference.sourcePath)));
    for (const file of files) {
      if (file.sourcePath === undefined) continue;
      const source = resolve(graph.rootPath, file.sourcePath);
      if (isPathInside(join(plugin.path, "scripts"), source) || hookScripts.has(source)) {
        if (file.content.includes(0)) continue;
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.content); } catch { continue; }
        if (!text.includes("@{{")) continue;
        scripts.set(file.path, Buffer.from(await plan.processBody(text, {}, source, relative(packageRoot, file.path).replaceAll("\\", "/"), undefined, { markedLinksOnly: true, renderPath: destination => scriptReferencePath(posix.relative(posix.dirname(relative(packageRoot, file.path).replaceAll("\\", "/")), destination), source) })));
        continue;
      }
      // Named partials are templates evaluated with the including document's
      // frontmatter, never independent Markdown roots. Keep their support copy raw.
      if (isPathInside(join(plugin.path, "shared", "partials"), source)) continue;
      if (!file.path.endsWith(".md") || (!isPathInside(join(plugin.path, "subagents"), source) && !isPathInside(join(plugin.path, "shared"), source))) continue;
      await plan.processFile(source, relative(packageRoot, file.path).replaceAll("\\", "/"));
    }
    const result = await plan.finish();
    const rendered = files.map(file => scripts.has(file.path) ? { ...file, content: scripts.get(file.path)! } : withSkillContent(file, packageRoot, result.nestedFiles));
    const outputs = new Set(files.map(file => file.path));
    for (const resource of result.resources) {
      for (const file of await copyPath(resource.sourcePath, join(packageRoot, resource.targetPath))) {
        if (outputs.has(file.path)) continue;
        rendered.push(withSkillContent({ ...file, sourcePath: resource.sourcePath }, packageRoot, result.nestedFiles));
        outputs.add(file.path);
      }
    }
    return {
      files: rendered,
      preprocessDependencies: [...result.preprocessDependencies].map(dependency => formatPreprocessDependency(graph.rootPath, dependency)).sort(),
    };
  }
  return { processHookCommand, finish };
}

export async function planPluginContent(graph: BuildGraph, plugin: SourcePlugin, packageRoot: string, files: readonly RenderedFile[], target?: TargetName) {
  return createPluginContentPlan(graph, plugin, packageRoot, target).finish(files);
}

// A textual script substitution cannot quote safely for every language or
// surrounding quote context. Refuse paths requiring language-specific escaping.
function scriptReferencePath(destination: string, source: string): string {
  if (/^[A-Za-z0-9._/\-]+$/u.test(destination)) return destination;
  throw new SkillsetFeatureDiagnosticError({
    code: "plugin-script-reference-path",
    featureId: "resources",
    path: source,
    message: `skillset: ${source} marked script reference ${JSON.stringify(destination)} requires language-specific escaping; use a script-safe resource path containing only letters, digits, dots, underscores, hyphens, and slashes`,
  });
}
