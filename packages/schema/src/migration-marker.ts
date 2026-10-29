import { MIGRATION_CODE_PATTERN, MIGRATION_FLAG_ID_PATTERN, MIGRATION_MARKER_LABELS } from "./migration-state-contract";

/** A locator only; matching this grammar does not establish ledger ownership. */
export interface MigrationMarker {
  readonly label: (typeof MIGRATION_MARKER_LABELS)[number];
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

const idPattern = new RegExp(MIGRATION_FLAG_ID_PATTERN, "u");
const codePattern = new RegExp(MIGRATION_CODE_PATTERN, "u");

/** Exact single-line HTML comment; reject HTML delimiters and control characters. */
export function parseMigrationMarker(text: string): MigrationMarker | undefined {
  const match = /^<!-- skillset:([^ ]+) ::: #([^ ]+) \[([^\]]+)\] (.+) -->$/u.exec(text);
  if (match === null) return undefined;
  const [, label, id, code, message] = match;
  if (!MIGRATION_MARKER_LABELS.some((value) => value === label) || !idPattern.test(id!) || !codePattern.test(code!)) return undefined;
  if (message !== message!.trim() || /[\u0000-\u001f\u007f]|--/u.test(message!)) return undefined;
  return { label: label as MigrationMarker["label"], id: id!, code: code!, message: message! };
}

export function formatMigrationMarker(marker: MigrationMarker): string {
  const text = `<!-- skillset:${marker.label} ::: #${marker.id} [${marker.code}] ${marker.message} -->`;
  if (parseMigrationMarker(text) === undefined) throw new Error("skillset: invalid migration marker fields or unsafe comment text");
  return text;
}
