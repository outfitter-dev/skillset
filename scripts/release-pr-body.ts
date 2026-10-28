import { Parser } from "commonmark";

import { RELEASE_PACKAGE_SPECS } from "./release-packages";

const packageNames = new Set(RELEASE_PACKAGE_SPECS.map((spec) => spec.name));

const releaseHeadings = (body: string) => {
  const lines = body.split("\n");
  let offset = 0;
  const offsets = lines.map((line) => {
    const start = offset;
    offset += line.length + 1;
    return start;
  });

  const headings: {
    level: number;
    start: number;
    contentStart: number;
    text: string;
  }[] = [];
  const document = new Parser().parse(body);
  for (let node = document.firstChild; node; node = node.next) {
    if (node.type !== "heading" || node.level > 2) {
      continue;
    }
    const [start, end] = node.sourcepos;
    headings.push({
      contentStart: offsets[end[0]] ?? body.length,
      level: node.level,
      start: offsets[start[0] - 1] ?? body.length,
      text: lines[start[0] - 1]?.trim() ?? "",
    });
  }
  return headings;
};

export const compactReleasePrBody = (body: string): string => {
  // Changesets can omit notes to fit GitHub's body limit. Those are not empty releases.
  if (body.includes("omitted from this message")) {
    return body;
  }

  const headings = releaseHeadings(body);
  const releasesIndex = headings.findIndex(
    (heading) => heading.text === "# Releases"
  );
  if (releasesIndex === -1) {
    return body;
  }
  const releases = headings.slice(releasesIndex + 1);
  const endIndex = releases.findIndex((heading) => heading.level === 1);
  const sections = endIndex === -1 ? releases : releases.slice(0, endIndex);
  const end = releases[endIndex]?.start ?? body.length;
  const emptySections: { start: number; end: number; label: string }[] = [];

  for (const [index, section] of sections.entries()) {
    const match =
      /^## (?<name>.+)@(?<version>\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)$/u.exec(
        section.text
      );
    const name = match?.groups?.name;
    const version = match?.groups?.version;
    if (!name || !version || !packageNames.has(name)) {
      continue;
    }
    const sectionEnd = sections[index + 1]?.start ?? end;
    if (body.slice(section.contentStart, sectionEnd).trim()) {
      continue;
    }
    emptySections.push({
      end: sectionEnd,
      label: `${name}@${version}`,
      start: section.start,
    });
  }
  if (emptySections.length === 0) {
    return body;
  }

  let compacted = "";
  let cursor = 0;
  for (const section of emptySections) {
    compacted += body.slice(cursor, section.start);
    cursor = section.end;
  }
  compacted += body.slice(cursor, end);
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const details = [
    "<details>",
    "<summary><h2>Version-aligned packages</h2></summary>",
    "",
    "No package-specific release notes. These packages are versioned together with the release.",
    "",
    ...emptySections.map((section) => `- \`${section.label}\``),
    "",
    "</details>",
  ].join(newline);
  return `${compacted.trimEnd()}${newline}${newline}${details}${newline}${newline}${body.slice(end)}`;
};

if (import.meta.main) {
  const [path] = process.argv.slice(2);
  if (!path) {
    throw new Error("Usage: bun scripts/release-pr-body.ts <body-file>");
  }
  process.stdout.write(compactReleasePrBody(await Bun.file(path).text()));
}
