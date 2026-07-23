import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const EXPECT = "/usr/bin/expect";
const CLI = path.join(import.meta.dir, "..", "cli.ts");

test.skipIf(!existsSync(EXPECT))(
  "SET-296: a controlled PTY drives lookup search once at width 80",
  async () => {
    const result = await runExpect(
      [
        'expect "Look up:"',
        'send -- "workspace\\r"',
        'expect "Show:"',
        'send -- "\\r"',
        'expect "Field:"',
        'send -- "compile.targets\\r"',
        "expect eof",
      ],
      80
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("skillset lookup workspace");
    expect(result.stdout).toContain("compile.targets: array<enum>");
    expect(result.stdout).toContain("skillset: lookup complete");
    expect(result.stdout.match(/skillset lookup workspace/gu)).toHaveLength(1);
  },
  30_000
);

test.skipIf(!existsSync(EXPECT))(
  "SET-296: route-level Ctrl-C exits 130 in a narrow controlled PTY",
  async () => {
    const result = await runExpect(
      ['expect "Look up:"', 'send -- "\\003"', "expect eof"],
      40
    );

    expect(result.exitCode).toBe(130);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("skillset: interactive prompt cancelled");
    expect(result.stdout).not.toContain("skillset lookup ");
  },
  30_000
);

test.skipIf(!existsSync(EXPECT))(
  "SET-296: an unknown field reaches the canonical diagnostic without an empty picker",
  async () => {
    const result = await runExpect(
      ['expect "Look up:"', 'send -- "\\r"', "expect eof"],
      80,
      "--field does.not.exist"
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("lookup/field/not-found");
    expect(result.stdout).toContain(
      "skill-frontmatter does not define field does.not.exist"
    );
    expect(result.stdout).toContain("skillset: lookup reported diagnostics");
  },
  30_000
);

async function runExpect(
  interactions: readonly string[],
  columns: number,
  lookupArguments = ""
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const xdgRoot = await mkdtemp(path.join(tmpdir(), "skillset-lookup-pty-"));
  try {
    const script = [
      "set timeout 15",
      `spawn -noecho /bin/sh -c "stty columns ${columns} rows 24; exec env CI=false NO_COLOR=1 TERM=xterm XDG_CONFIG_HOME=$env(XDG_ROOT) bun $env(SKILLSET_CLI) lookup ${lookupArguments}"`,
      ...interactions,
      "catch wait result",
      "exit [lindex $result 3]",
    ].join("\n");
    const proc = Bun.spawn([EXPECT, "-c", script], {
      env: {
        ...process.env,
        SKILLSET_CLI: CLI,
        XDG_ROOT: xdgRoot,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    await rm(xdgRoot, { force: true, recursive: true });
  }
}
