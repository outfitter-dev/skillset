import { Parser, type Node } from "commonmark";
import { MIGRATION_MARKER_LABELS, formatMigrationMarker, parseMigrationMarker, type MigrationFlag, type MigrationMarker, type MigrationPlacement, type MigrationState } from "@skillset/schema";
import { assertMigrationState } from "./migration-state";

const markerPrefix = new RegExp(`^<!-- skillset:(?:${MIGRATION_MARKER_LABELS.join("|")})\\b`, "u");

export interface MigrationMarkerDiagnostic {
  readonly code: "migration/malformed-marker" | "migration/duplicate-anchor" | "migration/orphan-anchor" | "migration/marker-mismatch" | "migration/missing-anchor";
  readonly path: string;
  readonly line: number;
  readonly message: string;
}
export interface LocatedMigrationMarker extends MigrationMarker { readonly line: number }
export interface MigrationMarkerInspection {
  readonly content: string;
  /** One-based authored line for each line in the semantic document. */
  readonly sourceLines: readonly number[];
  readonly markers: readonly LocatedMigrationMarker[];
  readonly diagnostics: readonly MigrationMarkerDiagnostic[];
}

/**
 * Only standalone adaptive Markdown comments backed by the ledger are removed.
 * Any invalid anchor preserves the entire document; this function never reconciles
 * identities, changes review state, or interprets missing markers as resolution.
 */
export function inspectMigrationMarkers(args: {
  readonly content: string;
  readonly path: string;
  readonly state: MigrationState;
}): MigrationMarkerInspection {
  assertMigrationState(args.state);
  const { lines, endings, blocks, bodyOffset } = markdownStructure(args.content);
  const flags = new Map(args.state.flags.map((flag) => [flag.id, flag]));
  const markers: LocatedMigrationMarker[] = [];
  const diagnostics: MigrationMarkerDiagnostic[] = [];
  const removed = new Set<number>();
  const seen = new Set<string>();
  const diagnose = (code: MigrationMarkerDiagnostic["code"], line: number, message: string): void => {
    diagnostics.push({ code, path: args.path, line, message });
  };

  for (const node of blocks) {
    if (node.type !== "html_block") continue;
    const line = node.sourcepos[0][0] + bodyOffset;
    const text = lines[line - 1]!;
    if (!markerPrefix.test(text)) continue;
    const marker = parseMigrationMarker(text);
    if (marker === undefined || node.sourcepos[0][0] !== node.sourcepos[1][0] || inTable(lines, line, blocks, bodyOffset)) {
      diagnose("migration/malformed-marker", line, "Migration anchor must be an exact standalone comment at a safe Markdown block boundary.");
      continue;
    }
    markers.push({ ...marker, line });
    if (seen.has(marker.id)) diagnose("migration/duplicate-anchor", line, `Duplicate migration anchor ${marker.id}.`);
    seen.add(marker.id);
    const flag = flags.get(marker.id);
    if (flag === undefined) {
      diagnose("migration/orphan-anchor", line, `Migration anchor ${marker.id} has no ledger record.`);
    } else if (flag.source.path !== args.path || flag.placement.kind !== "inline" ||
      flag.placement.line !== line || flag.placement.label !== marker.label || flag.code !== marker.code || flag.message !== marker.message) {
      diagnose("migration/marker-mismatch", line, `Migration anchor ${marker.id} disagrees with its ledger location or text; review the source and ledger together.`);
    } else removed.add(line - 1);
  }
  for (const flag of args.state.flags) {
    if (flag.source.path === args.path && flag.placement.kind === "inline" && !seen.has(flag.id)) {
      diagnose("migration/missing-anchor", flag.placement.line, `Ledger anchor ${flag.id} is missing or is not at a safe Markdown block boundary; its review state is unchanged.`);
    }
  }
  if (diagnostics.length > 0) removed.clear();
  return {
    content: lines.map((line, index) => removed.has(index) ? "" : line + (endings[index] ?? "")).join(""),
    sourceLines: lines.flatMap((_, index) => removed.has(index) ? [] : [index + 1]),
    markers,
    diagnostics,
  };
}

/** Plan a locator insertion only. The caller owns the joint source/ledger transaction. */
export function planMigrationMarker(args: {
  readonly content: string;
  readonly path: string;
  readonly flag: MigrationFlag;
  readonly beforeLine: number;
  readonly kind: "adaptive-markdown" | "provider-native" | "resource" | "other";
}): { readonly placement: MigrationPlacement; readonly content?: string } {
  const sidecar = (reason: string) => ({ placement: { kind: "sidecar" as const, reason } });
  if (args.kind !== "adaptive-markdown") return sidecar(`${args.kind} source does not permit inline migration anchors.`);
  if (!args.path.endsWith(".md") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(args.content)) return sidecar("Only text Markdown sources permit inline migration anchors.");
  if (args.flag.source.path !== args.path) return sidecar("The flag belongs to a different source path.");
  const { blocks, bodyOffset, lines, endings } = markdownStructure(args.content);
  const block = blocks.find((node) => node.sourcepos[0][0] + bodyOffset === args.beforeLine);
  if (block === undefined || !["paragraph", "heading", "list"].includes(block.type) || inTable(lines, args.beforeLine, blocks, bodyOffset)) {
    return sidecar("Inline anchors require a top-level paragraph, heading or list boundary outside frontmatter, tables and code.");
  }
  const label = args.flag.placement.kind === "inline" ? args.flag.placement.label : "todo";
  let marker: string;
  try { marker = formatMigrationMarker({ ...args.flag, label }); }
  catch { return sidecar("The flag text cannot be represented safely in a single-line HTML comment."); }
  if (lines.some((line) => parseMigrationMarker(line)?.id === args.flag.id)) return sidecar("The source already contains this migration anchor.");
  const index = args.beforeLine - 1;
  const newline = endings[index] ?? endings[index - 1] ?? "\n";
  return {
    placement: { kind: "inline", label, line: args.beforeLine },
    content: lines.map((line, offset) => `${offset === index ? marker + newline : ""}${line}${endings[offset] ?? ""}`).join(""),
  };
}

function markdownStructure(content: string): {
  readonly lines: string[]; readonly endings: string[]; readonly bodyOffset: number; readonly blocks: Node[];
} {
  const lines = content.split(/\r\n|\n|\r/u);
  const endings = content.match(/\r\n|\n|\r/gu) ?? [];
  let bodyOffset = 0;
  if (lines[0] === "---") {
    const closing = lines.findIndex((line, index) => index > 0 && line === "---");
    bodyOffset = closing === -1 ? lines.length : closing + 1;
  }
  const tree = new Parser().parse(lines.slice(bodyOffset).join("\n"));
  const blocks: Node[] = [];
  for (let node = tree.firstChild; node !== null; node = node.next) blocks.push(node);
  return { lines, endings, bodyOffset, blocks };
}

/** CommonMark has no GFM tables; conservatively protect the complete pipe-table region. */
function inTable(lines: readonly string[], line: number, blocks: readonly Node[], bodyOffset: number): boolean {
  // Judge an anchor against the Markdown it would leave behind. Otherwise its
  // HTML block can split a table and make an unsafe insertion appear valid.
  if (parseMigrationMarker(lines[line - 1] ?? "") !== undefined) {
    const semantic = markdownStructure(lines.filter((_, index) => index !== line - 1).join("\n"));
    return inTable(semantic.lines, line, semantic.blocks, semantic.bodyOffset);
  }
  for (let index = 1; index < lines.length; index += 1) {
    // Raw table spellings in fenced/indented code, HTML, and frontmatter do not define Markdown tables.
    const paragraph = blocks.find((node) => node.type === "paragraph" && node.sourcepos[0][0] + bodyOffset <= index && node.sourcepos[1][0] + bodyOffset >= index + 1);
    if (paragraph === undefined) continue;
    const delimiter = lines[index]!;
    if (!delimiter.includes("|") || !/^ {0,3}\|?[ \t]*:?-+:?(?:[ \t]*\|[ \t]*:?-+:?)*[ \t]*\|?[ \t]*$/u.test(delimiter)) continue;
    if (lines[index - 1]!.trim() === "") continue;
    const end = paragraph.sourcepos[1][0] + bodyOffset;
    if (line >= index && line <= end) return true;
  }
  return false;
}
