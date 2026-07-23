import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildSkillsetResult, checkMarketplaces } from "@skillset/core";

const EXPECT = "/usr/bin/expect";
const CLI = path.join(import.meta.dir, "..", "cli.ts");
const MARKETPLACE_PATH = ".claude-plugin/marketplace.json";

test.skipIf(!existsSync(EXPECT))(
  "SET-297: controlled PTY decline and cancellation preserve bytes before a confirmed marketplace transaction",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skillset-marketplace-pty-"));
    const xdgRoot = await mkdtemp(
      path.join(tmpdir(), "skillset-marketplace-pty-xdg-")
    );
    try {
      await Bun.write(
        path.join(root, "skillset.yaml"),
        [
          "skillset:",
          "  name: marketplace-pty",
          "compile:",
          "  targets: [claude]",
          "marketplaces:",
          "  local:",
          "    targets: [claude]",
          "    plugins:",
          "      - plugin: demo",
          "",
        ].join("\n")
      );
      await Bun.write(
        path.join(root, ".skillset/plugins/demo/skillset.yaml"),
        "skillset:\n  name: demo\n"
      );
      await Bun.write(
        path.join(root, ".skillset/plugins/demo/skills/demo/SKILL.md"),
        "---\nname: demo\ndescription: Demo.\n---\n\nDemo body.\n"
      );
      const built = await buildSkillsetResult(root, {
        xdg: {
          env: { XDG_CONFIG_HOME: xdgRoot },
          homeDir: xdgRoot,
        },
      });
      expect(built.ok).toBe(true);
      const marketplaceAbsolute = path.join(root, MARKETPLACE_PATH);
      const lockAbsolute = path.join(root, "skillset.lock");
      const marketplaceBefore = await readFile(marketplaceAbsolute);
      const lockBefore = await readFile(lockAbsolute);

      const declined = await runExpect(root, xdgRoot, [
        'expect "Proceed?"',
        'send -- "\\r"',
        "expect eof",
      ]);
      expect(declined.exitCode).toBe(0);
      expect(declined.stdout).toContain(
        `would write: ${MARKETPLACE_PATH} (local claude)`
      );
      expect(await readFile(marketplaceAbsolute)).toEqual(marketplaceBefore);
      expect(await readFile(lockAbsolute)).toEqual(lockBefore);

      const cancelled = await runExpect(root, xdgRoot, [
        'expect "Proceed?"',
        'send -- "\\003"',
        "expect eof",
      ]);
      expect(cancelled.exitCode).toBe(130);
      expect(await readFile(marketplaceAbsolute)).toEqual(marketplaceBefore);
      expect(await readFile(lockAbsolute)).toEqual(lockBefore);

      const confirmed = await runExpect(root, xdgRoot, [
        'expect "Proceed?"',
        'send -- "y\\r"',
        "expect eof",
      ]);
      expect(confirmed.exitCode).toBe(0);
      expect(confirmed.stdout).toContain(
        `wrote: ${MARKETPLACE_PATH} (local claude)`
      );
      expect(confirmed.stdout).toContain("wrote: skillset.lock");
      expect(
        await checkMarketplaces(root, {
          name: "local",
          xdg: {
            env: { XDG_CONFIG_HOME: xdgRoot },
            homeDir: xdgRoot,
          },
        })
      ).toMatchObject({ ok: true });
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
  interactions: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const script = [
    "set timeout 15",
    'spawn -noecho /bin/sh -c "stty columns 80 rows 24; exec env CI=false NO_COLOR=1 TERM=xterm XDG_CONFIG_HOME=$env(XDG_ROOT) bun $env(SKILLSET_CLI) marketplace update --root $env(WORKSPACE_ROOT)"',
    ...interactions,
    "catch wait result",
    "exit [lindex $result 3]",
  ].join("\n");
  const proc = Bun.spawn([EXPECT, "-c", script], {
    env: {
      ...process.env,
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
