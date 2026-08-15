import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
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
  { pattern: /\bdocs\/development\//iu, rule: "development-docs" },
  { pattern: /\bfixtures\//iu, rule: "fixture-path" },
  {
    pattern:
      /(?:@skillset\/[a-z0-9._-]+\/(?:internal|src)(?:\/|\b)|\bpackages\/[a-z0-9._-]+\/|\bapps\/skillset\/src\/)/iu,
    rule: "internal-package",
  },
  {
    pattern:
      /(?:\brepo:scripts\/|(?:^|[\s("'`])(?:\.\.\/|\.\/|\/)scripts\/|\b(?:bun|node|tsx?)\s+(?:\.\/)?scripts\/)/u,
    rule: "internal-script",
  },
] as const;

const PACKAGE_RUNNER_PATTERN =
  /(?<![a-z0-9_-])(?<runner>bun|npm|pnpm|yarn)(?![a-z0-9_-])/giu;
const RUNNER_VALUE_FLAGS: Readonly<Record<PackageRunner, ReadonlySet<string>>> =
  {
    bun: new Set(["--cwd"]),
    npm: new Set(["--prefix"]),
    pnpm: new Set(["--dir"]),
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
  repoInternalScriptAliases: ReadonlySet<string> = new Set()
): readonly PublicClosureViolation[] {
  if (!isGeneratedPublicPath(file)) return [];
  const violations: PublicClosureViolation[] = [];
  for (const [index, text] of content.split(/\r?\n/u).entries()) {
    for (const { pattern, rule } of CLOSURE_PATTERNS) {
      if (pattern.test(text)) {
        violations.push({ file, line: index + 1, rule, text: text.trim() });
      }
    }
    if (
      !violations.some(
        (violation) =>
          violation.line === index + 1 && violation.rule === "internal-script"
      ) &&
      repoInternalScripts.some((path) => hasBarePathReference(text, path))
    ) {
      violations.push({
        file,
        line: index + 1,
        rule: "internal-script",
        text: text.trim(),
      });
    } else if (
      !violations.some(
        (violation) =>
          violation.line === index + 1 && violation.rule === "internal-script"
      ) &&
      invokedPackageScripts(text).some((name) =>
        repoInternalScriptAliases.has(name)
      )
    ) {
      violations.push({
        file,
        line: index + 1,
        rule: "internal-script",
        text: text.trim(),
      });
    }
  }
  return violations;
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

function readRunnerToken(
  text: string,
  offset: number,
  runner: PackageRunner
): CommandToken | null {
  let token = readCommandToken(text, offset);
  while (token?.value.startsWith("-") && token.value !== "--") {
    const consumesValue = RUNNER_VALUE_FLAGS[runner].has(token.value);
    token = readCommandToken(text, token.end);
    if (consumesValue) {
      if (!token) return null;
      token = readCommandToken(text, token.end);
    }
  }
  return token?.value === "--" ? null : token;
}

/**
 * Statically recognizes `runner [flags] run [flags] script` for Bun, npm,
 * pnpm, and Yarn, plus non-builtin `runner [flags] script` shorthand for Bun,
 * pnpm, and Yarn. Script names may be bare or single-/double-quoted. Bounded
 * value flags (`npm --prefix`, `bun/yarn --cwd`, and `pnpm --dir`) consume one
 * following token; other flags must be self-contained (for example `--silent`
 * or `--cwd=path`). This does not expand variables or parse general shell
 * syntax.
 */
function invokedPackageScripts(text: string): readonly string[] {
  const scripts: string[] = [];
  for (const match of text.matchAll(PACKAGE_RUNNER_PATTERN)) {
    const runner = match.groups?.runner?.toLowerCase() as
      | PackageRunner
      | undefined;
    if (!(runner && match.index !== undefined)) continue;
    let token = readRunnerToken(text, match.index + match[0].length, runner);
    if (!token) continue;
    if (token.value === "run") {
      token = readRunnerToken(text, token.end, runner);
    } else if (runner === "npm") {
      continue;
    } else if (RUNNER_BUILTINS[runner].has(token.value.toLowerCase())) {
      continue;
    }
    if (token?.value) scripts.push(token.value);
  }
  return scripts;
}

export function findRepoInternalScriptAliases(
  packageScripts: PackageScripts,
  repoInternalScripts: readonly string[]
): ReadonlySet<string> {
  const aliases = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [name, command] of Object.entries(packageScripts)) {
      if (aliases.has(name)) continue;
      const referencesInternalPath = repoInternalScripts.some(
        (path) =>
          hasBarePathReference(command, path) ||
          hasBarePathReference(command, `./${path}`)
      );
      const referencesInternalAlias = invokedPackageScripts(command).some(
        (dependency) => aliases.has(dependency)
      );
      if (referencesInternalPath || referencesInternalAlias) {
        aliases.add(name);
        changed = true;
      }
    }
  }

  return aliases;
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
    repoInternalScripts
  );
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
        repoInternalScriptAliases
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
