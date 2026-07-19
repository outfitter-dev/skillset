import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const auditRoot = process.argv[2]
  ? resolve(process.argv[2])
  : dirname(fileURLToPath(import.meta.url));
const noteNames = (await readdir(auditRoot))
  .filter((name) => /^0[0-6]-.*\.md$/.test(name))
  .sort();
const expectedFindingCount = 51;
const allowedConfidence = new Set([
  "confirmed",
  "plausible",
  "decided-needed",
]);
const allowedDispositions = new Set(["open", "fixed", "wont-fix"]);
const errors: string[] = [];

if (noteNames.length !== 7) {
  errors.push(`expected 7 finding notes, found ${noteNames.length}`);
}

const headingConfidence = new Map<string, string>();
function confidenceFromHeading(heading: string): string | undefined {
  if (heading.includes("(confirmed")) {
    return "confirmed";
  }
  if (heading.includes("(plausible") || heading.includes("(observed") || heading.includes("(open")) {
    return "plausible";
  }
  if (heading.includes("(decided-needed") || heading.includes("(proposal")) {
    return "decided-needed";
  }
  return undefined;
}

for (const noteName of noteNames) {
  const source = await Bun.file(join(auditRoot, noteName)).text();
  for (const heading of source.match(/^### \d{2}\.\d+ — .*$/gm) ?? []) {
    const id = heading.match(/^### (\d{2}\.\d+) — /)?.[1];
    const confidence = confidenceFromHeading(heading);
    if (!id || !confidence) {
      errors.push(`cannot classify finding heading: ${heading}`);
      continue;
    }
    if (headingConfidence.has(id)) {
      errors.push(`duplicate finding heading ${id}`);
    }
    headingConfidence.set(id, confidence);
  }
}

const headingIds = [...headingConfidence.keys()];

const mapSource = await Bun.file(join(auditRoot, "FINDING-DISPOSITIONS.md")).text();
const rows = mapSource
  .split("\n")
  .filter((line) => /^\| \d{2}\.\d+ \|/.test(line))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
const rowIds = rows.map(([id]) => id);

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

if (headingIds.length !== expectedFindingCount) {
  errors.push(`expected ${expectedFindingCount} finding headings, found ${headingIds.length}`);
}
if (rows.length !== expectedFindingCount) {
  errors.push(`expected ${expectedFindingCount} disposition rows, found ${rows.length}`);
}
for (const duplicate of duplicates(rowIds)) {
  errors.push(`duplicate disposition row ${duplicate}`);
}
for (const id of headingIds.filter((id) => !rowIds.includes(id))) {
  errors.push(`missing disposition row ${id}`);
}
for (const id of rowIds.filter((id) => !headingIds.includes(id))) {
  errors.push(`disposition row ${id} has no finding heading`);
}

for (const row of rows) {
  const [id, confidence, disposition, owner, proof, notes] = row;
  if (row.length !== 6) {
    errors.push(`${id ?? "unknown row"} has ${row.length} columns, expected 6`);
    continue;
  }
  if (!allowedConfidence.has(confidence)) {
    errors.push(`${id} has invalid confidence ${confidence}`);
  }
  const expectedConfidence = headingConfidence.get(id);
  if (expectedConfidence && confidence !== expectedConfidence) {
    errors.push(`${id} confidence ${confidence} does not match source ${expectedConfidence}`);
  }
  if (!allowedDispositions.has(disposition)) {
    errors.push(`${id} has invalid disposition ${disposition}`);
  }
  const issueNumber = Number(owner.replace(/^SET-/, ""));
  if (!/^SET-\d+$/.test(owner) || issueNumber < 313 || issueNumber > 351) {
    errors.push(`${id} has invalid owner ${owner}`);
  }
  const hasMergedProof =
    /^https:\/\/github\.com\/outfitter-dev\/skillset\/pull\/\d+$/.test(proof) ||
    /^[0-9a-f]{40}$/.test(proof);
  if (disposition === "fixed" && !hasMergedProof) {
    errors.push(`${id} is fixed without a merged PR URL or full commit SHA`);
  }
  if (disposition === "wont-fix" && (!notes || notes === "—")) {
    errors.push(`${id} is wont-fix without a reason`);
  }
}

for (const name of [...noteNames, "INDEX.md", "FINDING-DISPOSITIONS.md"]) {
  const source = await Bun.file(join(auditRoot, name)).text();
  if (/task_[a-zA-Z0-9]+/.test(source)) {
    errors.push(`${name} contains an opaque task reference`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  const counts = Object.fromEntries(
    [...allowedDispositions].map((disposition) => [
      disposition,
      rows.filter((row) => row[2] === disposition).length,
    ])
  );
  console.log(
    `drift-audit findings: ${rows.length} total; ${counts.open} open; ${counts.fixed} fixed; ${counts["wont-fix"]} wont-fix`
  );
}
