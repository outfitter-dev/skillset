import { parseAdrNumber } from "./discovery.ts";
import type { AdrFile } from "./frontmatter.ts";

export interface AmendmentIssue {
  file: string;
  message: string;
}

const amendmentRefs = (adr: AdrFile): unknown => adr.frontmatter.amends;

const numberedById = (numbered: AdrFile[]): Map<number, AdrFile> =>
  new Map(
    numbered.flatMap((adr) => {
      const number = parseAdrNumber(adr.filename);
      return number === null ? [] : [[number, adr] as const];
    })
  );

const hasSupersessionEvidence = (
  adr: AdrFile,
  byId: ReadonlyMap<number, AdrFile>,
  visiting: ReadonlySet<number> = new Set()
): boolean => {
  const source = parseAdrNumber(adr.filename);
  const refs = adr.frontmatter.superseded_by;
  if (
    source === null ||
    visiting.has(source) ||
    !Array.isArray(refs) ||
    refs.length === 0
  ) {
    return false;
  }
  const nextVisiting = new Set(visiting);
  nextVisiting.add(source);
  return refs.every((rawRef) => {
    const ref = String(rawRef);
    if (!/^\d+$/u.test(ref)) {
      return false;
    }
    const successor = Number(ref);
    const replacement = byId.get(successor);
    return (
      successor > source &&
      replacement !== undefined &&
      isHistoricallyAccepted(replacement, byId, nextVisiting)
    );
  });
};

const isHistoricallyAccepted = (
  adr: AdrFile,
  byId: ReadonlyMap<number, AdrFile>,
  visiting: ReadonlySet<number> = new Set()
): boolean => {
  const status = String(adr.frontmatter.status ?? "");
  return (
    status === "accepted" ||
    (status === "superseded" &&
      hasSupersessionEvidence(adr, byId, visiting))
  );
};

/** Validate authored amendment declarations without mutating ADR source. */
export const validateAmendments = (
  numbered: AdrFile[],
  drafts: AdrFile[]
): AmendmentIssue[] => {
  const issues: AmendmentIssue[] = [];
  const byId = numberedById(numbered);
  const all = [...numbered, ...drafts];

  for (const adr of all) {
    if (Object.hasOwn(adr.frontmatter, "amended_by")) {
      issues.push({
        file: adr.filename,
        message: "amended_by is generated and must not be authored",
      });
    }

    const refs = amendmentRefs(adr);
    if (refs === undefined) {
      continue;
    }
    if (!Array.isArray(refs)) {
      issues.push({
        file: adr.filename,
        message: "amends must be an array of numbered ADR ids",
      });
      continue;
    }

    if (
      adr.frontmatter.status === "superseded" &&
      !hasSupersessionEvidence(adr, byId)
    ) {
      issues.push({
        file: adr.filename,
        message:
          "superseded ADR with amends requires accepted later superseded_by replacements as acceptance-history evidence",
      });
    }

    const sourceNumber = parseAdrNumber(adr.filename);
    const seen = new Set<number>();
    for (const rawRef of refs) {
      const ref = String(rawRef);
      if (!/^\d+$/u.test(ref)) {
        issues.push({
          file: adr.filename,
          message: `amends target "${ref}" must be an existing numbered ADR id`,
        });
        continue;
      }

      const targetNumber = Number(ref);
      if (seen.has(targetNumber)) {
        issues.push({
          file: adr.filename,
          message: `duplicate amends target ${targetNumber}`,
        });
        continue;
      }
      seen.add(targetNumber);

      if (sourceNumber !== null && targetNumber === sourceNumber) {
        issues.push({
          file: adr.filename,
          message: `ADR ${sourceNumber} cannot amend itself`,
        });
        continue;
      }
      if (sourceNumber !== null && targetNumber > sourceNumber) {
        issues.push({
          file: adr.filename,
          message: `amends target ${targetNumber} must have a lower number than ${sourceNumber}`,
        });
      }

      const target = byId.get(targetNumber);
      if (!target) {
        issues.push({
          file: adr.filename,
          message: `amends target ${targetNumber} does not exist as a numbered ADR`,
        });
        continue;
      }
      if (!isHistoricallyAccepted(target, byId)) {
        issues.push({
          file: adr.filename,
          message: `amends target ${targetNumber} must be accepted (historically accepted superseded ADRs remain eligible)`,
        });
      }
    }
  }

  const edges = new Map<number, number[]>();
  for (const adr of numbered) {
    const source = parseAdrNumber(adr.filename);
    const refs = amendmentRefs(adr);
    if (source === null || !Array.isArray(refs)) {
      continue;
    }
    edges.set(
      source,
      refs
        .map(String)
        .filter((ref) => /^\d+$/u.test(ref))
        .map(Number)
        .filter((target) => byId.has(target))
    );
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (node: number, path: number[]): void => {
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      issues.push({
        file: byId.get(node)?.filename ?? String(node),
        message: `cyclic amends relation: ${cycle.join(" -> ")}`,
      });
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    for (const target of edges.get(node) ?? []) {
      visit(target, [...path, node]);
    }
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) {
    visit(node, []);
  }

  return issues;
};

/** Derive reciprocal edges from accepted decisions, retaining superseded history. */
export const buildAmendedBy = (numbered: AdrFile[]): Map<number, string[]> => {
  const amendedBy = new Map<number, string[]>();
  const byId = numberedById(numbered);
  for (const adr of numbered) {
    const source = parseAdrNumber(adr.filename);
    const refs = amendmentRefs(adr);
    if (
      source === null ||
      !isHistoricallyAccepted(adr, byId) ||
      !Array.isArray(refs)
    ) {
      continue;
    }
    for (const target of refs.map(String)) {
      if (!/^\d+$/u.test(target)) {
        continue;
      }
      const targetNumber = Number(target);
      const inbound = amendedBy.get(targetNumber) ?? [];
      inbound.push(String(source));
      amendedBy.set(targetNumber, inbound);
    }
  }
  return amendedBy;
};
