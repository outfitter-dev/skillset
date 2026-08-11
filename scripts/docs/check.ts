import type { Dirent } from "node:fs";
import {
  access,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { extname, join, posix, relative, resolve } from "node:path";

import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import { parseWorkbenchDocument } from "../../packages/workbench/src";
import {
  extractGeneratedMarkers,
  extractInlineMarkdownLinks,
  extractMarkdownHeadings,
  githubHeadingSlug,
  validateGeneratedMarkers,
} from "./markdown";
import {
  discoverMarkdownChanges,
  isMigrationDocumentationPath,
  parseMigrationMap,
  validateMigrationAccounting,
  type GitMarkdownChange,
  type MigrationMap,
} from "./migrations";
import {
  compareDocsDiagnostics,
  diagnosticIdentity,
  DOCS_BASELINE_SCHEMA_VERSION,
  formatDocsDiagnostic,
  normalizeRepoPath,
  requiresDescription,
  requiresReachability,
  type DocsBaseline,
  type DocsDiagnostic,
} from "./model";

const BASELINE_PATH = "docs/docs-check-baseline.json";
const MIGRATION_MAP_PATH = "docs/migration-map.json";
const ROOT_PAGES = ["README.md", "docs/README.md"] as const;

export interface DocsCheckResult {
  readonly current: readonly DocsDiagnostic[];
  readonly novel: readonly DocsDiagnostic[];
  readonly ok: boolean;
  readonly staleBaseline: readonly string[];
}

export async function collectDocsDiagnostics(
  root: string,
  options: { readonly migrationChanges?: readonly GitMarkdownChange[] } = {}
): Promise<readonly DocsDiagnostic[]> {
  const paths = await listDocumentationPaths(root);
  const documents = new Map<string, DocumentFacts>();
  const diagnostics: DocsDiagnostic[] = [];
  const syntaxInvalidPaths = new Set<string>();

  for (const path of paths) {
    const source = await readFile(join(root, path), "utf8");
    const parsed = parseWorkbenchDocument({ content: source, path });
    if (parsed.kind !== "markdown") continue;

    const syntaxDiagnostics = parsed.diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.ruleId.startsWith("syntax/")
    );
    for (const diagnostic of syntaxDiagnostics) {
      diagnostics.push(
        withOptionalLine(
          {
            message: diagnostic.message,
            path,
            rule: "docs/syntax",
            subject: diagnostic.ruleId,
          },
          diagnostic.location?.line
        )
      );
    }

    if (syntaxDiagnostics.length > 0) {
      syntaxInvalidPaths.add(path);
      continue;
    }

    const headings = headingsWithAnchors(parsed.headings, source);
    const h1s = headings.filter((heading) => heading.depth === 1);
    if (h1s.length !== 1) {
      diagnostics.push(
        withOptionalLine(
          {
            message: `expected exactly one H1, found ${h1s.length}`,
            path,
            rule: "docs/h1-count",
            subject: `count:${h1s.length}`,
          },
          h1s[0]?.line
        )
      );
    }

    diagnostics.push(...descriptionDiagnostics(path, parsed.frontmatter));
    for (const issue of validateGeneratedMarkers(
      extractGeneratedMarkers(source)
    )) {
      diagnostics.push({
        line: issue.line,
        message: generatedMarkerMessage(issue),
        path,
        rule: "docs/generated-marker",
        subject: `${issue.kind}:${issue.id}`,
      });
    }

    documents.set(path, {
      anchors: new Set(headings.map((heading) => heading.anchor)),
      links: extractInlineMarkdownLinks(source).map((link) => ({
        destination: link.destination,
        line: link.line,
      })),
    });
  }

  const graph = new Map<string, Set<string>>();
  for (const path of paths) graph.set(path, new Set());
  for (const [path, document] of documents) {
    for (const link of document.links) {
      diagnostics.push(
        ...(await validateLink(root, path, link, documents, graph))
      );
    }
  }
  diagnostics.push(
    ...reachabilityDiagnostics(paths, graph, syntaxInvalidPaths)
  );
  diagnostics.push(
    ...(await migrationDiagnostics(root, options.migrationChanges))
  );
  return diagnostics.sort(compareDocsDiagnostics);
}

export async function checkDocumentation(
  root: string
): Promise<DocsCheckResult> {
  const baseline = await readBaseline(root);
  const current = await collectDocsDiagnostics(root);
  return evaluateDocsBaseline(current, baseline, await readMigrationMap(root));
}

export function evaluateDocsBaseline(
  current: readonly DocsDiagnostic[],
  baseline: DocsBaseline,
  migrationMap?: MigrationMap
): DocsCheckResult {
  const currentById = new Map(
    current.map((diagnostic) => [diagnosticIdentity(diagnostic), diagnostic])
  );
  const rebasedBaseline = rebaseBaselineIdentities(
    baseline.diagnostics,
    migrationMap
  );
  const baselineIds = new Set(rebasedBaseline);
  const novel = current.filter(
    (diagnostic) => !baselineIds.has(diagnosticIdentity(diagnostic))
  );
  const staleBaseline = rebasedBaseline.filter(
    (identity) => !currentById.has(identity)
  );
  return {
    current,
    novel,
    ok: novel.length === 0 && staleBaseline.length === 0,
    staleBaseline,
  };
}

export async function writeDocsBaseline(
  root: string,
  options: {
    readonly migrationChanges?: readonly GitMarkdownChange[];
    readonly untrackedPaths?: readonly string[];
  } = {}
): Promise<void> {
  const diagnostics = await collectDocsDiagnostics(root, {
    ...(options.migrationChanges === undefined
      ? {}
      : { migrationChanges: options.migrationChanges }),
  });
  const existingBaseline = await readBaselineIfExists(root);
  if (existingBaseline !== undefined) {
    const result = evaluateDocsBaseline(
      diagnostics,
      existingBaseline,
      await readMigrationMap(root)
    );
    if (result.novel.length > 0) {
      throw new Error(
        [
          "skillset: refusing to add diagnostics to the shrink-only docs baseline",
          ...result.novel.map(
            (diagnostic) => `- ${formatDocsDiagnostic(diagnostic)}`
          ),
        ].join("\n")
      );
    }
  }
  const changes =
    options.migrationChanges ?? (await discoverMarkdownChanges(root));
  const addedPaths = new Set(
    changes
      .filter((change) => "path" in change && change.status === "A")
      .map((change) => ("path" in change ? change.path : ""))
  );
  const untrackedPaths =
    options.untrackedPaths ?? (await discoverUntrackedDocumentationPaths(root));
  for (const path of untrackedPaths) {
    addedPaths.add(path);
  }
  const addedDiagnostics = diagnostics.filter((diagnostic) =>
    addedPaths.has(diagnostic.path)
  );
  if (addedDiagnostics.length > 0) {
    throw new Error(
      [
        "skillset: refusing to baseline diagnostics on newly added documentation",
        ...addedDiagnostics.map(
          (diagnostic) => `- ${formatDocsDiagnostic(diagnostic)}`
        ),
      ].join("\n")
    );
  }
  const baseline: DocsBaseline = {
    diagnostics: [...new Set(diagnostics.map(diagnosticIdentity))].sort(),
    schemaVersion: DOCS_BASELINE_SCHEMA_VERSION,
  };
  await writeFile(
    join(root, BASELINE_PATH),
    `${JSON.stringify(baseline, null, 2)}\n`,
    "utf8"
  );
}

export function renderDocsCheckResult(result: DocsCheckResult): string {
  if (result.ok) {
    return `skillset: docs check passed (${result.current.length} baselined diagnostics)\n`;
  }
  const lines = ["skillset: docs check failed"];
  for (const diagnostic of result.novel)
    lines.push(`- new: ${formatDocsDiagnostic(diagnostic)}`);
  for (const identity of result.staleBaseline)
    lines.push(`- stale baseline: ${identity}`);
  return `${lines.join("\n")}\n`;
}

interface DocumentFacts {
  readonly anchors: ReadonlySet<string>;
  readonly links: readonly {
    readonly destination: string;
    readonly line: number;
  }[];
}

async function listDocumentationPaths(
  root: string
): Promise<readonly string[]> {
  const paths = await listMarkdown(join(root, "docs"), root);
  for (const policy of ["README.md", "CONTRIBUTING.md", "SECURITY.md"]) {
    if (await exists(join(root, policy))) paths.push(policy);
  }
  if (await exists(join(root, "examples"))) {
    const examples = await listMarkdown(join(root, "examples"), root);
    paths.push(
      ...examples.filter((path) => posix.basename(path) === "README.md")
    );
  }
  return [...new Set(paths)].sort();
}

async function listMarkdown(
  directory: string,
  root: string
): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await listMarkdown(path, root)));
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(normalizeRepoPath(path.slice(resolve(root).length + 1)));
    }
  }
  return paths;
}

function descriptionDiagnostics(
  path: string,
  frontmatter: Readonly<Record<string, unknown>> | undefined
): readonly DocsDiagnostic[] {
  if (!requiresDescription(path)) return [];
  const description = frontmatter?.description;
  if (description === undefined) {
    return [
      {
        message: "public evergreen page requires description frontmatter",
        path,
        rule: "docs/description-required",
        subject: "description",
      },
    ];
  }
  if (typeof description !== "string") {
    return [
      {
        message: "description must be a string",
        path,
        rule: "docs/description-shape",
        subject: "type",
      },
    ];
  }
  const failures: DocsDiagnostic[] = [];
  if (description.trim().length === 0)
    failures.push(
      descriptionIssue(path, "empty", "description must not be empty")
    );
  if (/\r|\n/u.test(description))
    failures.push(
      descriptionIssue(path, "multiline", "description must be one line")
    );
  if ([...description].length > 240)
    failures.push(
      descriptionIssue(
        path,
        "length",
        "description must be at most 240 Unicode code points"
      )
    );
  if (/\[[^\]]+\]\(|[*_`<>]/u.test(description))
    failures.push(
      descriptionIssue(
        path,
        "markdown",
        "description must be plain text without Markdown"
      )
    );
  return failures;
}

function headingsWithAnchors(
  headings: readonly {
    readonly depth: number;
    readonly line: number;
    readonly text: string;
  }[],
  source: string
): readonly {
  readonly anchor: string;
  readonly depth: number;
  readonly line: number;
}[] {
  const counts = new Map<string, number>();
  const renderedTextByLine = new Map(
    extractMarkdownHeadings(source).map((heading) => [
      heading.line,
      heading.text,
    ])
  );
  return headings.map((heading) => {
    const base = githubHeadingSlug(
      renderedTextByLine.get(heading.line) ?? heading.text
    );
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return {
      anchor: count === 0 ? base : `${base}-${count}`,
      depth: heading.depth,
      line: heading.line,
    };
  });
}

function descriptionIssue(
  path: string,
  subject: string,
  message: string
): DocsDiagnostic {
  return { message, path, rule: "docs/description-shape", subject };
}

async function validateLink(
  root: string,
  sourcePath: string,
  link: { readonly destination: string; readonly line: number },
  documents: ReadonlyMap<string, DocumentFacts>,
  graph: Map<string, Set<string>>
): Promise<readonly DocsDiagnostic[]> {
  const destination = link.destination.trim();
  if (
    destination.length === 0 ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(destination)
  )
    return [];
  const [rawPath = "", rawFragment] = destination.split("#", 2);
  if (rawPath.includes("?")) {
    return [
      linkDiagnostic(
        sourcePath,
        link.line,
        "docs/link-form",
        destination,
        "local links must not use query strings"
      ),
    ];
  }
  if (rawPath.startsWith("/") || rawPath.startsWith("~")) {
    return [
      linkDiagnostic(
        sourcePath,
        link.line,
        "docs/link-form",
        destination,
        "local links must be repository-relative"
      ),
    ];
  }
  let decodedPath: string;
  let fragment: string | undefined;
  try {
    decodedPath = decodeURIComponent(rawPath);
    fragment =
      rawFragment === undefined ? undefined : decodeURIComponent(rawFragment);
  } catch {
    return [
      linkDiagnostic(
        sourcePath,
        link.line,
        "docs/link-form",
        destination,
        "link contains invalid percent encoding"
      ),
    ];
  }
  const targetPath =
    decodedPath.length === 0
      ? sourcePath
      : normalizeRepoPath(
          posix.normalize(posix.join(posix.dirname(sourcePath), decodedPath))
        );
  if (targetPath === ".." || targetPath.startsWith("../")) {
    return [
      linkDiagnostic(
        sourcePath,
        link.line,
        "docs/link-target",
        destination,
        "link escapes the repository"
      ),
    ];
  }
  const likelyPage = extname(decodedPath) === "" && decodedPath.length > 0;
  const targetExists = await isFileInsideRoot(root, join(root, targetPath));
  if (!targetExists && likelyPage) {
    return [
      linkDiagnostic(
        sourcePath,
        link.line,
        "docs/link-form",
        destination,
        "local page links must include the .md extension"
      ),
    ];
  }
  if (!targetExists) {
    return [
      linkDiagnostic(
        sourcePath,
        link.line,
        "docs/link-target",
        destination,
        `target does not exist: ${targetPath}`
      ),
    ];
  }
  if (documents.has(targetPath)) graph.get(sourcePath)?.add(targetPath);
  if (fragment !== undefined && documents.has(targetPath)) {
    const anchor = fragment;
    if (anchor.length > 0 && !documents.get(targetPath)!.anchors.has(anchor)) {
      return [
        linkDiagnostic(
          sourcePath,
          link.line,
          "docs/link-anchor",
          destination,
          `anchor does not exist: #${fragment}`
        ),
      ];
    }
  }
  return [];
}

function linkDiagnostic(
  path: string,
  line: number,
  rule: DocsDiagnostic["rule"],
  subject: string,
  message: string
): DocsDiagnostic {
  return { line, message, path, rule, subject };
}

function reachabilityDiagnostics(
  paths: readonly string[],
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  excludedPaths: ReadonlySet<string>
): readonly DocsDiagnostic[] {
  const visited = new Set<string>();
  const pending: string[] = ROOT_PAGES.filter((path) => graph.has(path));
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    for (const target of graph.get(path) ?? []) pending.push(target);
  }
  return paths
    .filter(
      (path) =>
        requiresReachability(path) &&
        !excludedPaths.has(path) &&
        !visited.has(path)
    )
    .map((path) => ({
      message: "page is not reachable from README.md or docs/README.md",
      path,
      rule: "docs/reachability" as const,
      subject: "documentation-root",
    }));
}

async function migrationDiagnostics(
  root: string,
  injectedChanges: readonly GitMarkdownChange[] | undefined
): Promise<readonly DocsDiagnostic[]> {
  const source = await readFile(join(root, MIGRATION_MAP_PATH), "utf8");
  const documentationPaths = new Set(await listDocumentationPaths(root));
  const parsed = parseMigrationMap(source, {
    mapPath: MIGRATION_MAP_PATH,
    pathExists: (path) => documentationPaths.has(path),
  });
  if (parsed.map === undefined) return parsed.diagnostics;
  const changes = injectedChanges ?? (await discoverMarkdownChanges(root));
  return validateMigrationAccounting(parsed.map.entries, changes);
}

async function readMigrationMap(
  root: string
): Promise<MigrationMap | undefined> {
  const [source, documentationPaths] = await Promise.all([
    readFile(join(root, MIGRATION_MAP_PATH), "utf8"),
    listDocumentationPaths(root),
  ]);
  return parseMigrationMap(source, {
    mapPath: MIGRATION_MAP_PATH,
    pathExists: (path) => documentationPaths.includes(path),
  }).map;
}

export function rebaseBaselineIdentities(
  identities: readonly string[],
  map: MigrationMap | undefined
): readonly string[] {
  if (map === undefined) return [...identities];
  const primaryCounts = new Map<string, number>();
  for (const entry of map.entries) {
    if (
      (entry.status === "moved" || entry.status === "archived") &&
      entry.primary !== undefined
    ) {
      primaryCounts.set(
        entry.primary,
        (primaryCounts.get(entry.primary) ?? 0) + 1
      );
    }
  }
  const aliases = new Map(
    map.entries
      .filter(
        (entry) =>
          (entry.status === "moved" || entry.status === "archived") &&
          entry.primary !== undefined &&
          (entry.successors === undefined ||
            (entry.successors.length === 1 &&
              entry.successors[0] === entry.primary)) &&
          primaryCounts.get(entry.primary) === 1
      )
      .map((entry) => [entry.from, entry.primary!])
  );
  return identities.map((identity) => {
    const first = identity.indexOf("|");
    const second = identity.indexOf("|", first + 1);
    if (first === -1 || second === -1) return identity;
    const path = identity.slice(first + 1, second);
    const destination = aliases.get(path);
    return destination === undefined
      ? identity
      : `${identity.slice(0, first + 1)}${destination}${identity.slice(second)}`;
  });
}

async function readBaseline(root: string): Promise<DocsBaseline> {
  const source = await readFile(join(root, BASELINE_PATH), "utf8");
  const parsed = JSON.parse(source) as Partial<DocsBaseline>;
  if (
    parsed.schemaVersion !== DOCS_BASELINE_SCHEMA_VERSION ||
    !Array.isArray(parsed.diagnostics) ||
    !parsed.diagnostics.every((value) => typeof value === "string")
  ) {
    throw new Error(`skillset: invalid docs baseline at ${BASELINE_PATH}`);
  }
  const canonicalDiagnostics = [...new Set(parsed.diagnostics)].sort();
  if (
    canonicalDiagnostics.length !== parsed.diagnostics.length ||
    canonicalDiagnostics.some(
      (diagnostic, index) => diagnostic !== parsed.diagnostics?.[index]
    )
  ) {
    throw new Error(
      `skillset: docs baseline diagnostics must be sorted and unique at ${BASELINE_PATH}`
    );
  }
  return {
    diagnostics: canonicalDiagnostics,
    schemaVersion: DOCS_BASELINE_SCHEMA_VERSION,
  };
}

async function readBaselineIfExists(
  root: string
): Promise<DocsBaseline | undefined> {
  try {
    return await readBaseline(root);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function discoverUntrackedDocumentationPaths(
  root: string
): Promise<readonly string[]> {
  const process = Bun.spawn(
    ["git", "ls-files", "--others", "--exclude-standard", "-z", "--", "*.md"],
    {
      cwd: root,
      env: gitSafeEnv(),
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ls-files failed: ${stderr.trim()}`);
  }
  return stdout
    .split("\0")
    .filter((path) => path.length > 0 && isMigrationDocumentationPath(path))
    .sort();
}

function generatedMarkerMessage(issue: {
  readonly expectedId?: string;
  readonly id: string;
  readonly kind: string;
}): string {
  return issue.expectedId === undefined
    ? `invalid generated marker ${issue.kind}: ${issue.id}`
    : `generated marker ${issue.kind}: expected ${issue.expectedId}, found ${issue.id}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isFileInsideRoot(root: string, path: string): Promise<boolean> {
  try {
    const [canonicalRoot, canonicalPath, entry] = await Promise.all([
      realpath(root),
      realpath(path),
      stat(path),
    ]);
    const fromRoot = relative(canonicalRoot, canonicalPath);
    return (
      entry.isFile() &&
      fromRoot.length > 0 &&
      !fromRoot.startsWith("..") &&
      !posix.isAbsolute(fromRoot)
    );
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function withOptionalLine(
  diagnostic: Omit<DocsDiagnostic, "line">,
  line: number | undefined
): DocsDiagnostic {
  return line === undefined ? diagnostic : { ...diagnostic, line };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
