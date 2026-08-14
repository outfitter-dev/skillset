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

export function isGeneratedPublicPath(path: string): boolean {
  return path.startsWith(PUBLIC_ROOT) && path.length > PUBLIC_ROOT.length;
}

export function scanGeneratedPublicContent(
  file: string,
  content: string,
  repoInternalScripts: readonly string[] = []
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
    }
  }
  return violations;
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
        repoInternalScripts
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
