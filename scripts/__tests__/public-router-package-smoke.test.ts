import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { createTestFixtureRoot } from "../test-helpers/fixture-root";

// Opt-in distribution evidence: deliberately executes the real published package.
// Default gates remain offline; run this separately when qualifying the offered pin.
test.skipIf(process.env.SKILLSET_ROUTER_PACKAGE_SMOKE !== "1")("router's offered exact npm package executes version and an unchanged-workspace init preview", async () => {
  const root = await createTestFixtureRoot("skillset-router-package-");
  try {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    const skill = join(import.meta.dir, "../../plugins/skillset/skills/skillset");
    const contract = await readFile(join(skill, "scripts/compatibility.env"), "utf8");
    const version = /^cli=(\d+\.\d+\.\d+)$/mu.exec(contract)?.[1];
    expect(version).toBeDefined();
    const guidance = await readFile(join(skill, "references/preflight-and-recovery.md"), "utf8");
    const prefix = ["npm", "exec", "--yes", `--package=skillset@${version}`, "--", "skillset"];
    for (const args of [["--version"], ["init", "--root", "."]]) {
      expect(guidance).toContain([...prefix, ...args].join(" "));
      const proc = Bun.spawn([...prefix, ...args], {
        cwd: workspace,
        env: { ...process.env, npm_config_cache: join(root, "npm-cache"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config") },
        stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
      if (args[0] === "--version") expect(stdout.trim()).toBe(version!);
      else expect(stdout).toContain("skillset.yaml");
      expect(await readdir(workspace)).toEqual([]);
      console.log(JSON.stringify({ command: [...prefix, ...args], code, stdout, stderr }));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
