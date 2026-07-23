import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSkillset } from "@skillset/core";

const EXPECT = "/usr/bin/expect";
const CLI = path.join(import.meta.dir, "..", "cli.ts");
const GENERATED_PATH = ".claude/skills/demo/SKILL.md";
const SOURCE_PATH = ".skillset/skills/demo/SKILL.md";

test.skipIf(!existsSync(EXPECT))(
  "SET-295: controlled PTY decline and cancellation preserve bytes before a confirmed output write",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-reconcile-pty-"));
    const xdgRoot = await mkdtemp(
      path.join(tmpdir(), "skillset-reconcile-pty-xdg-")
    );
    try {
      await Bun.write(
        path.join(root, "skillset.yaml"),
        "skillset:\n  name: reconcile-pty\nclaude: true\ncodex: false\ncursor: false\n"
      );
      await Bun.write(
        path.join(root, SOURCE_PATH),
        "---\nname: demo\ndescription: Demo.\n---\n\nOriginal source body.\n"
      );
      await buildSkillset(root);
      const generatedAbsolute = path.join(root, GENERATED_PATH);
      const sourceAbsolute = path.join(root, SOURCE_PATH);
      const editedGenerated = (
        await readFile(generatedAbsolute, "utf8")
      ).replace("Original source body.", "Edited generated body.");
      await writeFile(generatedAbsolute, editedGenerated, "utf8");
      const sourceBefore = await readFile(sourceAbsolute);
      const generatedBefore = await readFile(generatedAbsolute);

      const declined = await runExpect(root, xdgRoot, [
        'expect "Resolution:"',
        'send -- "\\r"',
        'expect "Proceed?"',
        'send -- "\\r"',
        "expect eof",
      ]);
      expect(declined.exitCode).toBe(0);
      expect(declined.stdout).toContain(
        `skillset: reconcile ${GENERATED_PATH}`
      );
      const sourcePreview =
        "skillset: preview only; rerun with --use source --yes to apply";
      expect(declined.stdout).toContain(sourcePreview);
      expect(declined.stdout.indexOf(sourcePreview)).toBeLessThan(
        declined.stdout.indexOf("Proceed?")
      );
      expect(await readFile(sourceAbsolute)).toEqual(sourceBefore);
      expect(await readFile(generatedAbsolute)).toEqual(generatedBefore);

      const cancelled = await runExpect(root, xdgRoot, [
        'expect "Resolution:"',
        'send -- "\\003"',
        "expect eof",
      ]);
      expect(cancelled.exitCode).toBe(130);
      expect(await readFile(sourceAbsolute)).toEqual(sourceBefore);
      expect(await readFile(generatedAbsolute)).toEqual(generatedBefore);

      const confirmed = await runExpect(
        root,
        xdgRoot,
        [
          'expect "Proceed?"',
          'send -- "y\\r"',
          "expect eof",
        ],
        "--use output"
      );
      expect(confirmed.exitCode).toBe(0);
      const outputPreview =
        "skillset: preview only; rerun with --use output --yes to apply";
      expect(confirmed.stdout).toContain(outputPreview);
      expect(confirmed.stdout.indexOf(outputPreview)).toBeLessThan(
        confirmed.stdout.indexOf("Proceed?")
      );
      expect(confirmed.stdout).toContain("skillset: reconciled using output");
      expect(await readFile(sourceAbsolute, "utf8")).toContain(
        "Edited generated body."
      );
      expect(await readFile(generatedAbsolute, "utf8")).toContain(
        "Edited generated body."
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(xdgRoot, { force: true, recursive: true });
    }
  },
  30_000
);

async function runExpect(
  root: string,
  xdgRoot: string,
  interactions: readonly string[],
  reconcileArguments = ""
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const script = [
    "set timeout 15",
    `spawn -noecho /bin/sh -c "stty columns 80 rows 24; exec env CI=false NO_COLOR=1 TERM=xterm XDG_CONFIG_HOME=$env(XDG_ROOT) bun $env(SKILLSET_CLI) reconcile $env(GENERATED_PATH) ${reconcileArguments} --root $env(WORKSPACE_ROOT)"`,
    ...interactions,
    "catch wait result",
    "exit [lindex $result 3]",
  ].join("\n");
  const proc = Bun.spawn([EXPECT, "-c", script], {
    env: {
      ...process.env,
      GENERATED_PATH,
      SKILLSET_CLI: CLI,
      WORKSPACE_ROOT: root,
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
}
