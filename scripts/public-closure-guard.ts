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

type PackageScripts = Readonly<Record<string, string>>;
type PackageRunner = "bun" | "npm" | "pnpm" | "yarn";

const PUBLIC_ROOT = "plugins/skillset/";
const CLOSURE_PATTERNS: readonly ClosurePattern[] = [
  {
    pattern:
      /(?:^|[^a-z0-9-])skillset-dev(?:-[a-z0-9][a-z0-9-]*)?(?=$|[^a-z0-9-])/iu,
    rule: "contributor-skill",
  },
  {
    pattern: /\bdocs\/development(?![a-z0-9_-]|\.[a-z0-9_-])/iu,
    rule: "development-docs",
  },
  {
    pattern: /\bfixtures(?![a-z0-9_-]|\.[a-z0-9_-])/iu,
    rule: "fixture-path",
  },
  {
    pattern:
      /(?:@skillset\/[a-z0-9._-]+\/(?:internal|src)(?![a-z0-9_-]|\.[a-z0-9_-])|\bpackages\/[a-z0-9._-]*[a-z0-9_-](?![a-z0-9_-]|\.[a-z0-9_-])|\bapps\/skillset\/src(?![a-z0-9_-]|\.[a-z0-9_-]))/iu,
    rule: "internal-package",
  },
  {
    pattern:
      /(?:\brepo:scripts\/|(?:^|[\s("'`])(?:\.\.\/|\.\/|\/)scripts\/|\b(?:bun|node|tsx?)\s+(?:\.\/)?scripts\/|\bcd\s+(?:[`<{[(])?(?:\.\/)?scripts\/?(?=$|[`>\]})]|[.,?:!](?=$|\s)|\s*(?:&&|\|\||\d*[<>]|[;&|#]))|\b(?:browse|edit|enter|inspect|list|open|read|visit)\s+(?:[`<{[(])?(?:\.\/)?(?:scripts\/(?=$|[\s`>\]})...,;:])|scripts(?=$|[`>\]})]|\.{2,}|[,;:]|\s+(?:directory|folder)\b)))/iu,
    rule: "internal-script",
  },
] as const;

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
const RUNNER_VALUE_FLAGS: Readonly<Record<PackageRunner, ReadonlySet<string>>> =
  {
    bun: BUN_RUN_REQUIRED_VALUE_FLAGS,
    npm: new Set(["--prefix", "--script-shell", "--workspace", "-w"]),
    pnpm: new Set(["--dir", "--filter", "-C", "-F"]),
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
  for (const { line, text } of shellLogicalLines(content)) {
    for (const { pattern, rule } of CLOSURE_PATTERNS) {
      if (pattern.test(text)) {
        violations.push({ file, line, rule, text: text.trim() });
      }
    }
    if (
      !violations.some(
        (violation) =>
          violation.line === line && violation.rule === "internal-script"
      ) &&
      hasRepoInternalScriptDirectoryReference(text, repoRoot)
    ) {
      violations.push({
        file,
        line,
        rule: "internal-script",
        text: text.trim(),
      });
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

function shellLogicalLines(
  content: string
): readonly { readonly line: number; readonly text: string }[] {
  const lines = content.split(/\r?\n/u);
  const logicalLines: { line: number; text: string }[] = [];
  let line = 1;
  let text = "";

  for (const [index, physicalLine] of lines.entries()) {
    if (text.length === 0) line = index + 1;
    if (physicalLine.endsWith("\\")) {
      text += physicalLine.slice(0, -1);
    } else {
      logicalLines.push({ line, text: text + physicalLine });
      text = "";
    }
  }
  if (text.length > 0) logicalLines.push({ line, text });
  return logicalLines;
}

function readCommandToken(text: string, offset: number): CommandToken | null {
  let start = offset;
  while (/\s/u.test(text[start] ?? "")) start += 1;
  while (text[start] === "`") start += 1;
  const quote = text[start];
  if (quote === '"' || quote === "'") {
    let end = start + 1;
    let value = "";
    while (end < text.length) {
      const character = text[end];
      if (character === quote) return { end: end + 1, value };
      if (character === "\\" && end + 1 < text.length) {
        end += 1;
        value += text[end];
      } else {
        value += character;
      }
      end += 1;
    }
    return null;
  }

  let end = start;
  while (end < text.length && !/[\s`'"();,]/u.test(text[end] ?? "")) {
    end += 1;
  }
  return end === start ? null : { end, value: text.slice(start, end) };
}

function readRunnerTokens(
  text: string,
  offset: number,
  runner: PackageRunner
): readonly CommandToken[] {
  const visit = (token: CommandToken | null): readonly CommandToken[] => {
    if (!token || token.value === "--") return [];
    if (!token.value.startsWith("-")) return [token];

    const next = readCommandToken(text, token.end);
    if (RUNNER_VALUE_FLAGS[runner].has(token.value)) {
      return next ? visit(readCommandToken(text, next.end)) : [];
    }
    return visit(next);
  };

  return visit(readCommandToken(text, offset));
}

/**
 * Statically recognizes `runner [flags] run [flags] script` for Bun, pnpm,
 * and Yarn; npm also accepts its `run-script`, `rum`, and `urn` aliases, while
 * pnpm also accepts `run-script`. Bun, pnpm, and Yarn accept non-builtin
 * `runner [flags] script` shorthand. npm accepts only its finite lifecycle
 * shorthand (`start`, `stop`, `restart`, and `test` plus `t`/`tst`). Script
 * names may be bare or single-/double-quoted.
 * Bounded required-value flags (`npm --prefix`, `-w`/`--workspace`,
 * `--script-shell`; the corresponding Bun forms; `yarn --cwd`; and
 * `pnpm --dir`, `-C`, `--filter`, or `-F`) consume one following token. Other
 * flags must be self-contained (for example `--silent` or `--cwd=path`). npm,
 * Bun, and pnpm package-script execution includes
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
    const commandTokens = readRunnerTokens(
      text,
      match.index + match[0].length,
      runner
    );
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
    for (const token of readRunnerTokens(text, commandToken.end, runner)) {
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
      const referencesInternalPath = repoInternalScripts.some((path) =>
        commandLines.some((line) =>
          hasRepoInternalScriptReference(line, path, repoRoot)
        )
      );
      const referencesInternalAlias = invokedPackageScripts(
        command,
        packageScriptNames
      ).some((dependency) => aliases.has(dependency));
      if (referencesInternalPath || referencesInternalAlias) {
        aliases.add(name);
        changed = true;
      }
    }
  }

  return aliases;
}

function hasRepoInternalScriptDirectoryReference(
  text: string,
  repoRoot?: string
): boolean {
  const normalizedText = text.replaceAll("\\", "/");
  const parentRelativePattern = /^(?:\.\.\/)+scripts\/?$/iu;
  const absoluteRepoPath =
    repoRoot === undefined
      ? undefined
      : posix.normalize(
          `${repoRoot.replaceAll("\\", "/").replace(/\/+$/u, "")}/scripts`
        );

  for (const match of normalizedText.matchAll(PATH_CANDIDATE_PATTERN)) {
    const candidate = posix.normalize(match[0].replace(/[!,.?:;]+$/u, ""));
    if (
      parentRelativePattern.test(candidate) ||
      candidate === absoluteRepoPath
    ) {
      return true;
    }
  }
  return false;
}

function hasRepoInternalScriptReference(
  text: string,
  path: string,
  repoRoot?: string
): boolean {
  const normalizedText = text.replaceAll("\\", "/");
  const normalizedPath = path.replaceAll("\\", "/");
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
          `${repoRoot.replaceAll("\\", "/").replace(/\/+$/u, "")}/${normalizedPath}`
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
