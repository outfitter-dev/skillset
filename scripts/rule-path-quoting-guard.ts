import { join, resolve } from "node:path";

import { gitSafeEnv } from "@skillset/core/internal/git-env";

export interface RulePathQuotingViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "shell",
  "console",
  "fish",
  "powershell",
  "pwsh",
]);
const COMMAND =
  /^(?:\$\s+)?(?:echo|printf|cat|mkdir|cd|ls|cp|mv|rm|git|skillset|bun|Get-Content|Get-Item|Get-ChildItem|Remove-Item|Copy-Item|Move-Item|New-Item)\b/iu;
const WILDCARD_CMDLET =
  /\b(?:Get-Content|Get-Item|Get-ChildItem|Remove-Item|Copy-Item|Move-Item|Set-Content|Add-Content|Test-Path)\b/iu;

/** Find a substitution boundary without treating quoted parentheses as syntax. */
function substitutionEnd(text: string, start: number): number | undefined {
  let depth = 1;
  let quote = "";
  for (let index = start; index < text.length; index++) {
    const character = text[index]!;
    if (character === "\\" && quote !== "'") {
      index++;
      continue;
    }
    if (quote !== "") {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '\"') {
      quote = character;
      continue;
    }
    if (character === "(") depth++;
    if (character === ")" && --depth === 0) return index;
  }
  return undefined;
}

/** Checks literal path examples, preserving quotes that normalized argv would erase. */
function unsafePaths(command: string, powershell: boolean): string[] {
  const violations: string[] = [];
  let value = "";
  let quote = "";
  let unprotected = false;
  let arrayDepth = 0;

  let wildcardCmdlet = false;
  let literalPathNext = false;
  let commandName: string | undefined;
  const flush = () => {
    if (value === "") return;
    commandName ??= value;
    if (WILDCARD_CMDLET.test(value)) wildcardCmdlet = true;
    const barePathOperand =
      /^(?:cat|mkdir|cd|ls|cp|mv|rm|Get-Content|Get-Item|Get-ChildItem|Remove-Item|Copy-Item|Move-Item|New-Item)$/iu.test(
        commandName
      ) && !value.startsWith("-");
    if ((/[\/\\]/u.test(value) || barePathOperand) && /[\[\]()]/u.test(value)) {
      if (quote !== "" || unprotected)
        violations.push(`Quote the literal shell path: ${value}`);
      else if (
        powershell &&
        /[\[\]]/u.test(value) &&
        wildcardCmdlet &&
        !literalPathNext
      ) {
        violations.push(
          `Use -LiteralPath for the bracketed PowerShell path: ${value}`
        );
      }
    }
    literalPathNext = /^-LiteralPath$/iu.test(value);
    value = "";
    unprotected = false;
  };
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!;
    if (
      !powershell &&
      quote !== "'" &&
      character === "$" &&
      command[index + 1] === "("
    ) {
      const end = substitutionEnd(command, index + 2);
      const nested = command.slice(index + 2, end);
      violations.push(...unsafePaths(nested, false));
      if (end === undefined) return violations;
      value += "$substitution";
      index = end;
      continue;
    }
    if (quote !== "") {
      if (character === quote) quote = "";
      else if (character === (powershell ? "`" : "\\") && quote === '"')
        value += command[++index] ?? "";
      else value += character;
      continue;
    }
    if (character === "(" && /^[A-Za-z_][A-Za-z0-9_]*=$/u.test(value)) {
      value = "";
      arrayDepth++;
      continue;
    }
    if (character === ")" && arrayDepth > 0 && !value.includes("(")) {
      flush();
      arrayDepth--;
      continue;
    }
    if (character === "#" && value === "") break;
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === (powershell ? "`" : "\\")) {
      value += command[++index] ?? "";
      continue;
    }
    if (/\s|[;|&<>]/u.test(character)) {
      flush();
      if (/[;|&]/u.test(character)) {
        wildcardCmdlet = false;
        literalPathNext = false;
        commandName = undefined;
      }
      continue;
    }
    value += character;
    if (/[\[\]()]/u.test(character)) unprotected = true;
  }
  flush();
  return violations;
}

export function scanRulePathQuoting(
  file: string,
  content: string
): RulePathQuotingViolation[] {
  const violations: RulePathQuotingViolation[] = [];
  let fence: { marker: string; language: string } | undefined;
  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})(\w*)/u.exec(line);
    if (marker !== null) {
      if (fence === undefined)
        fence = { marker: marker[1]!, language: marker[2]!.toLowerCase() };
      else if (
        marker[1]![0] === fence.marker[0] &&
        marker[1]!.length >= fence.marker.length
      )
        fence = undefined;
      continue;
    }
    const snippets =
      fence === undefined
        ? [...line.matchAll(/`([^`]+)`/gu)]
            .map((match) => match[1]!)
            .filter((text) => COMMAND.test(text.trim()))
        : SHELLS.has(fence.language)
          ? [line]
          : [];
    for (const snippet of snippets) {
      for (const text of unsafePaths(
        snippet.replace(/^\s*\$\s+/u, ""),
        fence?.language === "powershell" || fence?.language === "pwsh"
      )) {
        violations.push({ file, line: index + 1, text });
      }
    }
  }
  return violations;
}

/** Generated copies and release records are checked at their authored owner. */
export function isRulePathDocumentation(path: string): boolean {
  return (
    path !== "AGENTS.md" &&
    path.endsWith(".md") &&
    !/^(?:\.agents|\.claude|\.cursor|plugins|\.changeset|\.skillset\/changes|node_modules)\//u.test(
      path
    )
  );
}

export async function collectRulePathQuotingViolations(
  root: string
): Promise<RulePathQuotingViolation[]> {
  const process = Bun.spawn(["git", "-C", root, "ls-files", "-z"], {
    env: gitSafeEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (status !== 0) throw new Error(stderr);
  const result: RulePathQuotingViolation[] = [];
  for (const path of stdout.split("\0").filter(isRulePathDocumentation)) {
    const file = Bun.file(join(root, path));
    if (await file.exists())
      result.push(...scanRulePathQuoting(path, await file.text()));
  }
  return result;
}

if (import.meta.main) {
  const violations = await collectRulePathQuotingViolations(
    resolve(import.meta.dir, "..")
  );
  for (const item of violations)
    console.error(`${item.file}:${item.line}: ${item.text}`);
  if (violations.length > 0) process.exitCode = 1;
  else console.log("skillset: documented literal shell paths are quoted");
}
