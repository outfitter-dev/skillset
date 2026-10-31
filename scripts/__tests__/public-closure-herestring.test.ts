import { expect, test } from "bun:test";
import { scanGeneratedPublicContent } from "../public-closure-guard";
import { analyzeShellNesting } from "../public-closure/shell-nesting";

function rules(command: string, inline: boolean) {
  const content = inline ? `Run \`\`${command}\`\`.` : `\`\`\`bash\n${command}\n\`\`\``;
  return scanGeneratedPublicContent("plugins/skillset/skills/demo/SKILL.md", content, [], new Set(), undefined, "/repo").map((finding) => finding.rule);
}
for (const inline of [false, true]) {
  test(`literal interpreter here-strings are code (inline=${inline})`, () => {
    for (const command of [
      "bash <<< 'cat packages/core/input'",
      'bash <<< "cat packages/core/input"',
      "/bin/bash -s <<< 'cat packages/core/input'",
      "sh <<< 'cat packages/core/input'",
      "dash <<< 'cat packages/core/input'",
      'skillset check "$(bash <<< \'cat packages/core/input\')"',
    ]) expect(rules(command, inline), command).toEqual(["internal-package"]);
  });
  test(`ordinary data and public scripts remain clean (inline=${inline})`, () => {
    for (const command of [
      "cat <<< 'cat packages/core/input'", 'cat <<< "cat packages/core/input"',
      "bash <<< 'cat public/input'", "bash -c 'echo safe' <<< 'cat packages/core/input'",
      "bash public/script.sh <<< 'cat packages/core/input'", "skillset explain packages/core",
    ]) expect(rules(command, inline), command).toEqual([]);
    expect(rules('cat <<< "$(cat packages/core/input)"', inline)).toEqual(["internal-package"]);
  });
  test(`unsupported interpretation remains explicit (inline=${inline})`, () => {
    for (const command of [
      "python <<< 'print(1)'", "node <<< 'console.log(1)'", "zsh <<< 'echo safe'",
      'bash <<< "$payload"', "env -C public bash <<< 'cat input'",
      "bash --unknown <<< 'echo safe'", "bash <<< 'echo safe' < public/input",
    ]) expect(rules(command, inline), command).toContain("shell-analysis");
  });
}

test("decoded payloads preserve nested execution and UTF-8 source ranges", () => {
  const command = 'printf "😀"; bash <<< "echo \\$(cat packages/core/input)"';
  const analysis = analyzeShellNesting(command);
  const nested = analysis.nestedCommands.find((entry) => entry.command === "cat packages/core/input");
  expect(nested).toBeDefined();
  expect(nested!.source.start.offset).toBe(Buffer.byteLength(command.slice(0, command.indexOf("cat packages"))));
  expect(nested!.source.end.offset).toBe(Buffer.byteLength(command.slice(0, command.indexOf("input") + "input".length)));
  expect(rules(command, false)).toEqual(["internal-package"]);
});

test("literal quote decoding respects the outer consumer and inner shell", () => {
  for (const inline of [false, true]) {
    expect(rules('bash <<< \'echo "$(cat packages/core/input)"\'', inline)).toEqual(["internal-package"]);
    expect(rules('bash <<< "echo \\`cat packages/core/input\\`"', inline)).toEqual(["internal-package"]);
    expect(rules('cat <<< "echo \\$(cat packages/core/input)"', inline)).toEqual([]);
    expect(rules('bash <<< "printf \\"%s\\" public/input"', inline)).toEqual([]);
  }
  const command = 'printf "😀"; bash <<< "$payload"';
  const issue = analyzeShellNesting(command).syntaxIssues[0]!;
  expect(issue.kind).toBe("unsupported-herestring");
  expect(issue.source.start.offset).toBe(Buffer.byteLength(command.slice(0, command.indexOf("<<<"))));
  expect(issue.source.start.column).toBe(issue.source.start.offset);
});

test("unsupported explicit descriptor parsing stays visible", () => {
  expect(rules("bash 0<<< 'cat packages/core/input'", false)).toContain("shell-analysis");
});

test("quoted inner paths and dynamic outer substitutions retain their distinct evidence", () => {
  expect(rules('bash <<< "cat \\"packages/core/input\\""', false)).toEqual(["internal-package"]);
  expect(rules('bash -c true <<< "$(cat packages/core/input)"', false)).toEqual(["internal-package"]);
  expect(rules('bash <<< "$(cat packages/core/input)"', false)).toEqual(["internal-package", "shell-analysis"]);
  expect(rules("python <<< 'cat packages/core/input'", false)).toEqual(["shell-analysis"]);
  const command = 'bash <<< "printf 😀; echo \\$(cat packages/core/input)"';
  const nested = analyzeShellNesting(command).nestedCommands.find((entry) => entry.command === "cat packages/core/input")!;
  expect(nested.source.start.offset).toBe(Buffer.byteLength(command.slice(0, command.indexOf("cat packages"))));
});

test("parser recovery never turns an incomplete quoted payload into a literal program", () => {
  const analysis = analyzeShellNesting('bash <<< "cat public/input');
  expect(analysis.syntaxIssues.length).toBeGreaterThan(0);
  expect(analysis.nestedCommands).toEqual([]);
});
