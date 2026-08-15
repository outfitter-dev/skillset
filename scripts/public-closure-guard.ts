import { readdir, readFile } from "node:fs/promises";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PublicClosureRule =
  | "contributor-skill"
  | "development-docs"
  | "fixture-path"
  | "internal-package"
  | "internal-script";

export interface PublicClosureViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: PublicClosureRule;
  readonly text: string;
}

export interface PublicClosureScanResult {
  readonly scannedFiles: number;
  readonly skippedBinaryFiles: number;
  readonly violations: readonly PublicClosureViolation[];
}

interface ClosurePattern {
  readonly pattern: RegExp;
  readonly rule: PublicClosureRule;
}

interface ProtectedPathOwner {
  readonly path: string;
  readonly rule: PublicClosureRule;
}

type PackageScripts = Readonly<Record<string, string>>;
type PackageRunner = "bun" | "npm" | "pnpm" | "yarn";
type ProtectedBoundaryContext = "generated" | "package-script";

interface ShellLogicalLine {
  readonly line: number;
  readonly shellCommand: boolean;
  readonly text: string;
}

interface MarkdownFence {
  readonly character: "`" | "~";
  readonly length: number;
  readonly shell: boolean;
}

interface MarkdownFenceDelimiter {
  readonly character: "`" | "~";
  readonly info: string;
  readonly length: number;
}

const PUBLIC_ROOT = "plugins/skillset/";
const CLOSURE_PATTERNS: readonly ClosurePattern[] = [
  {
    pattern:
      /(?:^|[^a-z0-9-])skillset-dev(?:-[a-z0-9][a-z0-9-]*)?(?=$|[^a-z0-9-])/iu,
    rule: "contributor-skill",
  },
  {
    pattern:
      /@skillset\/[a-z0-9._-]+\/(?:internal|src)(?![a-z0-9_-]|\.[a-z0-9_-])/iu,
    rule: "internal-package",
  },
] as const;
const PROTECTED_PATH_OWNERS: readonly ProtectedPathOwner[] = [
  { path: "docs/development", rule: "development-docs" },
  { path: "fixtures", rule: "fixture-path" },
  { path: "packages", rule: "internal-package" },
  { path: "apps/skillset/src", rule: "internal-package" },
  { path: "scripts", rule: "internal-script" },
];
const PUBLIC_CLOSURE_RULE_ORDER: readonly PublicClosureRule[] = [
  "contributor-skill",
  "development-docs",
  "fixture-path",
  "internal-package",
  "internal-script",
];
const PROTECTED_PATH_ACTIONS =
  "browse|cd|edit|enter|inspect|list|open|read|visit";
const PUBLIC_REPOSITORY_OWNER = "outfitter-dev";
const PUBLIC_REPOSITORY_NAME = "skillset";
const PROTECTED_ROOT_PATH_COMMANDS: ReadonlySet<string> = new Set([
  "bash",
  "bun",
  "cat",
  "cd",
  "chmod",
  "chown",
  "cp",
  "deno",
  "du",
  "find",
  "ls",
  "mv",
  "node",
  "realpath",
  "rm",
  "rsync",
  "sh",
  "stat",
  "tar",
  "tree",
  "tsx",
  "zsh",
]);
const SHELL_WRAPPER_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> =
  {
    env: new Set(["--chdir", "--split-string", "--unset", "-C", "-S", "-u"]),
    exec: new Set(["-a"]),
    nice: new Set(["--adjustment", "-n"]),
    sudo: new Set([
      "--chdir",
      "--chroot",
      "--close-from",
      "--command-timeout",
      "--group",
      "--host",
      "--other-user",
      "--prompt",
      "--role",
      "--type",
      "--user",
      "-C",
      "-D",
      "-g",
      "-h",
      "-p",
      "-r",
      "-R",
      "-t",
      "-T",
      "-u",
      "-U",
    ]),
    time: new Set(["--format", "--output", "-f", "-o"]),
  };
const GIT_GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--config-env",
  "--git-dir",
  "--namespace",
  "--work-tree",
  "-c",
]);
const GIT_GLOBAL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--bare",
  "--glob-pathspecs",
  "--icase-pathspecs",
  "--literal-pathspecs",
  "--no-advice",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-pager",
  "--no-replace-objects",
  "--noglob-pathspecs",
  "--paginate",
  "-P",
  "-p",
]);

const PACKAGE_RUNNER_PATTERN =
  /(?<![a-z0-9_-])(?<runner>bun|npm|pnpm|yarn)(?![a-z0-9_-])/giu;
const PATH_CANDIDATE_PATTERN =
  /(?<![a-z0-9_.:\\/-])(?:[a-z]:)?[\\/]?(?:[a-z0-9._-]+[\\/])+[a-z0-9._-]+/giu;
// Value-taking forms from `bun run --help`. Keeping this finite prevents an
// unknown flag from swallowing the package-script token.
const BUN_RUN_REQUIRED_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--conditions",
  "--console-depth",
  "--cpu-prof-dir",
  "--cpu-prof-interval",
  "--cpu-prof-name",
  "--cron-period",
  "--cron-title",
  "--cwd",
  "--define",
  "--dns-result-order",
  "--drop",
  "--elide-lines",
  "--env-file",
  "--eval",
  "--extension-order",
  "--feature",
  "--fetch-preconnect",
  "--filter",
  "--heap-prof-dir",
  "--heap-prof-name",
  "--import",
  "--install",
  "--jsx-factory",
  "--jsx-fragment",
  "--jsx-import-source",
  "--jsx-runtime",
  "--loader",
  "--main-fields",
  "--max-http-header-size",
  "--port",
  "--preload",
  "--print",
  "--require",
  "--shell",
  "--title",
  "--tsconfig-override",
  "--unhandled-rejections",
  "--user-agent",
  "-d",
  "-e",
  "-F",
  "-l",
  "-p",
  "-r",
]);
const YARN_RUN_REQUIRED_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--require",
]);
const RUNNER_VALUE_FLAGS: Readonly<Record<PackageRunner, ReadonlySet<string>>> =
  {
    bun: BUN_RUN_REQUIRED_VALUE_FLAGS,
    npm: new Set([
      "--cache",
      "--fetch-retries",
      "--location",
      "--loglevel",
      "--prefix",
      "--registry",
      "--script-shell",
      "--userconfig",
      "--workspace",
      "-L",
      "-w",
    ]),
    pnpm: new Set([
      "--changed-files-ignore-pattern",
      "--dir",
      "--filter",
      "--filter-prod",
      "--loglevel",
      "--network-concurrency",
      "--reporter",
      "--resume-from",
      "--script-shell",
      "--store-dir",
      "--test-pattern",
      "--workspace-concurrency",
      "-C",
      "-F",
    ]),
    yarn: new Set(["--cwd"]),
  };
const RUNNER_BUILTINS: Readonly<Record<PackageRunner, ReadonlySet<string>>> = {
  bun: new Set([
    "add",
    "build",
    "create",
    "install",
    "link",
    "pm",
    "remove",
    "test",
    "unlink",
    "update",
    "upgrade",
    "x",
  ]),
  npm: new Set(),
  pnpm: new Set([
    "add",
    "audit",
    "config",
    "create",
    "dlx",
    "exec",
    "fetch",
    "import",
    "init",
    "install",
    "link",
    "publish",
    "remove",
    "store",
    "unlink",
    "update",
  ]),
  yarn: new Set([
    "add",
    "cache",
    "config",
    "create",
    "dlx",
    "exec",
    "init",
    "install",
    "link",
    "plugin",
    "remove",
    "set",
    "unlink",
    "up",
  ]),
};
const NPM_RUN_COMMANDS: ReadonlySet<string> = new Set([
  "run",
  "run-script",
  "rum",
  "urn",
]);
const NPM_PRE_COMMAND_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--audit",
  "--dry-run",
  "--force",
  "--foreground-scripts",
  "--fund",
  "--if-present",
  "--ignore-scripts",
  "--include-workspace-root",
  "--json",
  "--silent",
  "--workspaces",
  "-s",
]);
const PNPM_RUN_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--aggregate-output",
  "--color",
  "--fail-if-no-match",
  "--if-present",
  "--parallel",
  "--recursive",
  "--report-summary",
  "--reporter-hide-prefix",
  "--sequential",
  "--silent",
  "--stream",
  "--use-stderr",
  "--workspace-root",
  "--yes",
  "-r",
  "-s",
  "-w",
  "-y",
]);
const PNPM_RUN_COMMANDS: ReadonlySet<string> = new Set(["run", "run-script"]);
const NPM_LIFECYCLE_SCRIPTS: Readonly<Record<string, string>> = {
  restart: "restart",
  start: "start",
  stop: "stop",
  t: "test",
  test: "test",
  tst: "test",
};

interface CommandToken {
  readonly end: number;
  readonly value: string;
}

export function isGeneratedPublicPath(path: string): boolean {
  return path.startsWith(PUBLIC_ROOT) && path.length > PUBLIC_ROOT.length;
}

export function scanGeneratedPublicContent(
  file: string,
  content: string,
  repoInternalScripts: readonly string[] = [],
  repoInternalScriptAliases: ReadonlySet<string> = new Set(),
  packageScriptNames?: ReadonlySet<string>,
  repoRoot?: string
): readonly PublicClosureViolation[] {
  if (!isGeneratedPublicPath(file)) return [];
  const violations: PublicClosureViolation[] = [];
  for (const { line, shellCommand, text } of shellLogicalLines(content, true)) {
    for (const rule of matchingProtectedBoundaryRules(
      text,
      repoRoot,
      "generated",
      shellCommand
    )) {
      violations.push({ file, line, rule, text: text.trim() });
    }
    if (
      !violations.some(
        (violation) =>
          violation.line === line && violation.rule === "internal-script"
      ) &&
      repoInternalScripts.some((path) =>
        hasRepoInternalScriptReference(text, path, repoRoot)
      )
    ) {
      violations.push({
        file,
        line,
        rule: "internal-script",
        text: text.trim(),
      });
    } else if (
      !violations.some(
        (violation) =>
          violation.line === line && violation.rule === "internal-script"
      ) &&
      invokedPackageScripts(text, packageScriptNames).some((name) =>
        repoInternalScriptAliases.has(name)
      )
    ) {
      violations.push({
        file,
        line,
        rule: "internal-script",
        text: text.trim(),
      });
    }
  }
  return violations;
}

function matchingProtectedBoundaryRules(
  text: string,
  repoRoot: string | undefined,
  context: ProtectedBoundaryContext,
  shellCommand = false
): readonly PublicClosureRule[] {
  const normalizedTextWithUrls = normalizeLiteralShellPathQuotes(
    text.replaceAll("\\", "/")
  );
  const normalizedText = withoutHttpUrls(normalizedTextWithUrls);
  const repositoryPaths = repositoryHttpPaths(normalizedTextWithUrls);
  const rules = new Set<PublicClosureRule>(
    CLOSURE_PATTERNS.filter(({ pattern }) => pattern.test(normalizedText)).map(
      ({ rule }) => rule
    )
  );
  for (const owner of PROTECTED_PATH_OWNERS) {
    if (
      hasProtectedPathOwnerReference(
        normalizedText,
        owner.path,
        repoRoot,
        context,
        repositoryPaths,
        shellCommand,
        text
      )
    ) {
      rules.add(owner.rule);
    }
  }
  return PUBLIC_CLOSURE_RULE_ORDER.filter((rule) => rules.has(rule));
}

function hasProtectedPathOwnerReference(
  normalizedText: string,
  ownerPath: string,
  repoRoot: string | undefined,
  context: ProtectedBoundaryContext,
  repositoryPaths: readonly string[],
  shellCommand: boolean,
  shellText: string
): boolean {
  const normalizedOwner = ownerPath.toLowerCase();
  const owns = (candidate: string): boolean =>
    candidate === normalizedOwner ||
    candidate.startsWith(`${normalizedOwner}/`);
  const normalizedRoot = repoRoot
    ?.replaceAll("\\", "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
  const absoluteOwnerPath = normalizedRoot
    ? posix.normalize(`${normalizedRoot}/${normalizedOwner}`)
    : undefined;

  const pathCandidateText = collapseRepeatedPathSeparators(normalizedText);
  for (const match of pathCandidateText.matchAll(PATH_CANDIDATE_PATTERN)) {
    if (match[0].endsWith("/.")) continue;
    const candidate = posix
      .normalize(match[0].replace(/[!,.?:;]+$/u, ""))
      .toLowerCase();
    const repositoryRelative = candidate.replace(/^(?:\.\.\/)+/u, "");
    const isParentRelative = candidate !== repositoryRelative;
    const isRepoAbsolute =
      absoluteOwnerPath !== undefined &&
      (candidate === absoluteOwnerPath ||
        candidate.startsWith(`${absoluteOwnerPath}/`));
    const directOwnerIsInternal =
      ownerPath !== "scripts" || context === "package-script";
    if (
      isRepoAbsolute ||
      (owns(repositoryRelative) && (directOwnerIsInternal || isParentRelative))
    ) {
      return true;
    }
  }

  if (
    absoluteOwnerPath !== undefined &&
    fileUrlPaths(normalizedText).some(
      (candidate) =>
        candidate === absoluteOwnerPath ||
        candidate.startsWith(`${absoluteOwnerPath}/`)
    )
  ) {
    return true;
  }

  if (repositoryPaths.some(owns)) return true;

  if (
    (context === "package-script" &&
      hasProtectedRootCommandArgument(shellText, normalizedOwner)) ||
    (context === "generated" &&
      (hasGeneratedShellOwnerToken(shellText, normalizedOwner) ||
        (shellCommand &&
          hasProtectedRootCommandArgument(shellText, normalizedOwner))))
  ) {
    return true;
  }

  const escapedOwner = ownerPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const actionPattern = new RegExp(
    `\\b(?:${PROTECTED_PATH_ACTIONS})\\s+(?:[\\x60<{[(])?(?:\\./)?${escapedOwner}\\/?(?=$|[\\x60>\\]})]|\\.{2,}|[.,?:!](?=$|\\s)|\\s*(?:&&|\\|\\||\\d*[<>]|[;&|#])|\\s+(?:directory|folder)\\b)`,
    "iu"
  );
  const repoPattern = new RegExp(
    `\\brepo:${escapedOwner}(?=$|/|[^a-z0-9_.-])`,
    "iu"
  );
  const wrappedPattern = new RegExp(
    `(?:\\x60${escapedOwner}\\/?\\x60|<${escapedOwner}\\/?>|\\[${escapedOwner}\\/?\\]|\\{${escapedOwner}\\/?\\})`,
    "iu"
  );
  return (
    actionPattern.test(normalizedText) ||
    repoPattern.test(normalizedText) ||
    (ownerPath !== "scripts" && wrappedPattern.test(normalizedText))
  );
}

function normalizeLiteralShellPathQuotes(text: string): string {
  let normalized = text;
  while (true) {
    const next = normalized.replace(/(["'])([a-z0-9._@:+\/-]*)\1/giu, "$2");
    if (next === normalized) return normalized;
    normalized = next;
  }
}

function collapseRepeatedPathSeparators(text: string): string {
  return text.replace(/\/{2,}/gu, "/");
}

function withoutHttpUrls(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s`"'<>]+/giu, " ");
}

function fileUrlPaths(text: string): readonly string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(/\bfile:\/\/\/[^\s`"'<>]+/giu)) {
    const value = match[0].replace(/[!,.?:;]+$/u, "");
    try {
      let path = decodeURIComponent(new URL(value).pathname).replaceAll(
        "\\",
        "/"
      );
      if (/^\/[a-z]:\//iu.test(path)) path = path.slice(1);
      paths.push(posix.normalize(path).toLowerCase());
    } catch {
      // Malformed file URLs are not treated as repository paths.
    }
  }
  return paths;
}

function repositoryHttpPaths(text: string): readonly string[] {
  const paths: string[] = [];
  const appendSuffixes = (
    segments: readonly string[],
    firstPathIndex: number
  ): void => {
    for (let index = firstPathIndex; index < segments.length; index += 1) {
      paths.push(
        posix.normalize(segments.slice(index).join("/")).toLowerCase()
      );
    }
  };
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s`"'<>]+/giu)) {
    const value = trimUrlClosingDelimiters(match[0].replace(/[!,.?:;]+$/u, ""));
    try {
      const url = new URL(value);
      const segments = decodeURIComponent(url.pathname)
        .split("/")
        .filter(Boolean);
      const host = url.hostname.toLowerCase();
      const isRepository =
        segments[0]?.toLowerCase() === PUBLIC_REPOSITORY_OWNER &&
        segments[1]?.toLowerCase() === PUBLIC_REPOSITORY_NAME;
      if (!isRepository) continue;

      if (
        host === "github.com" &&
        ["blob", "raw", "tree"].includes(segments[2]?.toLowerCase() ?? "") &&
        segments.length > 4
      ) {
        appendSuffixes(segments, 4);
      } else if (host === "raw.githubusercontent.com" && segments.length > 3) {
        appendSuffixes(segments, 3);
      }
    } catch {
      // Malformed or undecodable URLs are not treated as repository paths.
    }
  }
  return paths;
}

function trimUrlClosingDelimiters(value: string): string {
  let trimmed = value;
  for (const [opening, closing] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    while (
      trimmed.endsWith(closing) &&
      [...trimmed].filter((character) => character === closing).length >
        [...trimmed].filter((character) => character === opening).length
    ) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
}

function normalizeShellToken(token: string): string {
  return token.replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function hasProtectedRootCommandArgument(
  command: string,
  normalizedOwner: string
): boolean {
  return readShellCommandSegments(command).some((segment) => {
    const tokens = unwrapShellCommand(segment);
    const normalizedTokens = tokens.map((token) =>
      normalizeShellToken(token).toLowerCase()
    );
    return (
      (PROTECTED_ROOT_PATH_COMMANDS.has(normalizedTokens[0] ?? "") &&
        normalizedTokens.slice(1).includes(normalizedOwner)) ||
      hasGitProtectedDirectoryArgument(tokens, normalizedOwner)
    );
  });
}

function hasGitProtectedDirectoryArgument(
  tokens: readonly string[],
  normalizedOwner: string
): boolean {
  if (tokens[0]?.toLowerCase() !== "git") return false;
  let directory = ".";
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "-C") {
      const operand = tokens[index + 1];
      if (operand === undefined || operand.startsWith("-")) return false;
      const normalizedDirectory = operand.replaceAll("\\", "/");
      directory = posix.isAbsolute(normalizedDirectory)
        ? posix.normalize(normalizedDirectory)
        : posix.normalize(posix.join(directory, normalizedDirectory));
      index += 1;
      continue;
    }
    if (token === "--" || !token.startsWith("-")) break;
    if (GIT_GLOBAL_VALUE_FLAGS.has(token)) {
      if (!tokens[index + 1]) return false;
      index += 1;
      continue;
    }
    if (
      GIT_GLOBAL_BOOLEAN_FLAGS.has(token) ||
      token.startsWith("--exec-path=") ||
      [...GIT_GLOBAL_VALUE_FLAGS].some(
        (flag) => flag.startsWith("--") && token.startsWith(`${flag}=`)
      )
    ) {
      continue;
    }
    return false;
  }
  const normalizedDirectory = directory.toLowerCase();
  return (
    normalizedDirectory === normalizedOwner ||
    normalizedDirectory.startsWith(`${normalizedOwner}/`)
  );
}

function unwrapShellCommand(tokens: readonly string[]): readonly string[] {
  let index = 0;
  if (["$", "%", ">"].includes(tokens[index] ?? "")) index += 1;
  const skipAssignments = (): void => {
    while (/^[a-z_][a-z0-9_]*=/iu.test(tokens[index] ?? "")) index += 1;
  };
  skipAssignments();

  while (index < tokens.length) {
    const wrapper = (tokens[index] ?? "").toLowerCase();
    if (
      !["command", "env", "exec", "nice", "nohup", "sudo", "time"].includes(
        wrapper
      )
    ) {
      break;
    }
    index += 1;

    while (index < tokens.length) {
      const token = tokens[index] ?? "";
      if (token === "--") {
        index += 1;
        break;
      }
      if (wrapper === "command" && (token === "-v" || token === "-V")) {
        return [];
      }
      if (wrapper === "env" && /^[a-z_][a-z0-9_]*=/iu.test(token)) {
        index += 1;
        continue;
      }
      if (!token.startsWith("-")) break;
      const valueFlags = SHELL_WRAPPER_VALUE_FLAGS[wrapper];
      index += valueFlags?.has(token) === true && !token.includes("=") ? 2 : 1;
    }
    skipAssignments();
  }

  return tokens.slice(index);
}

function hasGeneratedShellOwnerToken(
  text: string,
  normalizedOwner: string
): boolean {
  return [...text.matchAll(/`([^`\r\n]+)`/gu)].some((match) => {
    const command = match[1] ?? "";
    return (
      /\s/u.test(command) &&
      hasProtectedRootCommandArgument(command, normalizedOwner)
    );
  });
}

function shellLogicalLines(
  content: string,
  recognizeMarkdownFences = false
): readonly ShellLogicalLine[] {
  const lines = content.split(/\r?\n/u);
  const logicalLines: ShellLogicalLine[] = [];
  let fence: MarkdownFence | undefined;
  let line = 1;
  let shellCommand = false;
  let text = "";

  for (const [index, physicalLine] of lines.entries()) {
    if (text.length === 0) {
      line = index + 1;
      if (recognizeMarkdownFences) {
        const delimiter = markdownFenceDelimiter(physicalLine);
        if (delimiter && fence) {
          if (
            delimiter.character === fence.character &&
            delimiter.length >= fence.length &&
            delimiter.info.length === 0
          ) {
            fence = undefined;
            logicalLines.push({
              line,
              shellCommand: false,
              text: physicalLine,
            });
            continue;
          }
        } else if (delimiter) {
          fence = {
            character: delimiter.character,
            length: delimiter.length,
            shell:
              /^(?:(?:bash|sh|shell|zsh)(?:\s|$)|\{\.(?:bash|sh|shell|zsh)(?:\s|\}))/iu.test(
                delimiter.info
              ),
          };
          logicalLines.push({
            line,
            shellCommand: false,
            text: physicalLine,
          });
          continue;
        }
      }
      shellCommand = fence?.shell === true;
    }
    if (physicalLine.endsWith("\\")) {
      text += physicalLine.slice(0, -1);
    } else {
      logicalLines.push({ line, shellCommand, text: text + physicalLine });
      text = "";
    }
  }
  if (text.length > 0) logicalLines.push({ line, shellCommand, text });
  return logicalLines;
}

function markdownFenceDelimiter(
  line: string
): MarkdownFenceDelimiter | undefined {
  const match = /^(?: {0,3})(?<marker>`{3,}|~{3,})(?<info>.*)$/u.exec(line);
  const marker = match?.groups?.marker;
  if (!marker) return undefined;
  return {
    character: marker[0] as "`" | "~",
    info: (match?.groups?.info ?? "").trim(),
    length: marker.length,
  };
}

function readCommandToken(text: string, offset: number): CommandToken | null {
  let start = offset;
  while (/\s/u.test(text[start] ?? "")) start += 1;
  while (text[start] === "`") start += 1;
  let end = start;
  let value = "";
  let consumed = false;
  while (end < text.length) {
    const character = text[end] ?? "";
    if (/[\s`();,<>|&]/u.test(character)) break;
    if (character === '"' || character === "'") {
      const quote = character;
      consumed = true;
      end += 1;
      let closed = false;
      while (end < text.length) {
        const quotedCharacter = text[end] ?? "";
        if (quotedCharacter === quote) {
          closed = true;
          end += 1;
          break;
        }
        if (
          quote === '"' &&
          quotedCharacter === "\\" &&
          end + 1 < text.length &&
          /[$`"\\\n]/u.test(text[end + 1] ?? "")
        ) {
          end += 1;
          value += text[end];
        } else {
          value += quotedCharacter;
        }
        end += 1;
      }
      if (!closed) return null;
      continue;
    }
    if (character === "\\" && end + 1 < text.length) {
      end += 1;
      value += text[end];
    } else {
      value += character;
    }
    consumed = true;
    end += 1;
  }
  return consumed ? { end, value } : null;
}

function readShellCommandSegments(
  text: string
): readonly (readonly string[])[] {
  const segments: string[][] = [[]];
  let offset = 0;
  while (offset < text.length) {
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
    if (
      (segments.at(-1)?.length ?? 0) === 0 &&
      text[offset] === ">" &&
      /\s/u.test(text[offset + 1] ?? "")
    ) {
      segments.at(-1)?.push(">");
      offset += 1;
      continue;
    }
    const boundary = /^(?:&&|\|\||[;&|])/u.exec(text.slice(offset));
    if (boundary) {
      if ((segments.at(-1)?.length ?? 0) > 0) segments.push([]);
      offset += boundary[0].length;
      continue;
    }
    const redirection = /^(?:\d+)?(?:<>|>&|<&|>>|<<|>|<)/u.exec(
      text.slice(offset)
    );
    if (redirection) {
      offset += redirection[0].length;
      const target = readCommandToken(text, offset);
      offset = target?.end ?? offset;
      continue;
    }
    const token = readCommandToken(text, offset);
    if (token) {
      segments.at(-1)?.push(token.value);
      offset = token.end;
    } else {
      offset += 1;
    }
  }
  return segments.filter((segment) => segment.length > 0);
}

function readRunnerTokens(
  text: string,
  offset: number,
  runner: PackageRunner,
  options: {
    readonly consumeYarnRequireBeforeRun?: boolean;
    readonly requiredValueFlags?: ReadonlySet<string>;
    readonly skipArgumentDelimiter?: boolean;
  } = {}
): readonly CommandToken[] {
  const visit = (
    token: CommandToken | null,
    maySkipArgumentDelimiter: boolean,
    requiresExplicitRun = false
  ): readonly CommandToken[] => {
    if (!token) return [];
    if (token.value === "--") {
      const script = readCommandToken(text, token.end);
      return maySkipArgumentDelimiter && script ? [script] : [];
    }
    if (!token.value.startsWith("-")) {
      return requiresExplicitRun && token.value.toLowerCase() !== "run"
        ? []
        : [token];
    }

    const next = readCommandToken(text, token.end);
    if (
      runner === "yarn" &&
      options.consumeYarnRequireBeforeRun === true &&
      (token.value === "--require" || token.value.startsWith("--require="))
    ) {
      const command =
        token.value === "--require"
          ? next
            ? readCommandToken(text, next.end)
            : null
          : next;
      return visit(command, maySkipArgumentDelimiter, true);
    }
    if (
      RUNNER_VALUE_FLAGS[runner].has(token.value) ||
      options.requiredValueFlags?.has(token.value) === true
    ) {
      return next
        ? visit(
            readCommandToken(text, next.end),
            maySkipArgumentDelimiter,
            requiresExplicitRun
          )
        : [];
    }
    return visit(next, maySkipArgumentDelimiter, requiresExplicitRun);
  };

  return visit(
    readCommandToken(text, offset),
    options.skipArgumentDelimiter === true
  );
}

function readConfiguredRunnerTokens(
  text: string,
  offset: number,
  valueFlags: ReadonlySet<string>,
  booleanFlags: ReadonlySet<string>,
  acceptsToken: (token: CommandToken) => boolean
): readonly CommandToken[] {
  const memo = new Map<number, readonly CommandToken[]>();

  function visit(token: CommandToken | null): readonly CommandToken[] {
    if (!token) return [];
    const cached = memo.get(token.end);
    if (cached) return cached;
    const result = visitUncached(token);
    memo.set(token.end, result);
    return result;
  }

  function visitUncached(token: CommandToken): readonly CommandToken[] {
    if (token.value === "--") {
      const selected = readCommandToken(text, token.end);
      return selected && acceptsToken(selected) ? [selected] : [];
    }
    if (!token.value.startsWith("-")) {
      return acceptsToken(token) ? [token] : [];
    }

    const next = readCommandToken(text, token.end);
    if (valueFlags.has(token.value)) {
      return next ? visit(readCommandToken(text, next.end)) : [];
    }
    if (
      token.value.includes("=") ||
      token.value.startsWith("--no-") ||
      booleanFlags.has(token.value)
    ) {
      return visit(next);
    }

    const candidates = [...visit(next)];
    if (next) candidates.push(...visit(readCommandToken(text, next.end)));
    return candidates.filter(
      (candidate, index) =>
        candidates.findIndex(
          (item) => item.end === candidate.end && item.value === candidate.value
        ) === index
    );
  }

  return visit(readCommandToken(text, offset));
}

function readNpmPreCommandTokens(
  text: string,
  offset: number
): readonly CommandToken[] {
  const commandNames = new Set([
    ...NPM_RUN_COMMANDS,
    ...Object.keys(NPM_LIFECYCLE_SCRIPTS),
  ]);
  return readConfiguredRunnerTokens(
    text,
    offset,
    RUNNER_VALUE_FLAGS.npm,
    NPM_PRE_COMMAND_BOOLEAN_FLAGS,
    (token) => commandNames.has(token.value.toLowerCase())
  );
}

function readNpmRunScriptTokens(
  text: string,
  offset: number,
  packageScriptNames?: ReadonlySet<string>
): readonly CommandToken[] {
  return readConfiguredRunnerTokens(
    text,
    offset,
    RUNNER_VALUE_FLAGS.npm,
    NPM_PRE_COMMAND_BOOLEAN_FLAGS,
    (token) => packageScriptNames?.has(token.value) !== false
  );
}

function readPnpmRunScriptTokens(
  text: string,
  offset: number,
  packageScriptNames?: ReadonlySet<string>
): readonly CommandToken[] {
  return readConfiguredRunnerTokens(
    text,
    offset,
    RUNNER_VALUE_FLAGS.pnpm,
    PNPM_RUN_BOOLEAN_FLAGS,
    (token) => packageScriptNames?.has(token.value) !== false
  );
}

/**
 * Statically recognizes `runner [flags] run [flags] script` for Bun, pnpm,
 * and Yarn; npm also accepts its `run-script`, `rum`, and `urn` aliases, while
 * pnpm also accepts `run-script`. Bun, pnpm, and Yarn accept non-builtin
 * `runner [flags] script` shorthand. npm accepts only its finite lifecycle
 * shorthand (`start`, `stop`, `restart`, and `test` plus `t`/`tst`). Script
 * names may be bare or single-/double-quoted.
 * Bounded required-value flags (`npm --prefix`, `-w`/`--workspace`,
 * `--script-shell`; the corresponding Bun forms; Yarn's global `--cwd` and
 * run-scoped `--require`; and `pnpm --dir`, `-C`, `--filter`, or `-F`) consume
 * one following token. Other
 * flags must be self-contained (for example `--silent` or `--cwd=path`). npm
 * additionally branches unknown config flags as boolean-or-value and filters
 * possible script tokens through the package-script inventory. npm, Bun, and
 * pnpm package-script execution includes
 * bounded pre/post lifecycle edges; npm `restart` chooses restart or stop/start
 * fallback edges from the supplied script inventory. This does not expand
 * variables or parse general shell syntax.
 */
function invokedPackageScripts(
  text: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  return shellLogicalLines(text).flatMap((line) =>
    invokedPackageScriptsOnLine(line.text, packageScriptNames)
  );
}

function invokedPackageScriptsOnLine(
  text: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  const scripts: string[] = [];
  for (const match of text.matchAll(PACKAGE_RUNNER_PATTERN)) {
    const runner = match.groups?.runner?.toLowerCase() as
      | PackageRunner
      | undefined;
    if (!(runner && match.index !== undefined)) continue;
    const commandTokens =
      runner === "npm"
        ? readNpmPreCommandTokens(text, match.index + match[0].length)
        : readRunnerTokens(text, match.index + match[0].length, runner, {
            consumeYarnRequireBeforeRun: runner === "yarn",
          });
    for (const commandToken of commandTokens) {
      scripts.push(
        ...invokedPackageScriptsForCommand(
          text,
          runner,
          commandToken,
          packageScriptNames
        )
      );
    }
  }
  return [...new Set(scripts)];
}

function invokedPackageScriptsForCommand(
  text: string,
  runner: PackageRunner,
  commandToken: CommandToken,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  const scripts: string[] = [];
  const command = commandToken.value.toLowerCase();
  const isRunCommand =
    runner === "npm"
      ? NPM_RUN_COMMANDS.has(command)
      : runner === "pnpm"
        ? PNPM_RUN_COMMANDS.has(command)
        : command === "run";
  if (isRunCommand) {
    const scriptTokens =
      runner === "npm"
        ? readNpmRunScriptTokens(text, commandToken.end, packageScriptNames)
        : runner === "pnpm"
          ? readPnpmRunScriptTokens(text, commandToken.end, packageScriptNames)
          : readRunnerTokens(text, commandToken.end, runner, {
              ...(runner === "yarn"
                ? { requiredValueFlags: YARN_RUN_REQUIRED_VALUE_FLAGS }
                : {}),
              skipArgumentDelimiter: runner !== "yarn",
            });
    for (const token of scriptTokens) {
      if (runner === "npm") {
        scripts.push(...npmLifecycleEdges(token.value, packageScriptNames));
      } else if (runner === "bun" || runner === "pnpm") {
        scripts.push(...packageLifecycleEdges(token.value, packageScriptNames));
      } else {
        scripts.push(token.value);
      }
    }
    return scripts;
  }
  if (runner === "npm") {
    const lifecycleScript = NPM_LIFECYCLE_SCRIPTS[command];
    if (lifecycleScript) {
      scripts.push(...npmLifecycleEdges(lifecycleScript, packageScriptNames));
    }
    return scripts;
  }
  if (RUNNER_BUILTINS[runner].has(command)) return scripts;
  if (runner === "bun" || runner === "pnpm") {
    scripts.push(
      ...packageLifecycleEdges(commandToken.value, packageScriptNames)
    );
  } else {
    scripts.push(commandToken.value);
  }
  return scripts;
}

function packageLifecycleEdges(
  script: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  if (packageScriptNames && !packageScriptNames.has(script)) return [];
  return [`pre${script}`, script, `post${script}`];
}

function npmLifecycleEdges(
  script: string,
  packageScriptNames?: ReadonlySet<string>
): readonly string[] {
  if (script !== "restart") return [`pre${script}`, script, `post${script}`];
  const restartEdges = ["prerestart", "restart", "postrestart"];
  const fallbackEdges = [
    ...(packageScriptNames?.has("stop") === false
      ? []
      : ["prestop", "stop", "poststop"]),
    ...(packageScriptNames?.has("start") === false
      ? []
      : ["prestart", "start", "poststart"]),
  ];
  if (!packageScriptNames) {
    return [...restartEdges, "prerestart", ...fallbackEdges, "postrestart"];
  }
  if (packageScriptNames.has("restart")) return restartEdges;
  return fallbackEdges.length > 0
    ? ["prerestart", ...fallbackEdges, "postrestart"]
    : [];
}

export function findRepoInternalScriptAliases(
  packageScripts: PackageScripts,
  repoInternalScripts: readonly string[],
  repoRoot?: string
): ReadonlySet<string> {
  const aliases = new Set<string>();
  const packageScriptNames = new Set(Object.keys(packageScripts));
  let changed = true;

  while (changed) {
    changed = false;
    for (const [name, command] of Object.entries(packageScripts)) {
      if (aliases.has(name)) continue;
      const commandLines = shellLogicalLines(command).map((line) => line.text);
      const referencesInternalBoundary = commandLines.some(
        (line) =>
          matchingProtectedBoundaryRules(line, repoRoot, "package-script")
            .length > 0 ||
          repoInternalScripts.some((path) =>
            hasRepoInternalScriptReference(line, path, repoRoot)
          )
      );
      const referencesInternalAlias = invokedPackageScripts(
        command,
        packageScriptNames
      ).some((dependency) => aliases.has(dependency));
      if (referencesInternalBoundary || referencesInternalAlias) {
        aliases.add(name);
        changed = true;
      }
    }
  }

  return aliases;
}

function hasRepoInternalScriptReference(
  text: string,
  path: string,
  repoRoot?: string
): boolean {
  const normalizedText = collapseRepeatedPathSeparators(
    withoutHttpUrls(normalizeLiteralShellPathQuotes(text.replaceAll("\\", "/")))
  ).toLowerCase();
  const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
  if (
    hasBarePathReference(normalizedText, normalizedPath) ||
    hasBarePathReference(normalizedText, `./${normalizedPath}`)
  ) {
    return true;
  }

  const escapedPath = normalizedPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const parentRelativePattern = new RegExp(
    `^(?:\\.\\./)+${escapedPath}$`,
    "iu"
  );
  const absoluteRepoPath =
    repoRoot === undefined
      ? undefined
      : posix.normalize(
          `${repoRoot.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()}/${normalizedPath}`
        );

  for (const match of normalizedText.matchAll(PATH_CANDIDATE_PATTERN)) {
    const candidate = posix.normalize(match[0].replace(/[!,.?:;]+$/u, ""));
    if (
      candidate === normalizedPath ||
      parentRelativePattern.test(candidate) ||
      candidate === absoluteRepoPath
    ) {
      return true;
    }
  }
  return false;
}

function hasBarePathReference(text: string, path: string): boolean {
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(path, offset);
    if (index < 0) return false;
    const before = text[index - 1];
    const after = text[index + path.length];
    if (
      (before === undefined || !/[a-z0-9_./:-]/iu.test(before)) &&
      (after === undefined || !/[a-z0-9_/-]/iu.test(after))
    ) {
      return true;
    }
    offset = index + path.length;
  }
  return false;
}

async function filesBelow(directory: string): Promise<readonly string[]> {
  const files: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else if (entry.isSymbolicLink()) {
        throw new Error(
          `skillset: public closure guard refuses symbolic link ${path}`
        );
      } else {
        throw new Error(
          `skillset: public closure guard refuses unsupported filesystem entry ${path}`
        );
      }
    }
  };

  await visit(directory);
  return files.toSorted();
}

export async function scanGeneratedPublicTree(
  rootDir: string
): Promise<PublicClosureScanResult> {
  const violations: PublicClosureViolation[] = [];
  let skippedBinaryFiles = 0;
  const files = await filesBelow(resolve(rootDir, PUBLIC_ROOT));
  const repoInternalScripts = (
    await filesBelow(resolve(rootDir, "scripts"))
  ).map((path) => relative(rootDir, path).replaceAll("\\", "/"));
  const packageJson = JSON.parse(
    await readFile(resolve(rootDir, "package.json"), "utf8")
  ) as { readonly scripts?: PackageScripts };
  const repoInternalScriptAliases = findRepoInternalScriptAliases(
    packageJson.scripts ?? {},
    repoInternalScripts,
    rootDir
  );
  const packageScriptNames = new Set(Object.keys(packageJson.scripts ?? {}));
  for (const path of files) {
    const content = await readFile(path);
    if (content.includes(0)) {
      skippedBinaryFiles += 1;
      continue;
    }
    const file = relative(rootDir, path).replaceAll("\\", "/");
    violations.push(
      ...scanGeneratedPublicContent(
        file,
        content.toString("utf8"),
        repoInternalScripts,
        repoInternalScriptAliases,
        packageScriptNames,
        rootDir
      )
    );
  }
  return {
    scannedFiles: files.length - skippedBinaryFiles,
    skippedBinaryFiles,
    violations,
  };
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const result = await scanGeneratedPublicTree(rootDir);
  if (result.violations.length > 0) {
    console.error(
      `skillset: public closure guard found ${result.violations.length} contributor or internal reference(s):`
    );
    for (const violation of result.violations) {
      console.error(
        `  ${violation.file}:${violation.line}: [${violation.rule}] ${violation.text}`
      );
    }
    process.exit(1);
  }
  const binaryNote =
    result.skippedBinaryFiles > 0
      ? `; skipped ${result.skippedBinaryFiles} binary file(s)`
      : "";
  console.error(
    `skillset: public closure guard scanned ${result.scannedFiles} generated public file(s)${binaryNote}; boundary is closed`
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
