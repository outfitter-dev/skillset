/**
 * Terminology guard for the derive/render/destination cutover (SET-126).
 *
 * Blocks retired compiler vocabulary (the `lowering`/`lowering outcome` family,
 * the old `compile.unsupported` config key, and friends) from drifting back into
 * active source, docs, generated Skillset guidance, CLI output, schema names, and
 * tests. The active vocabulary uses build/compile/adapt/transform/write,
 * provider vs destination, render result(s), compile.unsupportedDestination,
 * and unsupported destination policy. Some internal schema names still use
 * `target` where the code is modeling the Claude/Codex provider enum; new
 * adopter-facing language should prefer provider/destination.
 *
 * Allowlists are deliberately small and explicit; see ALLOWLIST_PATHS and
 * ALLOWLIST_LINE below and the "Updating the allowlist" note at the bottom.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type TerminologyViolation = {
  readonly file: string;
  readonly label: string;
  readonly line: number;
  readonly text: string;
};

type ForbiddenTerm = { readonly label: string; readonly pattern: RegExp };

/** Retired terms that must not reappear in active surfaces. */
export const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = [
  { label: "lowering outcome -> render result", pattern: /lowering[\s-]outcome/i },
  { label: "loweringOutcomes -> renderResults", pattern: /loweringOutcomes?\b/ },
  { label: "LOWERING_OUTCOME -> RENDER_RESULT", pattern: /LOWERING_OUTCOME/ },
  { label: "SkillsetLowering* -> SkillsetRenderResult*", pattern: /SkillsetLowering/ },
  { label: "skillset-lowering-outcome@1 -> skillset-render-result@1", pattern: /skillset-lowering-outcome/ },
  { label: "loweringOwner -> renderOwner", pattern: /loweringOwner/ },
  { label: "lowering policy -> unsupported destination policy", pattern: /lowering policy/i },
  { label: "loss ledger -> render report", pattern: /loss ledger/i },
  { label: "compile.unsupported -> compile.unsupportedDestination", pattern: /compile\.unsupported(?!Destination)/ },
  { label: "lowering -> render/derive", pattern: /\blowering\b/i },
  { label: "lowered -> rendered/derived", pattern: /\blowered\b/i },
];

/**
 * Path prefixes excluded from scanning. Each is historical, generated (validated
 * from `.skillset/` source elsewhere), a deferred-concept owner, or this guard's
 * own files.
 */
export const ALLOWLIST_PATHS: readonly string[] = [
  // Historical decision records keep their original vocabulary.
  "docs/adrs/",
  // Goal packets describe the old vocabulary they are cutting over.
  ".agents/plans/",
  // The committed 2026-07-18 audit preserves the retired term as historical
  // evidence for finding 03.5; SET-327 owns its governance disposition.
  ".agents/notes/2026-07-18-drift-audit/03-governance-and-docs-lag.md",
  // Generated output trees are validated against `.skillset/` source by check --only outputs.
  ".agents/skills/",
  ".claude/",
  "plugins/",
  ".skillset/cache/",
  ".skillset/snapshots/",
  // Changesets and change-provenance notes describe the cutover / prior changes.
  ".changeset/",
  ".skillset/changes/",
  // Package changelogs are generated release history and may quote old terms from
  // prior public changes.
  "apps/skillset/CHANGELOG.md",
  // Deferred follow-up: the transform-dialect `lowering` capability is a distinct
  // concept (see RETRO); renaming it is a separate behavioral change.
  "packages/transforms/",
  "packages/core/src/render.ts",
  // The `deterministic-projection` conformance concept is intentionally not renamed.
  "packages/core/src/deterministic-projection.ts",
  "packages/core/src/__tests__/deterministic-projection.test.ts",
  // This guard and its test necessarily contain the retired terms as patterns.
  "scripts/terminology-guard.ts",
  "scripts/__tests__/terminology-guard.test.ts",
];

/**
 * Per-line exceptions: a matched line is allowed when it contains one of these
 * substrings. Kept tiny and specific.
 */
export const ALLOWLIST_LINE: readonly string[] = [
  // Links/titles that name the historical, un-renamed ADR file. A forbidden match
  // is exempt only when it sits ENTIRELY inside one of these substrings (see
  // allowlistedSpans), so these cannot mask a regression elsewhere on the line.
  "lowering-outcomes-and-loss-ledger",
  "Lowering Outcomes and Loss Ledger",
  "[Lowering Outcomes]",
  // Deferred follow-up: the transform-dialect `lowering` capability and the
  // version-`lowering` concept are distinct from the render-result cutover and
  // are renamed separately. These markers carve out their specific usages of the
  // bare `lowering`/`lowered` verb.
  "match.lowering",
  "lowering: match",
  'lowering: TransformMatch["lowering"]',
  'lowering: "none"',
  "Codex lowering",
  "no-lowering",
  "skill-local lowering",
  "version lowering",
  "constructs lowered",
  "spans it lowered",
  "no lowering for",
  "portable lowering",
];

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".md", ".json", ".yaml", ".yml"]);

export function isScannablePath(path: string): boolean {
  if (ALLOWLIST_PATHS.some((prefix) => path === prefix || path.startsWith(prefix))) return false;
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return SCANNED_EXTENSIONS.has(path.slice(dot));
}

/**
 * Character spans of every allowlist substring occurrence on a line. A forbidden
 * match is exempt only when it falls ENTIRELY inside one of these spans, so an
 * allowlisted phrase cannot mask an unrelated regression elsewhere on the line.
 */
function allowlistedSpans(text: string): readonly (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = [];
  for (const allowed of ALLOWLIST_LINE) {
    let index = text.indexOf(allowed);
    while (index >= 0) {
      spans.push([index, index + allowed.length]);
      index = text.indexOf(allowed, index + 1);
    }
  }
  return spans;
}

function globalize(pattern: RegExp): RegExp {
  return pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

/** Scan one file's content and return any violations. Pure; used by tests. */
export function scanContent(file: string, content: string): readonly TerminologyViolation[] {
  const violations: TerminologyViolation[] = [];
  const lines = content.split(/\r?\n/u);
  for (const [index, text] of lines.entries()) {
    const allowed = allowlistedSpans(text);
    for (const term of FORBIDDEN_TERMS) {
      for (const match of text.matchAll(globalize(term.pattern))) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const exempt = allowed.some(([spanStart, spanEnd]) => spanStart <= start && end <= spanEnd);
        if (!exempt) {
          violations.push({ file, label: term.label, line: index + 1, text: text.trim() });
          break;
        }
      }
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
  const tracked = (await runText(["git", "ls-files"])).split("\n").map((line) => line.trim()).filter(Boolean);
  const scannable = tracked.filter(isScannablePath);
  const violations: TerminologyViolation[] = [];
  for (const file of scannable) {
    if (!existsSync(`${rootDir}/${file}`)) continue;
    const content = await Bun.file(`${rootDir}/${file}`).text();
    violations.push(...scanContent(file, content));
  }

  if (violations.length === 0) {
    console.error(`skillset: terminology guard scanned ${scannable.length} files; no retired vocabulary found`);
    return;
  }

  console.error(`skillset: terminology guard found ${violations.length} retired-vocabulary use(s):`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.label}`);
    console.error(`    ${violation.text}`);
  }
  console.error(
    "skillset: replace retired terminology with the build/provider/destination vocabulary, " +
      "or extend the allowlist in scripts/terminology-guard.ts for deliberate historical/deferred context."
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

/*
 * Updating the allowlist
 * ----------------------
 * The guard runs in `bun run check`. When it fails:
 *
 * 1. Prefer fixing the source: replace the retired term with the
 *    build/provider/destination vocabulary. This is correct ~99% of the time.
 * 2. Only allowlist for DELIBERATE historical or deferred context:
 *    - A whole file/tree that is historical (ADRs), generated (validated from
 *      `.skillset/` source elsewhere), or owns a deferred concept (the
 *      transform-dialect `lowering` capability, the deterministic-projection
 *      conformance concept): add a prefix to ALLOWLIST_PATHS with a comment.
 *    - A single legitimate line (a link naming the un-renamed ADR file, a
 *      deferred-concept usage): add a distinctive substring to ALLOWLIST_LINE
 *      with a comment. Keep substrings specific enough that they cannot mask a
 *      render-result regression (those match the symbol patterns above).
 *
 * Keep both lists explicit and small. A growing allowlist is a signal that a
 * deferred rename (e.g. the transforms `lowering` field) should finally land.
 */
