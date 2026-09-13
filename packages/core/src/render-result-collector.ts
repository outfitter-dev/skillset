import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import {
  getStandardProfile,
  getStandardProfileSupportEnvelope,
  listProviderPluginManifestFields,
  type StandardProfileId,
} from "@skillset/registry";
import { SOURCE_PORTABLE_MANIFEST_KEYS } from "@skillset/schema";

import {
  resolveAdaptiveHookAttachmentsForTarget,
  type ResolvedAdaptiveHookAttachment,
} from "./adaptive-hook-attachments";
import { adaptiveHookUnsupportedRenderReason, type AdaptiveHookRenderSurface } from "./adaptive-hook-render-support";
import { readRecord, readString, isOutputSelected } from "./config";
import { getSkillsetFeature, type SkillsetFeatureEvidence } from "./feature-registry";
import {
  parseGeneratedLock,
  type GeneratedLockConsumer,
  type GeneratedLockOwner,
  type ParsedGeneratedLockItem,
} from "./generated-lock";
import { hookProviderCapabilities } from "./hook-capabilities";
import {
  defineRenderResult,
  type SkillsetRenderResult,
  type SkillsetRenderResultDiagnosticRef,
  type SkillsetRenderResultStatus,
  type SkillsetRenderResultPolicy,
} from "./render-result";
import { compareStrings } from "./path";
import {
  claudeMarketplacePath,
  cursorMarketplacePath,
  pluginBundleRoot,
  pluginManifestPath,
  pluginPathPartsForOutput,
  pluginTargetForOutputPath,
} from "./plugin-output";
import {
  codexInterfaceCategory,
  pluginManifestDisplayName,
  pluginManifestAuthor,
} from "./render-plugin-manifest";
import { hasAdaptivePluginHookOutput } from "./render-hooks";
import {
  agentSkillSourceUnit,
  agentSkillStandardProjectionIssues,
} from "./render-agent-skills-standard";
import { classifyAgentPluginStandard } from "./render-agent-plugins-standard";
import { isTargetName, targetDescriptor, targetNames } from "./targets";
import {
  readClaudeNativeToolRules,
  readEffectiveToolsPolicy,
  readImplicitInvocation,
} from "./skill-policy";
import type { ClaudeMarketplacePluginProjection } from "./render-marketplaces";
import { cursorMarketplaceOwner } from "./render-marketplaces";
import {
  droppedClaudeAuthorKeys,
  omittedClaudeAuthorKeys,
  omittedCursorAuthorKeys,
  readAuthorName,
  readAuthorRecord,
} from "./source-author";
import { readSourceListing } from "./source-listing";
import {
  planToolsRealization,
  renderResultStatusForToolsTier,
  type ToolsRealizationPlan,
} from "./tools-realization";
import {
  selectorForInstruction,
  selectorForPluginConfig,
  selectorForPluginFeature,
  selectorForPluginSkill,
  selectorForProjectAgent,
  selectorForRootConfig,
  selectorForStandaloneSkill,
  selectorForTargetNativeIsland,
} from "./source-unit-selector";
import type { AdaptiveHookScope, BuildGraph, BuildScope, JsonRecord, JsonValue, RenderedFile, SourcePlugin, SourceSkill, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

const LOCK_FILE = "skillset.lock";
const TARGETS = targetNames();

type OutputPathMapper = (path: string) => string;
type RenderResultSubject =
  | { readonly standardProfile: StandardProfileId; readonly target?: never }
  | { readonly standardProfile?: never; readonly target: TargetName }
  | { readonly standardProfile?: undefined; readonly target?: undefined };

interface CollectRenderResultsOptions {
  /**
   * Source plugins projected into the generated Claude marketplace, with the
   * author their emitted entries carry, from `claudeMarketplaceSourcePlugins`.
   * Marketplace entries can be renamed by the `claude.marketplace.name`
   * override, so marketplace render results must take plugin identity from
   * rendering instead of the provider-native entry names.
   */
  readonly claudeMarketplacePlugins: readonly ClaudeMarketplacePluginProjection[];
  readonly includedPaths: ReadonlySet<string>;
  readonly mapOutputPath?: OutputPathMapper;
  readonly scopes?: readonly BuildScope[] | undefined;
}

interface RenderedLock {
  readonly items: readonly RenderedLockItem[];
  readonly outputRoot: string;
  readonly target: TargetName | "workspace";
}

interface RenderedLockItem {
  readonly consumers: readonly GeneratedLockConsumer[];
  readonly dependencies?: readonly string[];
  readonly feature?: string;
  readonly files: readonly string[];
  readonly kind: string;
  readonly name: string;
  readonly owner?: GeneratedLockOwner;
  readonly outputPath: string;
  readonly plugin?: string;
  readonly sourcePath: string;
  readonly targetState?: string;
  readonly transforms?: readonly JsonRecord[];
  readonly validation?: string;
}

export function collectRenderResults(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  options: CollectRenderResultsOptions
): readonly SkillsetRenderResult[] {
  const mapOutputPath = options.mapOutputPath ?? ((path: string) => path);
  const outcomes: SkillsetRenderResult[] = [];
  const lockOutcomes: SkillsetRenderResult[] = [];
  const assignedOutputPaths = new Set<string>();
  const renderedOutputPaths = rendered
    .filter(
      (file) =>
        !file.path.endsWith(`/${LOCK_FILE}`) && file.path !== LOCK_FILE
    )
    .map((file) => file.path);

  for (const lockFile of rendered.filter((file) => file.path.endsWith(`/${LOCK_FILE}`) || file.path === LOCK_FILE)) {
    const lock = parseRenderedLock(lockFile);
    for (const item of lock.items) {
      const outputPaths = outputPathsForLockItem(lock.outputRoot, item);
      const primaryOutputPaths = primaryOutputPathsForLockItem(item, outputPaths);
      for (const path of primaryOutputPaths) assignedOutputPaths.add(path);
      for (const subject of resultSubjectsForLockItem(graph, lock, item, outputPaths)) {
        appendEquivalentLockOutcome(
          lockOutcomes,
          outcomeForLockItem(
            graph,
            item,
            primaryOutputPaths,
            options.includedPaths,
            mapOutputPath,
            subject
          )
        );
        outcomes.push(
          ...featureOutcomesForLockItem(
            graph,
            item,
            outputPaths,
            renderedOutputPaths,
            options.includedPaths,
            mapOutputPath,
            subject
          )
        );
      }
    }
  }
  outcomes.push(...lockOutcomes);

  for (const item of adaptivePluginHookOutcomes(
    graph,
    renderedOutputPaths,
    options.includedPaths,
    mapOutputPath
  )) {
    for (const path of item.outputPaths) assignedOutputPaths.add(path);
    outcomes.push(item.outcome);
  }

  for (const file of rendered) {
    if (assignedOutputPaths.has(file.path) || file.path.endsWith(`/${LOCK_FILE}`) || file.path === LOCK_FILE) {
      continue;
    }
    const outcome = outcomeForCompanionFile(graph, file, options.includedPaths.has(file.path), mapOutputPath);
    if (outcome !== undefined) outcomes.push(outcome);
  }

  outcomes.push(...unsupportedPluginFeatureOutcomes(graph, options.scopes));
  outcomes.push(...unsupportedMcpOutcomes(graph, options.scopes));
  outcomes.push(...unsupportedAdaptiveHookOutcomes(graph, options.scopes));
  outcomes.push(...unsupportedAgentSkillStandardOutcomes(graph, options.scopes));
  outcomes.push(...unsupportedAgentPluginStandardOutcomes(graph, options.scopes));
  outcomes.push(
    ...claudeMarketplaceAuthorOutcomes(
      graph,
      rendered,
      options.includedPaths,
      mapOutputPath,
      options.claudeMarketplacePlugins
    )
  );
  outcomes.push(
    ...cursorMarketplaceAuthorOutcomes(
      graph,
      rendered,
      options.includedPaths,
      mapOutputPath
    )
  );

  return outcomes.sort((left, right) =>
    compareStrings(
      `${left.sourceUnit}\0${left.target ?? ""}\0${left.featureId}\0${left.destination ?? ""}\0${left.status}\0${left.sourcePath ?? ""}`,
      `${right.sourceUnit}\0${right.target ?? ""}\0${right.featureId}\0${right.destination ?? ""}\0${right.status}\0${right.sourcePath ?? ""}`
    )
  );
}

function appendEquivalentLockOutcome(
  outcomes: SkillsetRenderResult[],
  candidate: SkillsetRenderResult
): void {
  const candidateIdentity = renderResultWithoutOutputs(candidate);
  const existingIndex = outcomes.findIndex(
    (outcome) => renderResultWithoutOutputs(outcome) === candidateIdentity
  );
  if (existingIndex === -1) {
    outcomes.push(candidate);
    return;
  }

  const existing = outcomes[existingIndex];
  if (existing === undefined) return;
  const outputs = [...(existing.outputs ?? []), ...(candidate.outputs ?? [])]
    .filter(
      (output, index, all) =>
        all.findIndex(
          (item) => item.kind === output.kind && item.path === output.path
        ) === index
    )
    .sort((left, right) =>
      compareStrings(
        `${left.path}\0${left.kind ?? ""}`,
        `${right.path}\0${right.kind ?? ""}`
      )
    );
  outcomes[existingIndex] = defineRenderResult({
    ...existing,
    ...(outputs.length === 0 ? {} : { outputs }),
  });
}

function renderResultWithoutOutputs(outcome: SkillsetRenderResult): string {
  const { outputs: _outputs, ...identity } = outcome;
  return JSON.stringify(identity);
}

function unsupportedAgentSkillStandardOutcomes(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly SkillsetRenderResult[] {
  return agentSkillStandardProjectionIssues(graph, scopes).map((item) => {
    const sourcePath = normalizePath(
      relative(graph.rootPath, item.skill.sourcePath)
    );
    const featureId =
      item.plugin === undefined ? "standalone-skills" : "plugin-skills";
    return defineRenderResult({
      destination: "skill",
      diagnostics: item.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: issue.path,
      })),
      evidence: evidenceFor(featureId, undefined, item.standardProfile) ?? [],
      featureId,
      policy: "unsupported:error",
      reason: item.issues.map((issue) => issue.message).join("; "),
      sourcePath,
      sourceUnit: agentSkillSourceUnit(item.plugin, item.skill),
      standardProfile: item.standardProfile,
      status: "unsupported",
    });
  });
}

interface AdaptivePluginHookOutcome {
  readonly outcome: SkillsetRenderResult;
  readonly outputPaths: readonly string[];
}

function adaptivePluginHookOutcomes(
  graph: BuildGraph,
  renderedOutputPaths: readonly string[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: OutputPathMapper
): readonly AdaptivePluginHookOutcome[] {
  const featureId = "adaptive-hooks";
  const outcomes: AdaptivePluginHookOutcome[] = [];
  for (const plugin of graph.plugins) {
    for (const target of TARGETS) {
      if (!hasAdaptivePluginHookOutput(graph, plugin, target)) continue;
      const hookRoot = normalizePath(
        join(
          pluginBundleRoot(
            graph.root.outputs.plugins[target],
            target,
            plugin
          ),
          "hooks"
        )
      );
      const aggregatePath = `${hookRoot}/hooks.json`;
      const outputPaths = renderedOutputPaths.filter(
        (path) => path === aggregatePath || path.startsWith(`${hookRoot}/`)
      );
      if (!outputPaths.includes(aggregatePath)) continue;
      const support = getSkillsetFeature(featureId)?.targetSupport[target];
      if (support?.status !== "transformed" && support?.status !== "degraded") {
        throw new Error(
          `skillset: adaptive hook render-result support for ${target} must be transformed or degraded`
        );
      }
      outcomes.push({
        outcome: featureOutcome({
          destination: "hooks",
          featureId,
          isIncluded: includedPaths.has(aggregatePath),
          mapOutputPath,
          outputKind: "adaptive-hook",
          outputPaths,
          sourcePath: normalizeSourcePath(graph, plugin.configPath),
          sourceUnit: selectorForPluginFeature(plugin.id, "hooks"),
          status: support.status,
          target,
        }),
        outputPaths,
      });
    }
  }
  return outcomes;
}

function claudeMarketplaceAuthorOutcomes(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: OutputPathMapper,
  marketplacePlugins: readonly ClaudeMarketplacePluginProjection[]
): readonly SkillsetRenderResult[] {
  const marketplacePath = claudeMarketplacePath(
    graph.root.outputs.plugins.claude
  );
  if (!rendered.some((file) => file.path === marketplacePath)) return [];
  const included = includedPaths.has(marketplacePath);
  const root = graph.root.metadata;
  const ownerUsesOverride = readAuthorName(root.owner) !== undefined;
  const owner = ownerUsesOverride ? root.owner : root.author;
  const outcomes: SkillsetRenderResult[] = [];
  if (owner !== undefined) {
    outcomes.push(
      marketplaceAuthorOutcome({
        diagnosticPath: `marketplace.owner`,
        included,
        mapOutputPath,
        outputPath: marketplacePath,
        reason: unsupportedClaudeAuthorReason(owner),
        sourcePath: "skillset.yaml",
        sourceUnit: selectorForRootConfig(),
        target: "claude",
      })
    );
  }

  for (const { author: emittedAuthor, plugin } of marketplacePlugins) {
    const usesPluginAuthor = plugin.metadata.author !== undefined;
    const author = usesPluginAuthor ? plugin.metadata.author : root.author;
    if (author === undefined) continue;
    outcomes.push(
      marketplaceAuthorOutcome({
        diagnosticPath: `marketplace.plugins.${plugin.id}.author`,
        included,
        mapOutputPath,
        outputPath: marketplacePath,
        reason: marketplaceAuthorLossReason(author, emittedAuthor),
        sourcePath: usesPluginAuthor
          ? normalizeSourcePath(graph, plugin.path)
          : "skillset.yaml",
        sourceUnit: selectorForPluginConfig(plugin.id),
        target: "claude",
      })
    );
  }
  return outcomes;
}

/**
 * Canonical author fields the destination cannot represent at all, which is
 * all the owner projection can lose: the owner has no per-entry override that
 * could keep it while replacing its author.
 */
function unsupportedClaudeAuthorReason(
  author: JsonValue | undefined
): string | undefined {
  const omitted = omittedClaudeAuthorKeys(author);
  return omitted.length === 0
    ? undefined
    : `Claude marketplace author output supports only name, email, and url; omitted canonical fields: ${omitted.join(", ")}`;
}

/**
 * Author fields a marketplace plugin entry loses, from both causes: fields the
 * Claude author output cannot represent, and supported fields the emitted
 * entry does not carry because a `claude.marketplace` override replaced or
 * omitted the author it kept.
 */
/**
 * Canonical author fields the Cursor marketplace owner output cannot
 * represent; Cursor supports only name and email.
 */
function unsupportedCursorAuthorReason(
  author: JsonValue | undefined
): string | undefined {
  const omitted = omittedCursorAuthorKeys(author);
  return omitted.length === 0
    ? undefined
    : `Cursor marketplace author output supports only name and email; omitted canonical fields: ${omitted.join(", ")}`;
}

function marketplaceAuthorLossReason(
  author: JsonValue | undefined,
  emittedAuthor: JsonValue | undefined
): string | undefined {
  const dropped = droppedClaudeAuthorKeys(author, emittedAuthor);
  const reasons = [
    unsupportedClaudeAuthorReason(author),
    dropped.length === 0
      ? undefined
      : `Claude marketplace entry drops canonical author fields: ${dropped.join(", ")}`,
  ].filter((reason): reason is string => reason !== undefined);
  return reasons.length === 0 ? undefined : reasons.join("; ");
}

function cursorMarketplaceAuthorOutcomes(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: OutputPathMapper
): readonly SkillsetRenderResult[] {
  const marketplacePath = cursorMarketplacePath(
    graph.root.outputs.plugins.cursor
  );
  if (!rendered.some((file) => file.path === marketplacePath)) return [];
  const root = graph.root.metadata;
  const canonical = readAuthorRecord(
    readAuthorName(root.owner) !== undefined ? root.owner : root.author
  );
  if (canonical === undefined) return [];
  // `cursor.marketplace.owner` is merged over the generated owner field by
  // field, so loss has to be read from the owner the marketplace actually
  // carries.
  const omitted = omittedCanonicalAuthorKeys(
    canonical,
    cursorMarketplaceOwner(graph)
  );
  return [
    marketplaceAuthorOutcome({
      diagnosticPath: "marketplace.owner",
      included: includedPaths.has(marketplacePath),
      mapOutputPath,
      outputPath: marketplacePath,
      reason:
        omitted.length === 0
          ? undefined
          : `Cursor marketplace author output supports only name and email; omitted canonical fields: ${omitted.join(", ")}`,
      sourcePath: "skillset.yaml",
      sourceUnit: selectorForRootConfig(),
      status: authorOmissionStatus("cursor", omitted),
      target: "cursor",
    }),
  ];
}

/**
 * Canonical author fields a rendered provider author record does not carry.
 *
 * A canonical key the rendered author replaces with a different value is not
 * omitted — the provider carries a native identity for that field. Only keys
 * that are absent from the rendered author are lost. When the rendered author
 * shares no canonical value at all, it replaced the identity wholesale, so no
 * canonical value reaches that output and there is nothing left for the
 * canonical projection to lose.
 */
function omittedCanonicalAuthorKeys(
  canonical: JsonRecord,
  rendered: JsonValue | undefined
): readonly string[] {
  if (!isJsonRecord(rendered)) return [];
  const keys = Object.keys(canonical);
  if (!keys.some((key) => rendered[key] === canonical[key])) return [];
  return keys.filter((key) => rendered[key] === undefined).sort();
}

function marketplaceAuthorOutcome(args: {
  readonly diagnosticPath: string;
  readonly included: boolean;
  readonly mapOutputPath: OutputPathMapper;
  readonly outputPath: string;
  readonly reason: string | undefined;
  readonly sourcePath: string;
  readonly sourceUnit: string;
  readonly status?: "degraded" | "lossy";
  readonly target: "claude" | "cursor";
}): SkillsetRenderResult {
  const evidence = evidenceFor("marketplaces", args.target);
  const reason = args.reason;
  return defineRenderResult({
    destination: "marketplace",
    ...(args.included && reason !== undefined
      ? {
          diagnostics: [
            {
              code:
                args.target === "claude"
                  ? "render/claude-marketplace-author-fields-omitted"
                  : "render/cursor-marketplace-author-fields-omitted",
              message: reason,
              path: args.diagnosticPath,
            },
          ],
        }
      : {}),
    ...(evidence === undefined ? {} : { evidence }),
    featureId: "marketplaces",
    ...(args.included
      ? {
          outputs: [
            { kind: "marketplace", path: args.mapOutputPath(args.outputPath) },
          ],
        }
      : { policy: "scope:excluded" as const }),
    ...(args.included
      ? reason === undefined
        ? {}
        : { reason }
      : { reason: "excluded by build scope" }),
    sourcePath: args.sourcePath,
    sourceUnit: args.sourceUnit,
    status: args.included
      ? reason === undefined
        ? "rendered"
        : (args.status ?? "lossy")
      : "intentionally_skipped",
    target: args.target,
  });
}

function primaryOutputPathsForLockItem(
  item: RenderedLockItem,
  outputPaths: readonly string[]
): readonly string[] {
  if (item.kind !== "plugin") return outputPaths;
  return outputPaths.filter((path) =>
    path.endsWith("/.claude-plugin/plugin.json") ||
    path.endsWith("/.codex-plugin/plugin.json") ||
    path.endsWith("/.cursor-plugin/plugin.json") ||
    path.endsWith("/agents/plugin.json") ||
    path.endsWith("/LICENSE.txt")
  );
}

function parseRenderedLock(file: RenderedFile): RenderedLock {
  const parsed = parseGeneratedLock(
    JSON.parse(new TextDecoder().decode(file.content)) as unknown,
    `generated lock ${file.path}`
  );
  return {
    items: parsed.items.map((item) => parseRenderedLockItem(file.path, item)),
    outputRoot: parsed.outputRoot,
    target: parsed.target,
  };
}

function parseRenderedLockItem(
  lockPath: string,
  raw: ParsedGeneratedLockItem
): RenderedLockItem {
  if (
    raw.kind === undefined ||
    raw.name === undefined ||
    raw.outputPath === undefined ||
    raw.sourcePath === undefined
  ) {
    throw new Error(`skillset: generated lock ${lockPath} has an invalid item`);
  }
  return {
    consumers: raw.consumers,
    ...(raw.dependencies === undefined ? {} : { dependencies: raw.dependencies }),
    ...(raw.feature === undefined ? {} : { feature: raw.feature }),
    files: raw.files,
    kind: raw.kind,
    name: raw.name,
    outputPath: raw.outputPath,
    ...(raw.owner === undefined ? {} : { owner: raw.owner }),
    ...(raw.plugin === undefined ? {} : { plugin: raw.plugin }),
    sourcePath: raw.sourcePath,
    ...(raw.targetState === undefined ? {} : { targetState: raw.targetState }),
    ...(raw.transforms === undefined ? {} : { transforms: raw.transforms as readonly JsonRecord[] }),
    ...(raw.validation === undefined ? {} : { validation: raw.validation }),
  };
}

function outcomeForLockItem(
  graph: BuildGraph,
  item: RenderedLockItem,
  outputPaths: readonly string[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: OutputPathMapper,
  subject: RenderResultSubject
): SkillsetRenderResult {
  const { standardProfile, target } = subject;
  const featureId = featureIdForLockItem(item);
  const manifestFacts = pluginManifestRenderFacts(graph, item, target);
  const baseStatus = manifestFacts?.status ?? statusForLockItem(item, target);
  const isIncluded = outputPaths.some((path) => includedPaths.has(path));
  const status: SkillsetRenderResultStatus = isIncluded ? baseStatus : "intentionally_skipped";
  const policy: SkillsetRenderResultPolicy | undefined = isIncluded ? undefined : "scope:excluded";
  const reason = isIncluded
    ? manifestFacts?.reason ??
      reasonForStatus(featureId, target, status, standardProfile)
    : "excluded by build scope";
  const evidence = evidenceFor(featureId, target, standardProfile);

  return defineRenderResult({
    destination: destinationForLockItem(item),
    ...(isIncluded && manifestFacts?.diagnostics !== undefined
      ? { diagnostics: manifestFacts.diagnostics }
      : {}),
    ...(evidence === undefined ? {} : { evidence }),
    featureId,
    ...(isIncluded ? { outputs: outputPaths.map((path) => ({ kind: item.kind, path: mapOutputPath(path) })) } : {}),
    ...(policy === undefined ? {} : { policy }),
    ...(reason === undefined ? {} : { reason }),
    sourcePath: manifestFacts?.sourcePath ?? item.sourcePath,
    sourceUnit: sourceUnitForLockItem(item, target),
    ...(standardProfile === undefined ? {} : { standardProfile }),
    status,
    ...(target === undefined ? {} : { target }),
  });
}

interface PluginManifestRenderFacts {
  readonly diagnostics: readonly SkillsetRenderResultDiagnosticRef[];
  readonly reason: string;
  readonly sourcePath: string;
  readonly status: SkillsetRenderResultStatus;
}

function pluginManifestRenderFacts(
  graph: BuildGraph,
  item: RenderedLockItem,
  target: TargetName | undefined
): PluginManifestRenderFacts | undefined {
  const authorFacts = pluginAuthorRenderFacts(graph, item, target);
  if (item.kind !== "plugin" || target === undefined) return authorFacts;
  const plugin = graph.plugins.find((candidate) => candidate.id === item.name);
  if (plugin === undefined) return authorFacts;
  const omissions = pluginManifestOmissions(graph, plugin, target, item.sourcePath);
  if (omissions.length === 0) return authorFacts;

  const diagnostics = omissions.map((omission) => omission.diagnostic);
  const reason = omissions.map((omission) => omission.reason).join("; ");
  const status = omissionStatus(omissions.map((omission) => omission.status));
  if (authorFacts === undefined) {
    return {
      diagnostics,
      reason,
      sourcePath: item.sourcePath,
      status,
    };
  }
  return {
    diagnostics: [...authorFacts.diagnostics, ...diagnostics],
    reason: `${authorFacts.reason}; ${reason}`,
    sourcePath: item.sourcePath,
    status: omissionStatus([authorFacts.status, status]),
  };
}

/** One canonical field a plugin manifest renderer has no destination for. */
interface PluginManifestOmission {
  readonly diagnostic: SkillsetRenderResultDiagnosticRef;
  readonly reason: string;
  readonly status: "degraded" | "lossy";
}

/**
 * Every canonical plugin field this target's manifest renderer drops, in a
 * stable order. Each dropped field must produce evidence: a manifest that
 * quietly reported `rendered` would let default policy accept metadata loss.
 */
function pluginManifestOmissions(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  sourcePath: string
): readonly PluginManifestOmission[] {
  return [
    ...(target === "claude"
      ? claudeListingDisplayNameOmissions(graph, plugin, sourcePath)
      : []),
    // The canonical listing category keeps its Cursor-scoped evidence: it names
    // the `cursor.manifest` cutover that removed the destination. The identical
    // Claude omission is a separate, wider decision because `listing.category`
    // is a documented field that Claude-only workspaces already build with.
    ...(target === "cursor"
      ? cursorListingCategoryOmissions(graph, plugin, sourcePath)
      : []),
    ...portableManifestOmissions(graph, plugin, target, sourcePath),
  ];
}

function claudeListingDisplayNameOmissions(
  graph: BuildGraph,
  plugin: SourcePlugin,
  sourcePath: string
): readonly PluginManifestOmission[] {
  const displayName = readString(
    readSourceListing(plugin.metadata),
    "display_name"
  );
  if (
    displayName === undefined ||
    pluginManifestDisplayName(graph, plugin, "claude") === displayName
  ) {
    return [];
  }
  const faithfulTargets = targetNames().filter(
    (target) =>
      pluginTargetSelected(graph, plugin.id, target) &&
      pluginManifestDisplayName(graph, plugin, target) === displayName
  );
  const isFaithfulElsewhere = faithfulTargets.length > 0;
  const reason =
    "Claude manifest displayName is replaced by claude.manifest.displayName; " +
    "omitted canonical field: listing.display_name; " +
    (isFaithfulElsewhere
      ? `still rendered by enabled target: ${faithfulTargets.map(targetLabel).join(", ")}`
      : "no enabled target renders this display name");
  return [
    {
      diagnostic: {
        code: "render/claude-listing-display-name-replaced",
        message: reason,
        path: `${sourcePath}: $.skillset.listing.display_name`,
      },
      reason,
      status: isFaithfulElsewhere ? "degraded" : "lossy",
    },
  ];
}

/**
 * Plugin-manifest destination each target renders the canonical listing
 * category into, with the value that destination actually carries. Codex lowers
 * the category to `interface.category` in `renderCodexInterface`; the pinned
 * Claude and Cursor plugin manifest formats have no category destination.
 * Declared per target so a new target has to state its own answer instead of
 * inheriting one.
 */
const PLUGIN_LISTING_CATEGORY_DESTINATIONS: Readonly<
  Record<TargetName, PluginListingCategoryDestination | undefined>
> = {
  claude: undefined,
  codex: {
    effectiveValue: codexInterfaceCategory,
    field: "interface.category",
  },
  cursor: undefined,
};

interface PluginListingCategoryDestination {
  /** Category the rendered manifest carries after provider overrides. */
  readonly effectiveValue: (
    graph: BuildGraph,
    plugin: SourcePlugin
  ) => string | undefined;
  /** Provider manifest field that destination writes. */
  readonly field: string;
}

/**
 * Enabled destinations that still render the authored category.
 *
 * Selection alone is not enough: a provider override such as
 * `codex.interface.category` keeps the destination while replacing the authored
 * value, which drops the canonical meaning just as completely as disabling the
 * target. `pluginTargetSelected` reads the compiled target set and the plugin's
 * own target selection, so a Cursor-only workspace correctly reports none.
 */
function faithfulListingCategoryDestinations(
  graph: BuildGraph,
  plugin: SourcePlugin,
  category: string
): readonly string[] {
  return targetNames().flatMap((target) => {
    const destination = PLUGIN_LISTING_CATEGORY_DESTINATIONS[target];
    return destination === undefined ||
      !pluginTargetSelected(graph, plugin.id, target) ||
      destination.effectiveValue(graph, plugin) !== category
      ? []
      : [`${targetLabel(target)} ${destination.field}`];
  });
}

function cursorListingCategoryOmissions(
  graph: BuildGraph,
  plugin: SourcePlugin,
  sourcePath: string
): readonly PluginManifestOmission[] {
  // Derive through the shared listing reader so the compatibility spellings
  // (`skillset.category`, `skillset.presentation.category`) count exactly like
  // the canonical `skillset.listing.category`.
  const category = readString(readSourceListing(plugin.metadata), "category");
  if (category === undefined) return [];
  // The authored meaning only survives the workspace while another enabled
  // target still renders the same category. In a Cursor-only workspace nothing
  // does, and neither does a Codex target whose `interface.category` override
  // replaced the authored value, so the value is dropped outright and policy
  // has to see it.
  const faithfulDestinations = faithfulListingCategoryDestinations(
    graph,
    plugin,
    category
  );
  const isFaithfulElsewhere = faithfulDestinations.length > 0;
  const reason =
    "Cursor plugin output has no verified runtime destination for canonical listing.category; " +
    "omitted canonical field: listing.category; " +
    (isFaithfulElsewhere
      ? `still rendered by enabled target: ${faithfulDestinations.join(", ")}`
      : "no enabled target renders this category, so the authored value is dropped; " +
        "move the value to cursor.manifest.category to keep the Cursor-native field");
  return [
    {
      diagnostic: {
        code: "render/cursor-listing-category-omitted",
        message: reason,
        path: `${sourcePath}: $.skillset.${authoredListingCategoryKey(plugin.metadata)}`,
      },
      reason,
      status: isFaithfulElsewhere ? "degraded" : "lossy",
    },
  ];
}

/**
 * Authored key that supplied the canonical listing category, using the same
 * precedence `readSourceListing` merges with, so the diagnostic points at a key
 * that exists in the author's source.
 */
function authoredListingCategoryKey(metadata: JsonRecord): string {
  if (readString(readRecord(metadata, "listing") ?? {}, "category") !== undefined) {
    return "listing.category";
  }
  if (readString(readRecord(metadata, "presentation") ?? {}, "category") !== undefined) {
    return "presentation.category";
  }
  return "category";
}

/**
 * Portable `skillset.manifest` keys each plugin manifest renderer consumes.
 * `renderPluginManifest` reads `name` for every target, and
 * `renderCursorPluginDisplayFields` adds the Cursor display fields. Declared per
 * target so a new target has to state its own answer instead of inheriting one.
 */
const RENDERED_PORTABLE_MANIFEST_KEYS: Readonly<
  Record<TargetName, readonly string[]>
> = {
  claude: ["name"],
  codex: ["name"],
  cursor: ["displayName", "logo", "name"],
};

/**
 * Effective plugin-manifest value a target carries for a portable manifest key.
 *
 * `renderPluginManifest` merges `<target>.manifest` over the rendered manifest,
 * so a provider-native override both supplies values the renderer has no
 * destination for (`cursor.manifest.category`) and replaces values it does
 * (`cursor.manifest.displayName`). Loss has to be read from the value the
 * manifest actually carries, not from the destination table alone.
 */
function effectivePortableManifestValue(
  plugin: SourcePlugin,
  target: TargetName,
  field: string
): JsonValue | undefined {
  const override = (readRecord(plugin.targets[target].options, "manifest") ?? {})[field];
  if (override !== undefined) return override;
  return RENDERED_PORTABLE_MANIFEST_KEYS[target].includes(field)
    ? readString(readRecord(plugin.metadata, "manifest") ?? {}, field)
    : undefined;
}

/**
 * Enabled targets whose rendered plugin manifest still carries the authored
 * portable value.
 *
 * Registered targets are not the right scope: a workspace compiled with
 * `targets: [claude]` renders no Cursor manifest at all, so `displayName` and
 * `logo` are dropped outright even though the Cursor renderer supports them
 * somewhere. `pluginTargetSelected` reads the compiled target set and the
 * plugin's own selection, matching `faithfulListingCategoryDestinations`.
 */
function faithfulPortableManifestTargets(
  graph: BuildGraph,
  plugin: SourcePlugin,
  field: string,
  value: JsonValue
): readonly TargetName[] {
  return targetNames().filter(
    (target) =>
      pluginTargetSelected(graph, plugin.id, target) &&
      sameJsonValue(effectivePortableManifestValue(plugin, target, field), value)
  );
}

/**
 * Structural comparison for authored-vs-rendered manifest values. Portable
 * manifest values come from parsed source, so a canonical serialization is
 * enough; anything that does not compare equal stays reported as omitted.
 */
function sameJsonValue(
  left: JsonValue | undefined,
  right: JsonValue | undefined
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : JSON.stringify(left) === JSON.stringify(right);
}

function portableManifestOmissions(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  sourcePath: string
): readonly PluginManifestOmission[] {
  const portableManifest = readRecord(plugin.metadata, "manifest") ?? {};
  const label = targetLabel(target);
  return SOURCE_PORTABLE_MANIFEST_KEYS.filter((field) => {
    const authored = portableManifest[field];
    return (
      authored !== undefined &&
      faithfulPortableManifestTargets(graph, plugin, field, authored).length === 0
    );
  }).map((field) => {
    // Only advise a provider-native override where the pinned plugin manifest
    // format actually accepts the field; elsewhere the advice would produce a
    // nonconformant artifact.
    const nativeOverride = listProviderPluginManifestFields(target).includes(field)
      ? `; move the value to ${target}.manifest.${field} to keep the ${label}-native field`
      : "";
    const reason =
      `${label} plugin output has no verified runtime destination for portable manifest.${field}; ` +
      `omitted canonical field: manifest.${field}; ` +
      `no enabled target renders this field, so the authored value is dropped${nativeOverride}`;
    return {
      diagnostic: {
        code: `render/${target}-portable-manifest-field-omitted`,
        message: reason,
        path: `${sourcePath}: $.skillset.manifest.${field}`,
      },
      reason,
      // No target renders these portable fields any more, so the authored
      // meaning is lost rather than degraded and policy has to see it.
      status: "lossy" as const,
    };
  });
}

function omissionStatus(
  statuses: readonly SkillsetRenderResultStatus[]
): SkillsetRenderResultStatus {
  return statuses.includes("lossy") ? "lossy" : "degraded";
}

function pluginAuthorRenderFacts(
  graph: BuildGraph,
  item: RenderedLockItem,
  target: TargetName | undefined
):
  | PluginManifestRenderFacts
  | undefined {
  if (
    item.kind !== "plugin" ||
    (target !== "claude" && target !== "codex" && target !== "cursor")
  )
    return undefined;
  const plugin = graph.plugins.find((candidate) => candidate.id === item.name);
  if (plugin === undefined) return undefined;
  const usesPluginAuthor = plugin.metadata.author !== undefined;
  const author = usesPluginAuthor ? plugin.metadata.author : graph.root.metadata.author;
  if (author === undefined) return undefined;
  // `<target>.manifest.author` is merged over the canonical projection, so loss
  // has to be read from the author the manifest actually carries.
  const canonical = readAuthorRecord(author);
  const effective = pluginManifestAuthor(graph, plugin, target);
  const omitted =
    canonical === undefined || effective === undefined
      ? target === "cursor"
        ? omittedCursorAuthorKeys(author)
        : omittedClaudeAuthorKeys(author)
      : omittedCanonicalAuthorKeys(canonical, effective);
  if (omitted.length === 0) return undefined;
  const providerName =
    target === "claude" ? "Claude" : target === "codex" ? "Codex" : "Cursor";
  const supportedFields =
    target === "cursor" ? "name and email" : "name, email, and url";
  const reason = `${providerName} author output supports only ${supportedFields}; omitted canonical fields: ${omitted.join(", ")}`;
  const authorSourcePath = usesPluginAuthor ? item.sourcePath : "skillset.yaml";
  return {
    diagnostics: [
      {
        code:
          target === "claude"
            ? "render/claude-author-fields-omitted"
            : target === "codex"
              ? "render/codex-author-fields-omitted"
              : "render/cursor-author-fields-omitted",
        message: reason,
        path: `${authorSourcePath}: $.skillset.author`,
      },
    ],
    reason,
    sourcePath: authorSourcePath,
    status: authorOmissionStatus(target, omitted),
  };
}

function authorOmissionStatus(
  target: "claude" | "codex" | "cursor",
  omitted: readonly string[]
): "degraded" | "lossy" {
  // Cursor has no author URL destination. The supported name/email projection
  // remains useful and the omission stays visible, but it does not become
  // policy-blocking unless additional authored fields are also dropped.
  return target === "cursor" &&
    omitted.length > 0 &&
    omitted.every((key) => key === "url")
    ? "degraded"
    : "lossy";
}

function outcomeForCompanionFile(
  graph: BuildGraph,
  file: RenderedFile,
  isIncluded: boolean,
  mapOutputPath: OutputPathMapper
): SkillsetRenderResult | undefined {
  const companion = companionForPath(graph, file.path);
  if (companion === undefined) return undefined;
  const plugin = graph.plugins.find((candidate) => candidate.id === companion.pluginId);
  const sourcePath = plugin === undefined
    ? undefined
    : normalizePath(relative(graph.rootPath, join(plugin.path, companion.sourceRelativePath)));
  const evidence = evidenceFor(companion.featureId, companion.target);
  return defineRenderResult({
    destination: companion.featureKey,
    ...(evidence === undefined ? {} : { evidence }),
    featureId: companion.featureId,
    ...(isIncluded ? { outputs: [{ kind: "companion", path: mapOutputPath(file.path) }] } : {}),
    ...(isIncluded ? {} : { policy: "scope:excluded" as const, reason: "excluded by build scope" }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    sourceUnit: selectorForPluginFeature(companion.pluginId, companion.featureKey),
    status: isIncluded ? "target_native" : "intentionally_skipped",
    target: companion.target,
  });
}

function featureOutcomesForLockItem(
  graph: BuildGraph,
  item: RenderedLockItem,
  outputPaths: readonly string[],
  renderedOutputPaths: readonly string[],
  includedPaths: ReadonlySet<string>,
  mapOutputPath: OutputPathMapper,
  subject: RenderResultSubject
): readonly SkillsetRenderResult[] {
  const { standardProfile, target } = subject;
  const outcomes: SkillsetRenderResult[] = [];

  if (item.kind === "plugin" && standardProfile === "agent-plugins-1.0") {
    const mcpOutputPaths = outputPaths.filter((path) =>
      path.endsWith("/agents/mcp.json")
    );
    const plugin = graph.plugins.find((candidate) => candidate.id === item.name);
    const feature = plugin?.features.find(
      (candidate) => candidate.key === "mcp"
    );
    if (feature !== undefined && mcpOutputPaths.length > 0) {
      outcomes.push(
        featureOutcome({
          destination: "mcp",
          featureId: "plugin-mcp",
          isIncluded: mcpOutputPaths.some((path) => includedPaths.has(path)),
          mapOutputPath,
          outputKind: "plugin",
          outputPaths: mcpOutputPaths,
          sourcePath: normalizeSourcePath(graph, feature.sourcePath),
          sourceUnit: selectorForPluginFeature(item.name, "mcp"),
          standardProfile,
          status: "rendered",
          target,
        })
      );
    }
  }

  if (item.kind === "plugin" && item.dependencies !== undefined && item.dependencies.length > 0) {
    const supportedDependencyStatus = dependencyRenderStatus(target, standardProfile);
    const dependencyDestination =
      supportedDependencyStatus === "rendered"
        ? "plugin-manifest"
        : supportedDependencyStatus === "degraded"
          ? "skill-body"
          : "plugin";
    const dependencyOutputs = dependencyOutputPaths(
      graph,
      item.name,
      target,
      renderedOutputPaths,
      dependencyDestination
    );
    const dependencyStatus =
      supportedDependencyStatus === "degraded" &&
      dependencyOutputs.length === 0
        ? "unsupported"
        : supportedDependencyStatus;
    outcomes.push(
      featureOutcome({
        destination: dependencyDestination,
        featureId: "dependencies",
        isIncluded: outputPaths.some((path) => includedPaths.has(path)),
        mapOutputPath,
        outputKind:
          dependencyDestination === "skill-body" ? "plugin-skill" : item.kind,
        outputPaths: dependencyOutputs,
        sourcePath: item.sourcePath,
        sourceUnit: selectorForPluginFeature(item.name, "dependencies"),
        status: dependencyStatus,
        ...(standardProfile === undefined ? {} : { standardProfile }),
        target,
      })
    );
  }

  const invocationPolicy = invocationPolicyForLockItem(graph, item, target);
  if (invocationPolicy !== undefined) {
    const invocationOutputPaths = outputPaths.filter((path) =>
      target === "codex"
        ? path.endsWith("/agents/openai.yaml")
        : path.endsWith("/SKILL.md") || path === "SKILL.md"
    );
    outcomes.push(
      featureOutcome({
        destination:
          target === "codex" ? "skill-agent-config" : "skill-frontmatter",
        ...(invocationPolicy.nativeOverride
          ? {
              diagnostics: [
                {
                  code: "skill-invocation-policy-native-override",
                  message: `${target}.frontmatter.disable-model-invocation overrides the derived canonical invocation policy`,
                  path: item.sourcePath,
                },
              ],
            }
          : {}),
        featureId: "skill-invocation-policy",
        isIncluded: invocationOutputPaths.some((path) => includedPaths.has(path)),
        mapOutputPath,
        outputKind: "metadata",
        outputPaths: invocationOutputPaths,
        sourcePath: item.sourcePath,
        sourceUnit: sourceUnitForLockItem(item, target),
        status: "transformed",
        ...(standardProfile === undefined ? {} : { standardProfile }),
        target,
      })
    );
  }

  const claudeToolIntentOutputPaths =
    target === "claude" && skillHasClaudeToolIntent(graph, item)
      ? outputPaths.filter((path) => path.endsWith("/SKILL.md") || path === "SKILL.md")
      : [];
  if (claudeToolIntentOutputPaths.length > 0) {
    const plan = toolsRealizationPlanForLockItem(graph, item, "claude");
    outcomes.push(
      featureOutcome({
        destination: "skill-frontmatter",
        ...toolsPlanRenderFacts(plan, item.sourcePath),
        featureId: "tools-policy",
        isIncluded: claudeToolIntentOutputPaths.some((path) => includedPaths.has(path)),
        mapOutputPath,
        outputKind: "metadata",
        outputPaths: claudeToolIntentOutputPaths,
        sourcePath: item.sourcePath,
        sourceUnit: sourceUnitForLockItem(item, target),
        status: toolsFrontmatterStatus(plan),
        ...(standardProfile === undefined ? {} : { standardProfile }),
        target,
      })
    );
  }

  const toolIntentOutputPaths = outputPaths.filter((path) => path.endsWith("/.skillset.tools.yaml"));
  if (toolIntentOutputPaths.length > 0 && target !== undefined) {
    const plan = toolsRealizationPlanForLockItem(graph, item, target);
    outcomes.push(
      featureOutcome({
        destination: "skill-tools",
        ...toolsPlanRenderFacts(plan, item.sourcePath),
        featureId: "tools-policy",
        isIncluded: toolIntentOutputPaths.some((path) => includedPaths.has(path)),
        mapOutputPath,
        outputKind: "metadata",
        outputPaths: toolIntentOutputPaths,
        sourcePath: item.sourcePath,
        sourceUnit: sourceUnitForLockItem(item, target),
        status: renderResultStatusForToolsTier("metadata-only"),
        ...(standardProfile === undefined ? {} : { standardProfile }),
        target,
      })
    );
  }

  return outcomes;
}

export function dependencyRenderStatus(
  target: TargetName | undefined,
  standardProfile?: StandardProfileId
): SkillsetRenderResultStatus {
  if (target !== undefined && standardProfile !== undefined) {
    throw new Error(
      "skillset: dependency render identity cannot name both a provider target and a standardProfile"
    );
  }
  if (standardProfile !== undefined) {
    return getStandardProfileSupportEnvelope(
      standardProfile,
      "dependencies"
    )?.expectation === "required"
      ? "rendered"
      : "unsupported";
  }
  if (target === undefined) return "unsupported";
  const support = getSkillsetFeature("dependencies")?.targetSupport[target];
  if (support?.status === "native") return "rendered";
  if (support?.status === "degraded") return "degraded";
  return "unsupported";
}

function dependencyOutputPaths(
  graph: BuildGraph,
  pluginId: string,
  target: TargetName | undefined,
  outputPaths: readonly string[],
  destination: "plugin" | "plugin-manifest" | "skill-body"
): readonly string[] {
  if (target === undefined) return [];
  if (destination === "plugin") return [];
  if (destination === "plugin-manifest") {
    const manifestPath = pluginManifestPath(
      graph.root.outputs.plugins[target],
      target,
      graph.plugins.find((plugin) => plugin.id === pluginId) ?? { id: pluginId }
    );
    return outputPaths.filter((path) => path === manifestPath);
  }
  return outputPaths.filter((path) => {
    const parts = pluginPathPartsForOutput(
      graph,
      graph.root.outputs.plugins[target],
      target,
      path
    );
    return (
      parts?.pluginId === pluginId &&
      parts.pluginPath.startsWith("skills/") &&
      parts.pluginPath.endsWith("/SKILL.md")
    );
  });
}

function skillHasClaudeToolIntent(graph: BuildGraph, item: RenderedLockItem): boolean {
  const skill = sourceSkillForLockItem(graph, item);
  if (skill === undefined) return false;
  const rules = readClaudeNativeToolRules(skill.frontmatter, skill.targets.claude.options, item.sourcePath);
  return rules.allow.length > 0 || rules.deny.length > 0;
}

function invocationPolicyForLockItem(
  graph: BuildGraph,
  item: RenderedLockItem,
  target: TargetName | undefined
): { readonly nativeOverride: boolean } | undefined {
  if (target === undefined) return undefined;
  const skill = sourceSkillForLockItem(graph, item);
  if (skill === undefined) return undefined;
  const implicitInvocation = readImplicitInvocation(
    skill.frontmatter,
    target,
    item.sourcePath
  );
  if (implicitInvocation === undefined) return undefined;
  const targetFrontmatter = readRecord(skill.targets[target].options, "frontmatter");
  return {
    nativeOverride:
      target !== "codex" &&
      targetFrontmatter?.["disable-model-invocation"] !== undefined,
  };
}

function toolsRealizationPlanForLockItem(
  graph: BuildGraph,
  item: RenderedLockItem,
  target: TargetName
): ToolsRealizationPlan | undefined {
  const skill = sourceSkillForLockItem(graph, item);
  if (skill === undefined) return undefined;
  const policy = readEffectiveToolsPolicy(skill.frontmatter, skill.targets[target].options, target, item.sourcePath);
  if (!policy.hasSource) return undefined;
  return planToolsRealization(policy);
}

interface ToolsPlanRenderFacts {
  readonly diagnostics?: readonly SkillsetRenderResultDiagnosticRef[];
  readonly evidence?: readonly SkillsetFeatureEvidence[];
}

/**
 * Registry-backed render facts for a tools-policy outcome: the plan's
 * realization diagnostics become structured diagnostic refs and the plan's
 * registry evidence replaces the coarse feature-level evidence.
 */
function toolsPlanRenderFacts(
  plan: ToolsRealizationPlan | undefined,
  sourcePath: string
): ToolsPlanRenderFacts {
  if (plan === undefined) return {};
  const messages = [...new Set(plan.entries.flatMap((entry) => entry.diagnostics))].sort(compareStrings);
  const evidence = uniqueToolsEvidence(plan.entries.flatMap((entry) => entry.evidence));
  return {
    ...(messages.length === 0
      ? {}
      : {
          diagnostics: messages.map((message) => ({
            code: "tools-policy-realization",
            message,
            path: sourcePath,
          })),
        }),
    ...(evidence.length === 0 ? {} : { evidence }),
  };
}

function toolsFrontmatterStatus(plan: ToolsRealizationPlan | undefined): SkillsetRenderResultStatus {
  if (plan === undefined) return "transformed";
  const rendered = plan.entries.filter((entry) => entry.emits.length > 0);
  if (rendered.some((entry) => entry.kind === "portable")) {
    return renderResultStatusForToolsTier("transformed");
  }
  return renderResultStatusForToolsTier("native");
}

function uniqueToolsEvidence(evidence: readonly SkillsetFeatureEvidence[]): readonly SkillsetFeatureEvidence[] {
  const seen = new Set<string>();
  const unique: SkillsetFeatureEvidence[] = [];
  for (const item of evidence) {
    const key = `${item.kind}\0${item.ref}\0${item.verifiedAt ?? ""}\0${item.note ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function sourceSkillForLockItem(graph: BuildGraph, item: RenderedLockItem): SourceSkill | undefined {
  if (item.kind === "standalone-skill") {
    return graph.standaloneSkills.find((skill) => skill.id === item.name);
  }
  if (item.kind !== "plugin-skill" || item.plugin === undefined) return undefined;
  return graph.plugins
    .find((plugin) => plugin.id === item.plugin)
    ?.skills.find((skill) => skill.id === item.name);
}

function unsupportedAdaptiveHookOutcomes(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly SkillsetRenderResult[] {
  if (scopes !== undefined && !scopes.includes("plugins") && !scopes.includes("project") && !scopes.includes("user")) {
    return [];
  }

  const featureId = "adaptive-hooks";
  const outcomes: SkillsetRenderResult[] = [];
  for (const target of TARGETS) {
    for (const item of resolveAdaptiveHookAttachmentsForTarget(graph.adaptiveHooks, graph.hookAttachments, target).resolved) {
      if (!providerListAllows(item.definition.providers, target) || !providerListAllows(item.attachment.providers, target)) {
        continue;
      }
      if (!isAdaptiveHookScopeRenderedForTarget(graph, item.attachment.scope, target, scopes)) continue;
      const destination = unsupportedAdaptiveHookDestination(item.attachment.scope);
      if (destination === undefined) continue;
      const reason = unsupportedAdaptiveHookReason(item, target);
      if (reason === undefined) continue;

      const sourceUnit = sourceUnitForAdaptiveHookScope(item.attachment.scope);
      if (sourceUnit === undefined) continue;
      const sourcePath = normalizeSourcePath(graph, item.attachment.sourcePath);
      const evidence = evidenceFor(featureId, target);
      outcomes.push(
        defineRenderResult({
          destination,
          ...(evidence === undefined ? {} : { evidence }),
          featureId,
          policy: "unsupported:error",
          reason,
          sourcePath,
          sourceUnit,
          status: "unsupported",
          target,
          diagnostics: [{ code: "adaptive-hook-destination-unsupported", message: reason, path: sourcePath }],
        })
      );
    }
  }
  return outcomes;
}

function unsupportedAdaptiveHookDestination(scope: AdaptiveHookScope): string | undefined {
  if (scope.kind === "skill") return "skill-frontmatter";
  if (scope.kind === "agent") return "agent-frontmatter";
  if (scope.kind === "plugin") return "hooks";
  return undefined;
}

function unsupportedAdaptiveHookReason(item: ResolvedAdaptiveHookAttachment, target: TargetName): string | undefined {
  const scope = item.attachment.scope;
  const support = scope.kind === "skill"
    ? hookProviderCapabilities[target].scopeSupport.skill
    : scope.kind === "agent"
    ? hookProviderCapabilities[target].scopeSupport.agent
    : scope.kind === "plugin"
    ? hookProviderCapabilities[target].scopeSupport.plugin
    : undefined;
  if (support === "unsupported") {
    const destination = scope.kind === "skill"
      ? "skill-local"
      : scope.kind === "agent"
      ? "project-agent"
      : "plugin";
    return `${targetLabel(target)} has no faithful ${destination} hook destination for adaptive hook attachments.`;
  }
  const surface = adaptiveHookRenderSurfaceForScope(scope);
  if (surface !== undefined) return adaptiveHookUnsupportedRenderReason(item, target, surface);
  return undefined;
}

function adaptiveHookRenderSurfaceForScope(scope: AdaptiveHookScope): AdaptiveHookRenderSurface | undefined {
  if (scope.kind === "plugin") return "plugin";
  if (scope.kind === "skill" || scope.kind === "agent") return "frontmatter";
  return undefined;
}

function isAdaptiveHookScopeRenderedForTarget(
  graph: BuildGraph,
  scope: AdaptiveHookScope,
  target: TargetName,
  scopes: readonly BuildScope[] | undefined
): boolean {
  if (scope.kind === "skill") {
    if (scope.pluginId !== undefined) {
      if (scopes !== undefined && !scopes.includes("plugins")) return false;
      const plugin = graph.plugins.find((candidate) => candidate.id === scope.pluginId);
      const skill = plugin?.skills.find((candidate) => candidate.id === scope.skillId);
      return plugin !== undefined &&
        skill !== undefined &&
        pluginTargetSelected(graph, plugin.id, target) &&
        skill.targets[target].enabled;
    }

    if (scopes !== undefined && !scopes.includes("user")) return false;
    const skill = graph.standaloneSkills.find((candidate) => candidate.id === scope.skillId);
    return skill !== undefined &&
      skill.targets[target].enabled &&
      isOutputSelected(graph.root.outputs.targetOutputs[target].skills, skill.id);
  }

  if (scope.kind === "agent") {
    if (scopes !== undefined && !scopes.includes("project")) return false;
    const agent = graph.projectAgents.find((candidate) => candidate.outputName === scope.agentId);
    return agent !== undefined && agent.targets[target].enabled;
  }

  if (scope.kind === "plugin") {
    if (scopes !== undefined && !scopes.includes("plugins")) return false;
    return scope.pluginId !== undefined && pluginTargetSelected(graph, scope.pluginId, target);
  }

  return false;
}

function sourceUnitForAdaptiveHookScope(scope: AdaptiveHookScope): string | undefined {
  if (scope.kind === "skill") {
    if (scope.skillId === undefined) return undefined;
    return scope.pluginId === undefined
      ? selectorForStandaloneSkill(scope.skillId)
      : selectorForPluginSkill(scope.pluginId, scope.skillId);
  }
  if (scope.kind === "agent" && scope.agentId !== undefined) return selectorForProjectAgent(scope.agentId);
  if (scope.kind === "plugin" && scope.pluginId !== undefined) return selectorForPluginFeature(scope.pluginId, "hooks");
  return undefined;
}

function featureOutcome(args: {
  readonly destination: string;
  readonly diagnostics?: readonly SkillsetRenderResultDiagnosticRef[];
  readonly evidence?: readonly SkillsetFeatureEvidence[];
  readonly featureId: string;
  readonly isIncluded: boolean;
  readonly mapOutputPath: OutputPathMapper;
  readonly outputKind: string;
  readonly outputPaths: readonly string[];
  readonly sourcePath: string;
  readonly sourceUnit: string;
  readonly standardProfile?: StandardProfileId;
  readonly status: SkillsetRenderResultStatus;
  readonly target: TargetName | undefined;
}): SkillsetRenderResult {
  const status: SkillsetRenderResultStatus = args.isIncluded ? args.status : "intentionally_skipped";
  const evidence =
    args.evidence ??
    evidenceFor(args.featureId, args.target, args.standardProfile);
  const reason = args.isIncluded
    ? reasonForStatus(
        args.featureId,
        args.target,
        status,
        args.standardProfile
      )
    : "excluded by build scope";

  return defineRenderResult({
    destination: args.destination,
    ...(args.diagnostics === undefined ? {} : { diagnostics: args.diagnostics }),
    ...(evidence === undefined ? {} : { evidence }),
    featureId: args.featureId,
    ...(args.isIncluded && args.outputPaths.length > 0
      ? { outputs: args.outputPaths.map((path) => ({ kind: args.outputKind, path: args.mapOutputPath(path) })) }
      : {}),
    ...(args.isIncluded ? {} : { policy: "scope:excluded" as const }),
    ...(reason === undefined ? {} : { reason }),
    sourcePath: args.sourcePath,
    sourceUnit: args.sourceUnit,
    ...(args.standardProfile === undefined
      ? {}
      : { standardProfile: args.standardProfile }),
    status,
    ...(args.target === undefined ? {} : { target: args.target }),
  });
}

function unsupportedPluginFeatureOutcomes(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly SkillsetRenderResult[] {
  if (scopes !== undefined && !scopes.includes("plugins")) return [];
  const outcomes: SkillsetRenderResult[] = [];
  for (const plugin of graph.plugins) {
    const pluginPath = normalizePath(relative(graph.rootPath, plugin.path));

    for (const target of TARGETS.filter((candidate) => candidate !== "claude")) {
      if (!pluginTargetSelected(graph, plugin.id, target)) continue;
      for (const feature of plugin.features) {
        if (feature.key !== "bin") continue;
        const featureId = "plugin-bin";
        const evidence = evidenceFor(featureId, target);
        outcomes.push(
          defineRenderResult({
            destination: "bin",
            ...(evidence === undefined ? {} : { evidence }),
            featureId,
            policy: "unsupported:error",
            reason: requiredReasonForStatus(featureId, target, "unsupported"),
            sourcePath: normalizePath(relative(graph.rootPath, feature.sourcePath)),
            sourceUnit: selectorForPluginFeature(plugin.id, feature.key),
            status: "unsupported",
            target,
          })
        );
      }
    }

    if (!pluginTargetSelected(graph, plugin.id, "codex")) continue;
    const agentsPath = join(plugin.path, "agents");
    if (!hasMeaningfulFiles(agentsPath)) continue;
    const featureId = "plugin-agents";
    const evidence = evidenceFor(featureId, "codex");
    outcomes.push(
      defineRenderResult({
        destination: "agents",
        ...(evidence === undefined ? {} : { evidence }),
        featureId,
        policy: "unsupported:error",
        reason: requiredReasonForStatus(featureId, "codex", "unsupported"),
        sourcePath: `${pluginPath}/agents`,
        sourceUnit: selectorForPluginFeature(plugin.id, "agents"),
        status: "unsupported",
        target: "codex",
      })
    );
  }
  return outcomes;
}

function unsupportedAgentPluginStandardOutcomes(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly SkillsetRenderResult[] {
  if (
    (scopes !== undefined && !scopes.includes("plugins")) ||
    !graph.root.compile.agents.plugins ||
    !graph.standardProjections.adopted.includes("agent-plugins-1.0")
  ) {
    return [];
  }

  const outcomes: SkillsetRenderResult[] = [];
  for (const plugin of graph.plugins) {
    const pluginPath = normalizePath(relative(graph.rootPath, plugin.path));
    const classification = classifyAgentPluginStandard(plugin);
    if (classification.status === "unsupported") {
      outcomes.push(
        defineRenderResult({
          destination: "plugin-manifest",
          evidence:
            evidenceFor("plugin-manifests", undefined, "agent-plugins-1.0") ??
            [],
          featureId: "plugin-manifests",
          policy: "unsupported:error",
          reason:
            classification.reason ??
            "plugin does not satisfy the Agent Plugins 1.0 manifest contract",
          sourcePath: normalizeSourcePath(graph, plugin.configPath),
          sourceUnit: selectorForPluginConfig(plugin.id),
          standardProfile: "agent-plugins-1.0",
          status: "unsupported",
        })
      );
      continue;
    }

    for (const feature of plugin.features) {
      if (feature.key !== "app" && feature.key !== "bin") continue;
      const featureId = feature.key === "app" ? "plugin-apps" : "plugin-bin";
      outcomes.push(
        unsupportedAgentPluginFeatureOutcome({
          destination: feature.key,
          featureId,
          plugin,
          sourcePath: normalizeSourcePath(graph, feature.sourcePath),
          sourceUnit: selectorForPluginFeature(plugin.id, feature.key),
        })
      );
    }

    for (const [relativePath, featureId] of [
      ["hooks", "plugin-hooks"],
      ["agents", "plugin-agents"],
      ["commands", "plugin-commands"],
      ["rules", "plugin-rules"],
      [".lsp.json", "plugin-lsp-servers"],
      ["settings.json", "future-companion-source-pointers"],
      ["themes", "plugin-themes"],
      ["monitors", "plugin-monitors"],
      ["output-styles", "plugin-output-styles"],
    ] as const) {
      const sourcePath = join(plugin.path, relativePath);
      if (!hasMeaningfulFiles(sourcePath)) continue;
      outcomes.push(
        unsupportedAgentPluginFeatureOutcome({
          destination: relativePath,
          featureId,
          plugin,
          sourcePath: `${pluginPath}/${relativePath}`,
          sourceUnit: selectorForPluginFeature(plugin.id, relativePath),
        })
      );
    }

    if (
      plugin.adaptiveHooks.length > 0 &&
      !hasMeaningfulFiles(join(plugin.path, "hooks"))
    ) {
      outcomes.push(
        unsupportedAgentPluginFeatureOutcome({
          destination: "hooks",
          featureId: "plugin-hooks",
          plugin,
          sourcePath: normalizeSourcePath(graph, plugin.configPath),
          sourceUnit: selectorForPluginFeature(plugin.id, "hooks"),
        })
      );
    }
  }
  return outcomes;
}

function unsupportedMcpOutcomes(
  graph: BuildGraph,
  scopes: readonly BuildScope[] | undefined
): readonly SkillsetRenderResult[] {
  if (scopes !== undefined && !scopes.includes("plugins")) return [];
  const outcomes: SkillsetRenderResult[] = [];
  const standardSelected =
    graph.root.compile.agents.plugins &&
    graph.standardProjections.adopted.includes("agent-plugins-1.0");
  for (const plugin of graph.plugins) {
    const feature = plugin.features.find((candidate) => candidate.key === "mcp");
    const model = feature?.portableMcp;
    if (feature === undefined || model === undefined) continue;
    const sourcePath = normalizePath(
      relative(graph.rootPath, feature.sourcePath)
    );
    const sourceUnit = selectorForPluginFeature(plugin.id, feature.key);

    if (standardSelected) {
      for (const entry of model.unsupported) {
        outcomes.push(
          defineRenderResult({
            destination: "mcp",
            evidence:
              evidenceFor("plugin-mcp", undefined, "agent-plugins-1.0") ?? [],
            featureId: "plugin-mcp",
            policy: "unsupported:error",
            reason: unsupportedMcpReason(entry),
            sourcePath,
            sourceUnit,
            standardProfile: "agent-plugins-1.0",
            status: "unsupported",
          })
        );
      }
    }

    for (const target of TARGETS) {
      if (!pluginTargetSelected(graph, plugin.id, target)) continue;
      for (const entry of model.unsupported) {
        outcomes.push(
          defineRenderResult({
            destination: "mcp",
            featureId: "plugin-mcp",
            policy: "unsupported:error",
            reason: unsupportedMcpReason(entry),
            sourcePath,
            sourceUnit,
            status: "unsupported",
            target,
          })
        );
      }
      for (const entry of model.providerUnsupported.filter(
        (candidate) => candidate.target === target
      )) {
        outcomes.push(
          defineRenderResult({
            destination: "mcp",
            evidence: entry.evidence.sources.map((source) => ({
              kind: "external-docs",
              note: source.note,
              ref: source.url,
              verifiedAt: entry.evidence.observedAt,
            })),
            featureId: "plugin-mcp",
            policy: "unsupported:error",
            reason: `MCP server ${entry.name} is unsupported: ${entry.reason}`,
            sourcePath,
            sourceUnit,
            status: "unsupported",
            target,
          })
        );
      }
    }
  }
  return outcomes;
}

function unsupportedMcpReason(entry: {
  readonly fields: readonly string[];
  readonly name: string;
  readonly reason: string;
}): string {
  return `MCP server ${entry.name} is unsupported: ${entry.reason}; fields: ${entry.fields.join(", ")}`;
}

function unsupportedAgentPluginFeatureOutcome(args: {
  readonly destination: string;
  readonly featureId: string;
  readonly plugin: SourcePlugin;
  readonly sourcePath: string;
  readonly sourceUnit: string;
}): SkillsetRenderResult {
  const evidence = evidenceFor(args.featureId, undefined, "agent-plugins-1.0");
  return defineRenderResult({
    destination: args.destination,
    ...(evidence === undefined ? {} : { evidence }),
    featureId: args.featureId,
    policy: "unsupported:error",
    reason: `agent-plugins-1.0 does not declare ${args.featureId} in its support envelope`,
    sourcePath: args.sourcePath,
    sourceUnit: args.sourceUnit,
    standardProfile: "agent-plugins-1.0",
    status: "unsupported",
  });
}

function hasMeaningfulFiles(path: string): boolean {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
  if (stats.isSymbolicLink()) return !isPlaceholderFile(path);
  if (stats.isFile()) return !isPlaceholderFile(path);
  if (!stats.isDirectory()) return false;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (isPlaceholderFile(entry.name)) continue;
    if (entry.isSymbolicLink()) return true;
    if (hasMeaningfulFiles(join(path, entry.name))) return true;
  }
  return false;
}

function isPlaceholderFile(path: string): boolean {
  const name = path.split("/").pop();
  return name === ".gitkeep" || name === ".keep" || name === ".DS_Store";
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function outputPathsForLockItem(outputRoot: string, item: RenderedLockItem): readonly string[] {
  const files = item.files.length > 0 ? item.files : [item.outputPath];
  return files.map((file) => joinOutputPath(outputRoot, file)).sort(compareStrings);
}

function joinOutputPath(outputRoot: string, path: string): string {
  return normalizePath(outputRoot === "." ? path : join(outputRoot, path));
}

function featureIdForLockItem(item: RenderedLockItem): string {
  if (item.kind === "standalone-skill") return "standalone-skills";
  if (item.kind === "plugin-skill") return "plugin-skills";
  if (item.kind === "plugin") return "plugin-manifests";
  if (item.kind === "rule") return "project-instructions";
  if (item.kind === "project-agent") return "project-agents";
  if (item.kind === "island") return "target-native-islands";
  if (item.kind === "changelog") return "releases";
  if (item.kind === "plugin-feature" && item.feature === "app") {
    return "plugin-apps";
  }
  if (item.kind === "plugin-feature" && item.feature === "mcp") return "plugin-mcp";
  if (item.kind === "plugin-feature" && item.feature === "bin") return "plugin-bin";
  return item.feature ?? item.kind;
}

/**
 * Concrete output artifact/scope (the `destination`) a lock item renders to,
 * under its provider `target`. Collapses the skill features into the single
 * `skill` artifact and names manifests/instructions/agents/provider source explicitly,
 * so `destination` describes where output lands rather than which capability
 * produced it (`featureId`).
 */
function destinationForLockItem(item: RenderedLockItem): string {
  if (item.kind === "standalone-skill" || item.kind === "plugin-skill") return "skill";
  if (item.kind === "plugin") return "plugin-manifest";
  if (item.kind === "rule") return "instruction";
  if (item.kind === "project-agent") return "agent";
  if (item.kind === "island") return "target-native-island";
  if (item.kind === "changelog") return "changelog";
  // Plugin feature artifacts use the bare scope name (e.g. `mcp`, `bin`), the
  // same convention companion files use via their featureKey, so a given
  // destination is named identically across producers and never just mirrors
  // the `plugin-`-prefixed featureId.
  if (item.kind === "plugin-feature" && item.feature !== undefined) return item.feature;
  return item.feature ?? item.kind;
}

function sourceUnitForLockItem(item: RenderedLockItem, target: TargetName | undefined): string {
  if (item.kind === "standalone-skill") return selectorForStandaloneSkill(item.name);
  if (item.kind === "plugin-skill" && item.plugin !== undefined) {
    return selectorForPluginSkill(item.plugin, item.name);
  }
  if (item.kind === "plugin") return selectorForPluginConfig(item.name);
  if (item.kind === "plugin-feature" && item.plugin !== undefined && item.feature !== undefined) {
    return selectorForPluginFeature(item.plugin, item.feature);
  }
  if (item.kind === "rule") return selectorForInstruction(item.name);
  if (item.kind === "project-agent") return selectorForProjectAgent(item.name);
  if (item.kind === "island") return sourceUnitForIsland(item, target);
  return item.sourcePath;
}

function sourceUnitForIsland(item: RenderedLockItem, target: TargetName | undefined): string {
  const [nameTarget, owner, ...relativeParts] = item.name.split(":");
  const islandTarget = target ?? (isTargetName(nameTarget) ? nameTarget : undefined);
  if (islandTarget === undefined) return item.sourcePath;
  const relativePath = relativeParts.join(":") || item.outputPath;
  if (owner !== undefined && owner !== "project") {
    return selectorForTargetNativeIsland(islandTarget, `plugin:${owner}`, relativePath);
  }
  return selectorForTargetNativeIsland(islandTarget, "project", relativePath);
}

function statusForLockItem(item: RenderedLockItem, target: TargetName | undefined): SkillsetRenderResultStatus {
  if (item.kind === "changelog") return "metadata_only";
  if (item.kind === "island" || item.kind === "plugin-feature") return "target_native";
  if (item.kind === "rule") return "transformed";
  if (item.kind === "project-agent" && target === "codex") return "transformed";
  if (item.transforms !== undefined && item.transforms.length > 0) return "transformed";
  if (item.validation === "opaque-copy") return "target_native";
  return "rendered";
}

function resultSubjectsForLockItem(
  graph: BuildGraph,
  lock: RenderedLock,
  item: RenderedLockItem,
  outputPaths: readonly string[]
): readonly RenderResultSubject[] {
  if (item.consumers.length > 0) {
    return item.consumers.map((consumer) =>
      "standardProfile" in consumer
        ? { standardProfile: consumer.standardProfile }
        : { target: consumer.target }
    );
  }
  if (item.owner !== undefined) {
    return [
      "standardProfile" in item.owner
        ? { standardProfile: item.owner.standardProfile }
        : { target: item.owner.target },
    ];
  }
  const target = targetForLockItem(graph, lock, item, outputPaths);
  return [target === undefined ? {} : { target }];
}

function targetForLockItem(
  graph: BuildGraph,
  lock: RenderedLock,
  item: RenderedLockItem,
  outputPaths: readonly string[]
): TargetName | undefined {
  if (lock.target !== "workspace") return lock.target;
  if (item.kind === "rule" && outputPaths.some((path) => path === "AGENTS.md" || path.endsWith("/AGENTS.md"))) {
    return "codex";
  }
  for (const path of outputPaths) {
    const target = targetForOutputPath(graph, path);
    if (target !== undefined) return target;
  }
  return undefined;
}

function targetForOutputPath(graph: BuildGraph, path: string): TargetName | undefined {
  const pluginTarget = pluginTargetForOutputPath(graph, path);
  if (pluginTarget !== undefined) return pluginTarget;
  for (const target of TARGETS) {
    if (isInsideOutputRoot(path, graph.root.outputs.skills[target])) return target;
    if (isInsideOutputRoot(path, targetProjectRoot(graph, target))) return target;
  }
  return undefined;
}

function companionForPath(
  graph: BuildGraph,
  path: string
):
  | {
      readonly featureId: string;
      readonly featureKey: string;
      readonly pluginId: string;
      readonly sourceRelativePath: string;
      readonly target: TargetName;
    }
  | undefined {
  for (const target of TARGETS) {
    const outputRoot = graph.root.outputs.plugins[target];
    const parts = pluginPathPartsForOutput(graph, outputRoot, target, path);
    if (parts === undefined) continue;
    const { pluginId, pluginPath } = parts;
    if (pluginPath === "README.md") {
      return { featureId: "plugin-readme", featureKey: "readme", pluginId, sourceRelativePath: "README.md", target };
    }
    if (pluginPath === ".app.json") {
      return { featureId: "plugin-apps", featureKey: "app", pluginId, sourceRelativePath: ".app.json", target };
    }
    if (target === "claude" && pluginPath === ".lsp.json") {
      return { featureId: "plugin-lsp-servers", featureKey: "lsp-servers", pluginId, sourceRelativePath: ".lsp.json", target };
    }
    if ((target === "claude" || target === "cursor") && isCompanionPath(pluginPath, "commands")) {
      return { featureId: "plugin-commands", featureKey: "commands", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (pluginPath === "hooks/hooks.json" || pluginPath.startsWith("hooks/")) {
      return { featureId: "plugin-hooks", featureKey: "hooks", pluginId, sourceRelativePath: pluginPath, target };
    }
    if ((target === "claude" || target === "cursor") && isCompanionPath(pluginPath, "agents")) {
      return { featureId: "plugin-agents", featureKey: "agents", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "cursor" && isCompanionPath(pluginPath, "rules")) {
      return { featureId: "plugin-rules", featureKey: "rules", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "claude" && isCompanionPath(pluginPath, "output-styles")) {
      return { featureId: "plugin-output-styles", featureKey: "output-styles", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "claude" && isCompanionPath(pluginPath, "themes")) {
      return { featureId: "plugin-themes", featureKey: "themes", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (target === "claude" && isCompanionPath(pluginPath, "monitors")) {
      return { featureId: "plugin-monitors", featureKey: "monitors", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (isCompanionPath(pluginPath, "assets")) {
      return { featureId: "plugin-assets", featureKey: "assets", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (isCompanionPath(pluginPath, "scripts")) {
      return { featureId: "plugin-scripts", featureKey: "scripts", pluginId, sourceRelativePath: pluginPath, target };
    }
    if (isCompanionPath(pluginPath, "src")) {
      return { featureId: "plugin-src", featureKey: "src", pluginId, sourceRelativePath: pluginPath, target };
    }
  }
  return undefined;
}

function isCompanionPath(path: string, topLevelPath: string): boolean {
  return path === topLevelPath || path.startsWith(`${topLevelPath}/`);
}

function targetProjectRoot(graph: BuildGraph, target: TargetName): string {
  return readString(graph.root.targets[target].options, "projectRoot") ??
    targetDescriptor(target).projectRoot;
}

function targetLabel(target: TargetName): string {
  return targetDescriptor(target).displayLabel;
}

function pluginTargetSelected(graph: BuildGraph, pluginId: string, target: TargetName): boolean {
  const plugin = graph.plugins.find((candidate) => candidate.id === pluginId);
  return plugin !== undefined && plugin.targets[target].enabled && isOutputSelected(graph.root.outputs.targetOutputs[target].plugins, pluginId);
}

function providerListAllows(providers: readonly TargetName[] | undefined, target: TargetName): boolean {
  return providers === undefined || providers.includes(target);
}

function evidenceFor(
  featureId: string,
  target: TargetName | undefined,
  standardProfile?: StandardProfileId
): readonly SkillsetFeatureEvidence[] | undefined {
  if (standardProfile !== undefined) {
    const profile = getStandardProfile(standardProfile);
    return profile.provenance.snapshots.map((snapshot) => ({
      kind: "external-docs" as const,
      note: `${profile.title} ${profile.version} ${snapshot.kind}`,
      ref: snapshot.url,
      verifiedAt: profile.provenance.observedAt,
    }));
  }
  const feature = getSkillsetFeature(featureId);
  if (feature === undefined) return undefined;
  if (target === undefined) return feature.evidence.length === 0 ? undefined : feature.evidence;
  return feature.targetSupport[target].evidence ?? (feature.evidence.length === 0 ? undefined : feature.evidence);
}

function reasonForStatus(
  featureId: string,
  target: TargetName | undefined,
  status: SkillsetRenderResultStatus,
  standardProfile?: StandardProfileId
): string | undefined {
  if (status !== "degraded" && status !== "lossy" && status !== "unsupported" && status !== "failed") {
    return undefined;
  }
  if (standardProfile !== undefined) {
    return getStandardProfileSupportEnvelope(standardProfile, featureId)?.note ??
      `${standardProfile} does not declare ${featureId} in its support envelope`;
  }
  if (target === undefined) return undefined;
  return getSkillsetFeature(featureId)?.targetSupport[target].reason;
}

function requiredReasonForStatus(
  featureId: string,
  target: TargetName,
  status: SkillsetRenderResultStatus
): string {
  const reason = reasonForStatus(featureId, target, status);
  if (reason === undefined) {
    throw new Error(`skillset: feature registry ${featureId} ${target} ${status} support requires a reason`);
  }
  return reason;
}

function isInsideOutputRoot(path: string, outputRoot: string): boolean {
  return path === outputRoot || path.startsWith(`${outputRoot}/`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeSourcePath(graph: BuildGraph, path: string): string {
  return normalizePath(path.startsWith(graph.rootPath) ? relative(graph.rootPath, path) : path);
}

function stringField(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`skillset: expected generated lock ${key} to be a string`);
  return value;
}

function optionalStringField(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`skillset: expected generated lock ${key} to be a string`);
  return value;
}

function stringArrayField(record: JsonRecord, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`skillset: expected generated lock ${key} to be a string array`);
  }
  return [...value];
}

function optionalStringArrayField(record: JsonRecord, key: string): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`skillset: expected generated lock ${key} to be a string array`);
  }
  return [...value];
}

function jsonRecordArrayField(record: JsonRecord, key: string): readonly JsonRecord[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isJsonRecord)) {
    throw new Error(`skillset: expected generated lock ${key} to be an object array`);
  }
  return [...value];
}
