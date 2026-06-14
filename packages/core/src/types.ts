export type TargetName = "claude" | "codex";

export type JsonScalar = boolean | null | number | string;
export type JsonValue = JsonScalar | JsonValue[] | JsonRecord;

export interface JsonRecord {
  readonly [key: string]: JsonValue | undefined;
}

export interface MarkdownParts {
  readonly body: string;
  readonly frontmatter: JsonRecord;
}

export interface ResolvedTarget {
  readonly enabled: boolean;
  readonly options: JsonRecord;
}

export interface RootConfig {
  readonly compile: CompileConfig;
  readonly distributions: Readonly<Record<string, DistributionConfig>>;
  readonly metadata: JsonRecord;
  readonly outputs: OutputConfig;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface ReleaseScopeState {
  readonly removed?: boolean;
  readonly sourceHash?: string;
  readonly updatedAt?: string;
  readonly version: string;
}

export interface ReleaseState {
  readonly scopes: Readonly<Record<string, ReleaseScopeState>>;
}

export type CompileUnsupportedPolicy = "error" | "warn" | "skip" | "force";
export type CompileBuildMode = "updated" | "all";
export type BuildScope = "repo" | "plugins" | "project" | "user";

export interface CompileSkillsetConfig {
  readonly metadata: boolean;
}

export interface CompileConfig {
  readonly build: CompileBuildMode;
  readonly skillset: CompileSkillsetConfig;
  readonly targets: readonly TargetName[];
  readonly unsupported: CompileUnsupportedPolicy;
}

export type DistributionDestinationKind = "git" | "local";

export interface DistributionFromConfig {
  readonly runtime?: string;
  readonly selector: string;
  readonly target: TargetName;
}

export interface DistributionToConfig {
  readonly branch?: string;
  readonly kind: DistributionDestinationKind;
  readonly path?: string;
  readonly repo?: string;
  readonly subdirectory?: string;
}

export interface DistributionConfig {
  readonly dryRun: boolean;
  readonly from: DistributionFromConfig;
  readonly to: DistributionToConfig;
}

export interface PluginConfig {
  readonly metadata: JsonRecord;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

/**
 * Source dialect a skill or instruction body is authored in. Source-only:
 * declared in frontmatter, stripped from generated output. Absent means
 * portable (no build-time translation).
 */
export type SourceDialect = "claude";

export interface SourceSkill {
  readonly body: string;
  readonly dialect?: SourceDialect;
  readonly frontmatter: JsonRecord;
  readonly id: string;
  readonly metadata: JsonRecord;
  readonly relativePath: string;
  readonly resources: readonly SourceResource[];
  readonly sourceOrigin?: SourceOrigin;
  readonly sourcePath: string;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface SourceResource {
  readonly from: string;
  readonly kind: "directory" | "file";
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface SourcePluginDependency {
  readonly kind: "external" | "internal";
  readonly marketplace?: string;
  readonly name: string;
  readonly range?: string;
  readonly sourceLabel: string;
  readonly unversioned: boolean;
}

export interface SourcePlugin {
  readonly configPath: string;
  readonly dependencies: readonly SourcePluginDependency[];
  readonly features: readonly SourcePluginFeature[];
  readonly id: string;
  readonly metadata: JsonRecord;
  readonly path: string;
  readonly skills: readonly SourceSkill[];
  readonly sourceOrigin?: SourceOrigin;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export type SourcePluginFeatureKey = "bin" | "mcp";
export type SourcePluginFeatureOrigin = "conventional" | "explicit";

export interface SourcePluginFeature {
  readonly key: SourcePluginFeatureKey;
  readonly origin: SourcePluginFeatureOrigin;
  readonly sourcePath: string;
  readonly sourcePointer?: string;
  readonly targetPath: string;
}

export interface StandaloneSkill extends SourceSkill {}

export interface SourceRule {
  readonly body: string;
  readonly dialect?: SourceDialect;
  readonly frontmatter: JsonRecord;
  readonly id: string;
  readonly relativePath: string;
  readonly sourceOrigin?: SourceOrigin;
  readonly sourcePath: string;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface SourceIslandFile {
  readonly plugin?: string;
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly target: TargetName;
}

export interface SourceProjectAgent {
  readonly body: string;
  readonly filename: string;
  readonly frontmatter: JsonRecord;
  readonly name: string;
  readonly outputName: string;
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface OutputConfig {
  readonly plugins: Readonly<Record<TargetName, string>>;
  readonly skills: Readonly<Record<TargetName, string>>;
  readonly targetOutputs: Readonly<Record<TargetName, TargetOutputConfig>>;
}

export type OutputSelection = boolean | readonly string[];

export interface TargetOutputConfig {
  readonly plugins: OutputSelection;
  readonly skills: OutputSelection;
}

export interface BuildGraph {
  /** The source subdirectory instructions were loaded from. */
  readonly instructionsDir: string;
  readonly outputRoots: readonly string[];
  readonly plugins: readonly SourcePlugin[];
  readonly projectAgents: readonly SourceProjectAgent[];
  readonly projectIslands: readonly SourceIslandFile[];
  readonly rules: readonly SourceRule[];
  readonly releaseState: ReleaseState;
  readonly root: RootConfig;
  readonly rootPath: string;
  readonly standaloneSkills: readonly StandaloneSkill[];
  readonly sourceDir: string;
  readonly sourcePath: string;
  /** Non-fatal source warnings surfaced by the CLI. */
  readonly warnings: readonly string[];
}

export interface RenderedFile {
  readonly content: Uint8Array;
  readonly path: string;
  readonly sourcePath?: string;
}

/**
 * One applied build-time dialect transform on a generated file: the intent
 * key from the transform registry and how many spans it lowered.
 */
export interface AppliedTransform {
  readonly count: number;
  readonly intent: string;
}

export interface SourceOrigin {
  readonly path: string;
  readonly ref?: string;
  readonly repo?: string;
}

export interface GeneratedEntry {
  readonly dependencies?: readonly string[];
  readonly feature?: string;
  readonly origin?: string;
  readonly kind?: string;
  readonly outputHash?: string;
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly preprocessDependencies?: readonly string[];
  readonly sourceHash?: string;
  readonly sourceOrigin?: SourceOrigin;
  readonly sourcePath: string;
  readonly sourcePointer?: string;
  readonly target: string;
  readonly targetState?: string;
  readonly transforms?: readonly AppliedTransform[];
  readonly validation?: string;
  readonly version?: string;
}

export interface SkillsetOptions {
  readonly buildMode?: CompileBuildMode;
  readonly scopes?: readonly BuildScope[];
  readonly distDir?: string;
  /** Re-root every generated path under `.skillset/build/out`, leaving live outputs untouched. */
  readonly isolated?: boolean;
  readonly sourceDir?: string;
  readonly targetFilter?: readonly TargetName[];
}

export interface CheckResult {
  readonly checkedFiles: number;
}

export interface LintIssue {
  readonly code: string;
  readonly featureId?: string;
  readonly message: string;
  readonly path: string;
  /** Errors fail lint/ci; warnings flow through reporting without failing. */
  readonly severity: "error" | "warn";
}

export interface LintResult {
  readonly checkedSkills: number;
  readonly issues: readonly LintIssue[];
}
