import { describe, expect, test } from "bun:test";

import { CLI_ROUTE_FLAGS, HIDDEN_CLI_ROUTES } from "../cli-contract";
import { renderCliHelp } from "../cli-help";
import { CLI_PRESENTATION_CATALOG } from "../cli-presentation";
import { terminalColorEnabled } from "../terminal-renderer";

describe("SET-307 CLI presentation", () => {
  test("covers the canonical public route contract exactly once", () => {
    expect(
      CLI_PRESENTATION_CATALOG.map((entry) => entry.route)
        .toSorted()
        .join("\n")
    ).toBe(Object.keys(CLI_ROUTE_FLAGS).toSorted().join("\n"));
    expect(
      new Set(CLI_PRESENTATION_CATALOG.map((entry) => entry.route)).size
    ).toBe(CLI_PRESENTATION_CATALOG.length);
  });

  test("renders concise grouped root help", () => {
    const output = renderCliHelp(["--help"], { color: false, width: 80 });
    expect(output).toContain("Source-first compiler");
    expect(output).toContain("Author\n");
    expect(output).toContain("Build\n");
    expect(output).toContain("skillset <command> --help");
    expect(output).not.toContain("--claude-setting-sources");
    expect(output.split("\n").length).toBeLessThan(50);
  });

  test("selects focused route and command-family help", () => {
    const build = renderCliHelp(["build", "--help"], {
      color: false,
      width: 80,
    });
    expect(build).toContain("skillset build");
    expect(build).toContain("--updated");
    expect(build).not.toContain("skillset diff");

    const restore = renderCliHelp(["restore", "--help"], {
      color: false,
      width: 80,
    });
    expect(restore).toContain("skillset restore <backup-id>");
    expect(restore).toContain("skillset restore --list");
    expect(restore).toContain("List integrity-checked generated-output backups");

    const change = renderCliHelp(["change", "--help"], {
      color: false,
      width: 80,
    });
    expect(change).toContain("skillset change <command>");
    expect(change).toContain("add      Add a pending source change.");
    expect(change).not.toContain("test worker");
  });

  test("does not treat option or positional values as help route words", () => {
    for (const args of [
      ["build", "--root", "nested", "--help"],
      ["build", "--root=nested", "--help"],
      ["build", "workspace-input", "--help"],
    ]) {
      const output = renderCliHelp(args, { color: false, width: 80 });
      expect(output).toContain("Usage\n  skillset build [--yes]");
      expect(output).toContain("--updated");
      expect(output).not.toContain("skillset build <command>");
    }

    const change = renderCliHelp(
      ["change", "add", "--root", "nested", "--help"],
      { color: false, width: 80 }
    );
    expect(change).toContain("skillset change add");
    expect(change).toContain("--bump");
    expect(change).not.toContain("skillset change <command>");
  });

  test("renders every public route and flag in exhaustive help", () => {
    const output = renderCliHelp(["--help", "--all"], {
      color: false,
      width: 100,
    });
    for (const entry of CLI_PRESENTATION_CATALOG) {
      expect(output, entry.route).toContain(`skillset ${entry.route}`);
      for (const flag of entry.flags)
        expect(output, `${entry.route} ${flag}`).toContain(flag);
    }
    for (const hidden of Object.keys(HIDDEN_CLI_ROUTES))
      expect(output).not.toContain(hidden);
  });

  test("wraps narrow output and disables ANSI when requested", () => {
    for (const args of [["--help"], ["build", "--help"], ["--help", "--all"]]) {
      const output = renderCliHelp(args, { color: false, width: 40 });
      expect(Bun.stripANSI(output)).toBe(output);
      for (const line of output.split("\n"))
        expect(Bun.stringWidth(line)).toBeLessThanOrEqual(40);
    }
    expect(
      Bun.stripANSI(renderCliHelp(["--help"], { color: true, width: 80 }))
    ).not.toBe(renderCliHelp(["--help"], { color: true, width: 80 }));
  });

  test("honors TTY, NO_COLOR, and dumb-terminal color policy", () => {
    expect(terminalColorEnabled({ isTTY: true, term: "xterm-256color" })).toBe(
      true
    );
    expect(
      terminalColorEnabled({ isTTY: true, noColor: "", term: "xterm-256color" })
    ).toBe(false);
    expect(terminalColorEnabled({ isTTY: true, term: "dumb" })).toBe(false);
    expect(terminalColorEnabled({ isTTY: false, term: "xterm-256color" })).toBe(
      false
    );
  });
});
