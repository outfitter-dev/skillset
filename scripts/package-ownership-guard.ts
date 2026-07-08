import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageOwnershipViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const APP_SOURCE_PREFIX = "apps/skillset/src/";
const PACKAGE_INTERNAL_EXPORT_PATTERN =
  /^\s*export\s+(?:\*\s+|\{[^}]*\}\s+)from\s+["']@skillset\/[^"']+\/internal\/[^"']+["'];?\s*$/u;

export function isScannablePackageOwnershipPath(path: string): boolean {
  return path.startsWith(APP_SOURCE_PREFIX) && path.endsWith(".ts") && !path.includes("/__tests__/");
}

export function scanPackageOwnershipContent(file: string, content: string): readonly PackageOwnershipViolation[] {
  const violations: PackageOwnershipViolation[] = [];
  const lines = content.split(/\r?\n/u);
  for (const [index, text] of lines.entries()) {
    if (PACKAGE_INTERNAL_EXPORT_PATTERN.test(text)) {
      violations.push({ file, line: index + 1, text: text.trim() });
    }
  }
  return violations;
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function runText(command: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn([...command], { cwd: rootDir, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

async function main(): Promise<void> {
  const files = (await runText(["git", "ls-files", "--cached", "--others", "--exclude-standard"]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const scannable = files.filter(isScannablePackageOwnershipPath);
  const violations: PackageOwnershipViolation[] = [];

  for (const file of scannable) {
    const path = `${rootDir}/${file}`;
    if (!existsSync(path)) continue;
    violations.push(...scanPackageOwnershipContent(file, await Bun.file(path).text()));
  }

  if (violations.length === 0) {
    console.error(`skillset: package ownership guard scanned ${scannable.length} app source files; no app-level package facades found`);
    return;
  }

  console.error(`skillset: package ownership guard found ${violations.length} app-level package facade(s):`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.text}`);
  }
  console.error("skillset: import the owning package API or a documented package internal directly instead of adding app re-export facades.");
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
