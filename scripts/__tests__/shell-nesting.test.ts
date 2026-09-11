import { describe, expect, test } from "bun:test";

import {
  analyzeShellNesting,
  readShellStatements,
} from "../public-closure/shell-nesting";

describe("SET-517 native shell nesting adapter", () => {
  test("loads the native Bash grammar and classifies executed substitutions", () => {
    const analysis = analyzeShellNesting(
      'skillset check "$(cat packages/core)" <(cat public) >(tee public/out)'
    );

    expect(analysis.dialectSupport).toBe("bash");
    expect(analysis.syntaxIssues).toEqual([]);
    expect(
      analysis.nestedCommands.map(({ command, kind }) => ({
        command: command.trim(),
        kind,
      }))
    ).toEqual([
      { command: "cat packages/core", kind: "command" },
      { command: "cat public", kind: "process-input" },
      { command: "tee public/out", kind: "process-output" },
    ]);
    expect(analysis.directCommand).not.toContain("packages/core");
  });

  test("reports UTF-8 byte positions and masks descendants from parent bodies", () => {
    const source = 'echo 😀 "$(echo "$(cat packages/core)")"';
    const analysis = analyzeShellNesting(source);
    const [outer, inner] = analysis.nestedCommands;

    expect(outer?.command).not.toContain("cat packages/core");
    expect(inner?.command.trim()).toBe("cat packages/core");
    expect(inner?.source.start.offset).toBe(
      Buffer.from(source.slice(0, source.indexOf("cat packages/core"))).length
    );
    expect(inner?.source.start).toMatchObject({ column: 21, row: 0 });
  });

  test("does not treat substitutions in shell comments as execution", () => {
    const analysis = analyzeShellNesting(
      "skillset check # $(cat packages/core/input)"
    );

    expect(analysis.nestedCommands).toEqual([]);
    expect(analysis.syntaxIssues).toEqual([]);
  });

  test("keeps standalone comments and same-line trailing comments in statements", () => {
    const standalone = readShellStatements("# see packages/core\nls public");
    const trailing = readShellStatements("ls public # packages/core");
    const afterUnicode = readShellStatements(
      "echo 😀\nls public # packages/core"
    );

    expect(standalone.map(({ command }) => command)).toEqual([
      "# see packages/core",
      "ls public",
    ]);
    expect(trailing.map(({ command }) => command)).toEqual([
      "ls public # packages/core",
    ]);
    expect(afterUnicode[1]).toEqual({
      command: "ls public # packages/core",
      source: {
        end: { column: 25, offset: 35, row: 1 },
        start: { column: 0, offset: 10, row: 1 },
      },
    });
  });

  test("recovers escaped nested legacy substitutions with original positions", () => {
    const source = "skillset check `echo \\`cat packages/core/input\\``";
    const analysis = analyzeShellNesting(source);
    const nested = analysis.nestedCommands[1];

    expect(analysis.nestedCommands.map(({ kind }) => kind)).toEqual([
      "legacy-command",
      "legacy-command",
    ]);
    expect(nested?.command).toBe("cat packages/core/input");
    expect(nested?.source.start.offset).toBe(source.indexOf("cat"));
    expect(nested?.source.start).toMatchObject({
      column: source.indexOf("cat"),
      row: 0,
    });
  });

  test("classifies interpreter-fed heredocs through shell wrappers", () => {
    const commands = [
      "env MODE=test /usr/bin/python3 <<'EOF'\nopen(\"packages/core/input\")\nEOF",
      "/usr/bin/env bash <<'EOF'\ncat packages/core/input\nEOF",
      "/usr/bin/env python3 <<'EOF'\nopen(\"packages/core/input\")\nEOF",
      "/usr/bin/sudo bash <<'EOF'\ncat packages/core/input\nEOF",
      "/usr/bin/timeout 5 bash <<'EOF'\ncat packages/core/input\nEOF",
      "env -S bash <<'EOF'\ncat packages/core/input\nEOF",
      "env -S 'bash -e' <<'EOF'\ncat packages/core/input\nEOF",
      "/usr/bin/env -S 'bash -e' <<'EOF'\ncat packages/core/input\nEOF",
      "true && bash <<'EOF'\ncat packages/core/input\nEOF",
      "printf ready | bash <<'EOF'\ncat packages/core/input\nEOF",
      "timeout 5 bash <<'EOF'\ncat packages/core/input\nEOF",
      "cat <<'EOF' | bash\ncat packages/core/input\nEOF",
      "cat <<'EOF' | /usr/bin/env bash\ncat packages/core/input\nEOF",
    ];

    for (const command of commands) {
      const analysis = analyzeShellNesting(command);

      expect(analysis.nestedCommands).toHaveLength(1);
      expect(analysis.nestedCommands[0]?.command).toContain(
        "packages/core/input"
      );
    }

    for (const command of [
      "bash | cat <<'EOF'\ncat packages/core/input\nEOF",
      "timeout 5 cat <<'EOF'\ncat packages/core/input\nEOF",
      "/usr/bin/env cat <<'EOF'\ncat packages/core/input\nEOF",
      "/usr/bin/sudo cat <<'EOF'\ncat packages/core/input\nEOF",
      "/usr/bin/timeout 5 cat <<'EOF'\ncat packages/core/input\nEOF",
      "env -S cat <<'EOF'\ncat packages/core/input\nEOF",
      "env -S 'cat -n' <<'EOF'\ncat packages/core/input\nEOF",
    ]) {
      expect(analyzeShellNesting(command).nestedCommands).toEqual([]);
    }
  });

  test("classifies heredocs consumed through process substitutions", () => {
    for (const command of [
      "bash <(cat <<'EOF'\ncat packages/core/input\nEOF\n)",
      "source <(cat <<'EOF'\ncat packages/core/input\nEOF\n)",
      "tee >(bash) <<'EOF'\ncat packages/core/input\nEOF",
      "tee >(python3) <<'EOF'\nopen('packages/core/input')\nEOF",
      "cat <<'EOF' | tee >(bash)\ncat packages/core/input\nEOF",
    ]) {
      const analysis = analyzeShellNesting(command);

      expect(analysis.nestedCommands).toHaveLength(2);
      expect(analysis.nestedCommands.at(-1)?.command).toContain(
        "packages/core/input"
      );
    }

    for (const command of [
      "cat <(cat <<'EOF'\ncat packages/core/input\nEOF\n)",
      "tee >(cat) <<'EOF'\ncat packages/core/input\nEOF",
      "cat <<'EOF' | tee >(cat)\ncat packages/core/input\nEOF",
    ]) {
      const analysis = analyzeShellNesting(command);

      expect(analysis.nestedCommands).toHaveLength(1);
      expect(analysis.nestedCommands[0]?.command).not.toContain(
        "packages/core/input"
      );
    }
  });

  test("recovers substitutions hidden in parameter-removal patterns", () => {
    for (const operator of ["#", "##", "%", "%%"]) {
      const analysis = analyzeShellNesting(
        `skillset check \${value${operator}$(cat packages/core/input)}`
      );

      expect(
        analysis.nestedCommands.map(({ command }) => command.trim())
      ).toEqual(["cat packages/core/input"]);
      expect(analysis.syntaxIssues).toEqual([]);
    }

    expect(
      analyzeShellNesting(
        "skillset check ${value#'$(cat packages/core/input)'}"
      ).nestedCommands
    ).toEqual([]);

    const unicodeSource =
      "echo 😀; skillset check ${value#$(cat packages/core/input)}";
    const [nested] = analyzeShellNesting(unicodeSource).nestedCommands;
    expect(nested?.source.start.offset).toBe(
      Buffer.byteLength(unicodeSource.slice(0, unicodeSource.indexOf("cat")))
    );
  });

  test("remaps heredoc legacy syntax issues after Unicode", () => {
    const source = "echo 😀; cat <<EOF\n`cat packages/core/input\nEOF";
    const analysis = analyzeShellNesting(source);
    const [issue] = analysis.syntaxIssues;

    expect(issue?.kind).toBe("missing-syntax");
    expect(issue?.source.start).toMatchObject({ column: 0, row: 2 });
    expect(issue?.source.start.offset).toBe(
      Buffer.byteLength(source.slice(0, source.lastIndexOf("EOF")), "utf8")
    );
  });

  test("retains recovered bodies and reports parse errors with positions", () => {
    const analysis = analyzeShellNesting(
      'skillset check "$(echo ${value//)/}; cat packages/core/input)"'
    );

    expect(analysis.nestedCommands).toHaveLength(1);
    expect(analysis.nestedCommands[0]?.command).toContain(
      "cat packages/core/input"
    );
    expect(analysis.syntaxIssues).toEqual([
      {
        kind: "parse-error",
        message: "Tree-sitter recovered from unrecognized nested shell syntax",
        source: {
          end: { column: 35, offset: 35, row: 0 },
          start: { column: 23, offset: 23, row: 0 },
        },
      },
    ]);
  });

  test("reports missing syntax and unclosed substitutions instead of clean", () => {
    const missing = analyzeShellNesting(
      'skillset check "$(cat packages/core |)"'
    );
    const unclosed = analyzeShellNesting(
      'skillset check "$(cat packages/core/input"'
    );

    expect(missing.syntaxIssues.map(({ kind }) => kind)).toContain(
      "missing-syntax"
    );
    expect(unclosed.nestedCommands).toEqual([]);
    expect(unclosed.syntaxIssues.map(({ kind }) => kind)).toContain(
      "parse-error"
    );
  });

  test("states the supported dialect boundary", () => {
    const bash = analyzeShellNesting("echo $(cat public)", "bash");
    const generic = analyzeShellNesting("echo $(cat public)", "shell");
    const sh = analyzeShellNesting("echo <(cat public)", "sh");
    const zsh = analyzeShellNesting("echo $(cat public)", "zsh");

    expect(bash.dialectSupport).toBe("bash");
    expect(generic.dialectSupport).toBe("generic-bash");
    expect(sh.dialectSupport).toBe("posix-subset");
    expect(sh.syntaxIssues.map(({ kind }) => kind)).toContain(
      "unsupported-dialect"
    );
    expect(zsh.dialectSupport).toBe("unsupported-zsh");
    expect(zsh.syntaxIssues.map(({ kind }) => kind)).toContain(
      "unsupported-dialect"
    );
  });
});
