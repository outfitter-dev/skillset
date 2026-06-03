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
  readonly metadata: JsonRecord;
  readonly outputs: OutputConfig;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface PluginConfig {
  readonly metadata: JsonRecord;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface SourceSkill {
  readonly body: string;
  readonly frontmatter: JsonRecord;
  readonly id: string;
  readonly metadata: JsonRecord;
  readonly relativePath: string;
  readonly resources: readonly SourceResource[];
  readonly sourcePath: string;
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface SourceResource {
  readonly from: string;
  readonly kind: "directory" | "file";
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface SourcePlugin {
  readonly id: string;
  readonly metadata: JsonRecord;
  readonly path: string;
  readonly skills: readonly SourceSkill[];
  readonly targets: Readonly<Record<TargetName, ResolvedTarget>>;
}

export interface StandaloneSkill extends SourceSkill {}

export interface SourceRule {
  readonly body: string;
  readonly frontmatter: JsonRecord;
  readonly id: string;
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
  readonly outputRoots: readonly string[];
  readonly plugins: readonly SourcePlugin[];
  readonly rules: readonly SourceRule[];
  readonly root: RootConfig;
  readonly rootPath: string;
  readonly standaloneSkills: readonly StandaloneSkill[];
  readonly sourceDir: string;
  readonly sourcePath: string;
}

export interface RenderedFile {
  readonly content: Uint8Array;
  readonly path: string;
}

export interface SkillsetOptions {
  readonly distDir?: string;
  readonly sourceDir?: string;
}

export interface CheckResult {
  readonly checkedFiles: number;
}

export interface LintIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface LintResult {
  readonly checkedSkills: number;
  readonly issues: readonly LintIssue[];
}
