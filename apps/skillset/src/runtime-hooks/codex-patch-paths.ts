/**
 * Read local apply_patch paths without executing or applying its payload.
 * Grammar evidence: OpenAI codex-rs/apply-patch/src/{parser,streaming_parser}.rs,
 * reviewed 2026-10-31. Unknown syntax and remote environment patches are undecided.
 */
export function codexPatchPaths(command: string): readonly string[] | undefined {
  let lines = command.trim().split(/\r?\n/u);
  if (/^<<(?:"EOF"|'EOF'|EOF)$/u.test(lines[0] ?? "") && lines.at(-1) === "EOF") {
    lines = lines.slice(1, -1);
  }
  if (lines[0]?.trim() !== "*** Begin Patch" || lines.at(-1)?.trim() !== "*** End Patch") return undefined;
  const paths: string[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    const header = /^(\*\*\* (?:Add|Delete|Update) File): (.+)$/u.exec(lines[index]?.trim() ?? "");
    if (header === null) return undefined;
    const path = header[2]!;
    if (!validPath(path)) return undefined;
    paths.push(path);
    index++;
    if (header[1] === "*** Delete File") continue;
    if (header[1] === "*** Add File") {
      while (index < lines.length - 1 && lines[index]!.startsWith("+")) index++;
      continue;
    }
    if (lines[index]?.trimEnd().startsWith("*** Move to: ")) {
      const destination = lines[index]!.trimEnd().slice("*** Move to: ".length);
      if (!validPath(destination)) return undefined;
      paths.push(destination);
      index++;
    }
    let chunkLines = 0;
    let hasChunk = false;
    let ended = false;
    while (index < lines.length - 1) {
      const line = lines[index]!.trimEnd();
      // Prefixes distinguish content that resembles a header from actual operations.
      if (line.startsWith("*** ") && line !== "*** End of File") break;
      if (ended && line === "") {
        index++;
        continue;
      }
      if (ended && line !== "@@" && !line.startsWith("@@ ")) return undefined;
      if (line === "@@" || line.startsWith("@@ ")) {
        ended = false;
        if (hasChunk && chunkLines === 0) return undefined;
        hasChunk = true;
        chunkLines = 0;
      } else if (line === "*** End of File") {
        if (chunkLines === 0) return undefined;
        ended = true;
      } else if (line === "" || /^[ +\-]/u.test(line)) {
        hasChunk = true;
        chunkLines++;
      } else {
        return undefined;
      }
      index++;
    }
    if (!hasChunk || chunkLines === 0) return undefined;
  }
  return [...new Set(paths)];
}

function validPath(path: string): boolean {
  // URI paths can name remote filesystems; do not reinterpret them as local paths.
  return path.length > 0 && !path.includes("\0") && !/^[a-z][a-z\d+.-]*:\/\//iu.test(path);
}
