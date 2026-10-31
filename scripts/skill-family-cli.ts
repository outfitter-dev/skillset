import { CLI_COMMANDS, CLI_FLAGS, type CliFlagContract } from "./cli-contract";
import type { CliSurfaceViolation } from "./cli-surface-guard";
import { readMarkdownCodeSpans } from "./public-closure/markdown-code";
import { readCommandToken } from "./public-closure/shell-tokens";

interface Vocabulary {
  readonly commands: readonly string[];
  readonly flags: Readonly<Record<string, CliFlagContract>>;
}

export function isSkillFamilyMarkdown(file: string): boolean {
  return file.endsWith(".md") && (
    file.startsWith(".skillset/plugins/skillset/") ||
    /^\.skillset\/skills\/skillset(?:-dev(?:-compiler|-schema|-testing)?|-fix|-adrs)?\//u.test(file)
  );
}

/** Checks literal invocation vocabulary, never executes examples or infers semantics. */
export function scanSkillFamilyCli(
  file: string,
  content: string,
  vocabulary: Vocabulary = { commands: CLI_COMMANDS, flags: CLI_FLAGS }
): readonly CliSurfaceViolation[] {
  if (!isSkillFamilyMarkdown(file)) return [];
  const violations: CliSurfaceViolation[] = [];
  let fence: { marker: string; shell: boolean } | undefined;
  let continued = "";
  let startLine = 0;
  const inspect = (text: string, line: number): void => {
    for (const message of invocationViolations(text, vocabulary)) {
      violations.push({ file, line, text: message });
    }
  };
  for (const [index, text] of content.split(/\r?\n/u).entries()) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(text);
    if (fence) {
      if (delimiter && delimiter[1]?.[0] === fence.marker[0] &&
          (delimiter[1]?.length ?? 0) >= fence.marker.length && !delimiter[2]?.trim()) {
        if (continued) inspect(continued, startLine);
        continued = "";
        fence = undefined;
      } else if (fence.shell) {
        if (!continued) startLine = index + 1;
        continued += text.replace(/\\$/u, " ");
        if (!text.endsWith("\\")) {
          inspect(continued, startLine);
          continued = "";
        }
      }
      continue;
    }
    if (delimiter && !(delimiter[1]?.[0] === "`" && delimiter[2]?.includes("`"))) {
      fence = { marker: delimiter[1]!, shell: /^(?:sh|shell|bash|zsh|console)$/u.test(delimiter[2]?.trim() ?? "") };
      continue;
    }
    for (const span of readMarkdownCodeSpans(text)) inspect(span.value, index + 1);
  }
  if (continued) inspect(continued, startLine);
  return violations;
}

function invocationViolations(text: string, vocabulary: Vocabulary): string[] {
  // Wrappers and dynamic shell remain reviewer-owned. Support the repo's direct Bun form.
  const prefix = /^\s*(?:\$ )?(?:[A-Z_][A-Z_0-9]*=[\w/-]+\s+)*(?:skillset|bun \.\/apps\/skillset\/src\/cli\.ts)(?=\s|$)/u.exec(text);
  if (!prefix) return [];
  let offset = prefix[0].length;
  const next = (): string | undefined => {
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
    // Usage alternatives, placeholders, comments, and shell operators are not argv.
    if (!text[offset] || /[#[<;|&()]/u.test(text[offset]!) || text.slice(offset).startsWith("\\|")) return undefined;
    const token = readCommandToken(text, offset);
    if (!token) return undefined;
    offset = token.end;
    return token.value;
  };
  const argumentStart = offset;
  const command = next();
  if (!command || /[$\\|]/u.test(command)) return [];
  if (command.startsWith("--")) {
    offset = argumentStart;
  } else {
    if (!/^[a-z][a-z0-9-]*$/u.test(command)) return [];
    if (!vocabulary.commands.includes(command)) return [`unknown CLI command: ${command}`];
  }
  const violations: string[] = [];
  for (let token = next(); token !== undefined; token = next()) {
    if (token === "--") break;
    const flag = /^(--[a-z][a-z0-9-]*)(?:=|$)/u.exec(token)?.[1];
    if (!flag) continue;
    const contract = vocabulary.flags[flag];
    if (!contract) {
      violations.push(`unknown CLI flag: ${flag}`);
    } else if (!token.includes("=") && contract.value !== "boolean") {
      // Consume values, including quoted strings that happen to begin with --.
      const saved = offset;
      const value = next();
      if (contract.value === "optional-value" && value?.startsWith("--")) offset = saved;
    }
  }
  return violations;
}
