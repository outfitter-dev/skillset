import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliSurfaceViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const RETIRED_SURFACE = [
  /(?:\bskillset|cli\.ts)\s+(?:adopt|ci|create|doctor|features|lint|providers|suggest-source|try|verify)\b/u,
  /\bbun run skillset:(?:lint|verify)\b/u,
  /\b(?:build|diff)(?:\/|,\s*and\s+)verify\b/u,
  /\b(?:doctor\/explain|explain\/doctor)\b/u,
  /\bSKILLSET_TRY_[A-Z_]+\b/u,
  /\bskillset\b[^\n]{0,100}(?:^|[\s`[])--(?:apply|dist|dry-run|global|layout|source|watch)\b/u,
  /["'`]--(?:claude|codex|cursor)["'`]/u,
  /["'`]skillset: [^"'`\n]*\btry\b/u,
  /["'`]try (?:command|config|failed|latest|passed|plugin|run|status|tail|list)\b/u,
] as const;

const EXCLUDED = [
  ".agents/",
  ".claude/",
  ".cursor/",
  ".changeset/",
  ".skillset/changes/",
  "docs/adrs/",
  "docs/package-ownership.md",
  "docs/reference/cli-flags.md",
  "apps/skillset/CHANGELOG.md",
  "scripts/cli-contract.ts",
  "scripts/cli-surface-guard.ts",
  "scripts/migrate-workspace-state.ts",
  "scripts/publish.ts",
] as const;

export function isCliSurfacePath(path: string): boolean {
  if (path.includes("/__tests__/") || path.startsWith("scripts/__tests__/")) return false;
  if (EXCLUDED.some((prefix) => path === prefix || path.startsWith(prefix))) return false;
  return /\.(?:json|md|ts|yaml|yml)$/u.test(path);
}

export function scanCliSurface(file: string, content: string): readonly CliSurfaceViolation[] {
  return content.split(/\r?\n/u).flatMap((text, index) =>
    RETIRED_SURFACE.some((pattern) => pattern.test(text))
      ? [{ file, line: index + 1, text: text.trim() }]
      : []
  );
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function gitFiles(): Promise<readonly string[]> {
  const proc = Bun.spawn(["git", "ls-files"], { cwd: rootDir, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`git ls-files failed: ${stderr.trim()}`);
  return stdout.split("\n").filter(Boolean);
}

async function main(): Promise<void> {
  const files = (await gitFiles()).filter(isCliSurfacePath);
  const violations: CliSurfaceViolation[] = [];
  for (const file of files) {
    const path = `${rootDir}/${file}`;
    if (!existsSync(path)) continue;
    violations.push(...scanCliSurface(file, await Bun.file(path).text()));
  }
  if (violations.length === 0) {
    console.error(`skillset: CLI surface guard scanned ${files.length} files; final vocabulary is clean`);
    return;
  }
  console.error(`skillset: CLI surface guard found ${violations.length} retired surface use(s):`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

if (import.meta.main) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
