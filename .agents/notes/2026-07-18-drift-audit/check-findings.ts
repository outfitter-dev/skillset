import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const auditRoot = dirname(fileURLToPath(import.meta.url));
const noteNames = (await readdir(auditRoot))
  .filter((name) => /^0[0-6]-.*\.md$/.test(name))
  .sort();
const expectedFindingCount = 51;
const allowedConfidence = new Set([
  "confirmed",
  "plausible",
  "decided-needed",
  "open",
  "observed",
  "proposal",
]);
const allowedDispositions = new Set(["open", "fixed", "wont-fix"]);
const errors: string[] = [];

if (noteNames.length !== 7) {
  errors.push(`expected 7 finding notes, found ${noteNames.length}`);
}

const headingIds: string[] = [];
for (const noteName of noteNames) {
  const source = await Bun.file(join(auditRoot, noteName)).text();
  for (const match of source.matchAll(/^### (\d{2}\.\d+) — /gm)) {
    headingIds.push(match[1]);
  }
}

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
for (const duplicate of duplicates(headingIds)) {
  errors.push(`duplicate finding heading ${duplicate}`);
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
  if (!allowedDispositions.has(disposition)) {
    errors.push(`${id} has invalid disposition ${disposition}`);
  }
  const issueNumber = Number(owner.replace(/^SET-/, ""));
  if (!/^SET-\d+$/.test(owner) || issueNumber < 313 || issueNumber > 351) {
    errors.push(`${id} has invalid owner ${owner}`);
  }
  if (disposition === "fixed" && (!proof || proof === "—")) {
    errors.push(`${id} is fixed without merged proof`);
  }
  if (disposition === "wont-fix" && !notes) {
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
