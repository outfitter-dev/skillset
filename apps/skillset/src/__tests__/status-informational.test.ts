import { expect, test } from "bun:test";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { quoteShellArgument } from "../recovery-guidance";
import { validateCliResult } from "@skillset/schema";
import { buildSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

const cli = join(import.meta.dir, "../cli.ts");
const source = ".skillset/skills/demo/SKILL.md";
const output = ".agents/skills/demo/SKILL.md";
async function fixture(empty = false): Promise<string> {
  const root = await createTestFixtureRoot("status-informational-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n  session_start_hook: off\n");
  if (!empty) await Bun.write(join(root, source), "---\nname: demo\ndescription: Demo skill\n---\n\nBody.\n");
  else await Bun.write(join(root, ".skillset/.keep"), "");
  return root;
}
async function run(root: string, json = true, env = process.env) {
  const child = Bun.spawn([process.execPath, cli, "status", "--root", root, ...(json ? ["--json"] : [])], { stdout: "pipe", stderr: "pipe", env });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}
async function snapshot(root: string) {
  const paths = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(paths.filter((entry) => entry.isFile()).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name))).map(async (entry) => {
    const path = join(entry.parentPath, entry.name);
    return [path, await readFile(path, "utf8")];
  }));
}

test("completed status observations exit zero with readiness in the conclusion", async () => {
  const root = await fixture();
  for (const [state, command, change] of [
    ["no-output-baseline", "skillset build", async () => {}],
    ["current", "skillset check", async () => { expect((await buildSkillsetResult(root)).ok).toBe(true); }],
    ["source-ahead", "skillset build", async () => { await writeFile(join(root, source), (await readFile(join(root, source), "utf8")) + "More source.\n"); }],
    ["output-diverged", "skillset reconcile", async () => { await writeFile(join(root, output), (await readFile(join(root, output), "utf8")) + "Output edit.\n"); }],
  ] as const) {
    await change();
    const before = await snapshot(root);
    const result = await run(root);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout);
    expect(validateCliResult(envelope).ok).toBe(true);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.conclusion).toMatchObject({ state, ready: state === "current", nextAction: { command: `${command} --root ${quoteShellArgument(root)}` } });
    expect(envelope.data).not.toHaveProperty("featureCapabilities");
    expect(envelope.data).not.toHaveProperty("ok");
    expect(envelope.data.release).toMatchObject({ pendingEntries: 0, ignoredEntries: 0 });
    expect(await snapshot(root)).toEqual(before);
  }
  const check = Bun.spawnSync([process.execPath, cli, "check", "--root", root, "--json"], { stdout: "pipe", stderr: "pipe" });
  expect(check.exitCode).not.toBe(0);
});

test("human status leads with conclusion and one appropriate next action", async () => {
  const root = await fixture();
  const result = await run(root, false);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.split("\n")[0]).toContain("no output baseline");
  expect(result.stdout).toContain("source:");
  expect(result.stdout).toContain("output:");
  expect(result.stdout).toContain("release:");
  expect(result.stdout.match(/  next:/gu)).toHaveLength(1);
  expect(result.stdout).toContain("skillset build");
  expect(result.stdout).not.toContain("--yes");
  expect(result.stdout).not.toContain("features:");
  expect(result.stdout).not.toContain("feature support:");
});

test("empty source is informational and recommends authoring", async () => {
  const result = await run(await fixture(true));
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { source: { state: "empty" }, conclusion: { state: "no-active-source", ready: false, nextAction: { kind: "author" } } } });
});

test("corrupt output lock is an informational blocker", async () => {
  const root = await fixture();
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  await writeFile(join(root, ".agents/skills/skillset.lock"), "{");
  const result = await run(root);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { conclusion: { state: "blocked", ready: false, nextAction: { kind: "diagnose" } } } });
});

test("pending entry evidence does not claim release readiness", async () => {
  const root = await fixture();
  await Bun.write(join(root, ".skillset/changes/example.md"), "Describe this pending change.\n");
  const result = await run(root);
  expect(result.exitCode).toBe(0);
  const release = JSON.parse(result.stdout).data.release;
  expect(release.pendingEntries).toBe(1);
  expect(release).not.toHaveProperty("ready");
});


test("operational and unexpected read failures remain nonzero", async () => {
  const root = await fixture();
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  await Bun.write(join(root, ".skillset/changes/example.md"), "Pending change.\n");
  for (const file of ["skillset.yaml", source, output, ".agents/skills/skillset.lock", ".skillset/changes/example.md"]) {
    for (const code of ["EACCES", "EIO", "internal"]) {
      const script = `
        import { mock } from "bun:test";
        const fs = await import("node:fs/promises");
        const readFile = fs.readFile;
        const failure = Object.assign(new TypeError("injected inspection failure"), ${JSON.stringify(code)} === "internal" ? {} : { code: ${JSON.stringify(code)} });
        mock.module("node:fs/promises", () => ({ ...fs, readFile: async (path, ...args) => {
          if (path === ${JSON.stringify(join(root, file))}) throw failure;
          return readFile(path, ...args);
        }}));
        process.argv = [process.execPath, ${JSON.stringify(cli)}, "status", "--root", ${JSON.stringify(root)}, "--json"];
        await import(${JSON.stringify(cli)});
      `;
      const child = Bun.spawnSync([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
      expect(child.exitCode).not.toBe(0);
      const envelope = JSON.parse(new TextDecoder().decode(child.stdout));
      expect(validateCliResult(envelope).ok).toBe(true);
      expect(envelope.ok).toBe(false);
      expect(envelope.data?.conclusion?.ready).not.toBe(true);
    }
  }
});

test("bare status does not attempt user-level provider or XDG reads", async () => {
  const root = await fixture();
  const sentinel = await createTestFixtureRoot("status-user-state-sentinel-");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  for (const broken of [false, true]) {
    if (broken) await writeFile(join(root, source), "---\ndescription: [unclosed\n---\nBody\n");
    const script = `
      import assert from "node:assert/strict";
      import { homedir } from "node:os";
      import { join } from "node:path";
import { quoteShellArgument } from "../recovery-guidance";
      import { mock } from "bun:test";
      const fs = await import("node:fs/promises");
      const forbidden = [${JSON.stringify(sentinel)}, ...[".claude", ".codex", ".agents"].map(name => join(homedir(), name))];
      let attempts = 0;
      const wrapped = {};
      for (const name of ["readFile", "readdir", "stat", "lstat", "realpath", "access", "open"]) {
        const original = fs[name];
        wrapped[name] = async (path, ...args) => {
          if (forbidden.some(root => String(path) === root || String(path).startsWith(root + "/"))) {
            attempts++;
            throw new Error("unexpected user-level read");
          }
          return original(path, ...args);
        };
      }
      mock.module("node:fs/promises", () => ({ ...fs, ...wrapped }));
      process.argv = [process.execPath, ${JSON.stringify(cli)}, "status", "--root", ${JSON.stringify(root)}, "--json"];
      await import(${JSON.stringify(cli)});
      assert.equal(attempts, 0);
    `;
    const child = Bun.spawnSync([process.execPath, "--eval", script], {
      stdout: "pipe", stderr: "pipe",
      env: { ...process.env, XDG_CONFIG_HOME: join(sentinel, "config"), XDG_CACHE_HOME: join(sentinel, "cache"), XDG_STATE_HOME: join(sentinel, "state"), XDG_DATA_HOME: join(sentinel, "data") },
    });
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    expect(child.exitCode).toBe(broken ? 1 : 0);
    expect(validateCliResult(JSON.parse(new TextDecoder().decode(child.stdout))).ok).toBe(true);
  }
});


test("draft-only source recommends authoring rather than an empty build", async () => {
  const root = await fixture(true);
  await Bun.write(join(root, ".skillset/skills/_drafts/demo/SKILL.md"), "---\nname: demo\ndescription: Draft skill\n---\n\nDraft body.\n");
  const result = await run(root);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).data).toMatchObject({ source: { state: "inactive" }, conclusion: { state: "no-active-source", ready: false, nextAction: { kind: "author" } } });
});

test("release schema blockers take precedence over authoring guidance", async () => {
  const root = await fixture(true);
  await Bun.write(join(root, ".skillset/changes/example.md"), "---\nbump: invalid\n---\nPending reason.\n");
  const result = await run(root);
  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout).data;
  expect(report.release.diagnostics.length).toBeGreaterThan(0);
  expect(report.conclusion).toMatchObject({ state: "blocked", ready: false, nextAction: { kind: "diagnose" } });
});

test("observed unmanaged collisions remain informational without recommending writes", async () => {
  const root = await fixture();
  await Bun.write(join(root, output), "Unmanaged authored material.\n");
  const result = await run(root);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).data.conclusion).toMatchObject({ state: "blocked", ready: false, nextAction: { kind: "diagnose" } });
  expect(result.stdout).not.toContain("--yes");
});


test("output blockers take precedence over inactive source guidance", async () => {
  const root = await fixture();
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  await Bun.write(join(root, ".skillset/skills/_drafts/demo/SKILL.md"), await readFile(join(root, source), "utf8"));
  await rm(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(join(root, ".agents/skills/skillset.lock"), "{");
  const result = await run(root);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).data.conclusion).toMatchObject({ state: "blocked", nextAction: { kind: "diagnose" } });
});


test("empty source retains independently observed corrupt lock blockers", async () => {
  const root = await fixture();
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  await rm(join(root, ".skillset/skills"), { recursive: true });
  await writeFile(join(root, ".agents/skills/skillset.lock"), "{");
  const result = await run(root);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).data).toMatchObject({ source: { state: "empty" }, conclusion: { state: "blocked", nextAction: { kind: "diagnose" } } });
  expect(result.stdout).toContain("skillset.lock");
  expect((await run(root, false)).stdout).toContain("output diagnostic:");
});

test("suggested commands preserve roots containing spaces and apostrophes", async () => {
  const parent = await fixture(true);
  const root = join(parent, "author's workspace");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n  session_start_hook: off\n");
  await Bun.write(join(root, source), "---\nname: demo\ndescription: Demo skill\n---\n\nBody.\n");
  const result = await run(root);
  const command = JSON.parse(result.stdout).data.conclusion.nextAction.command;
  expect(command).toBe(`skillset build --root ${quoteShellArgument(root)}`);
  const parsed = Bun.spawnSync(["sh", "-c", `set -- ${command}; printf '%s' "$4"`], { stdout: "pipe", stderr: "pipe" });
  expect(parsed.exitCode).toBe(0);
  expect(new TextDecoder().decode(parsed.stdout)).toBe(root);
});


test("automatic hooks leave output unobserved without invoking external Git", async () => {
  const root = await fixture();
  await writeFile(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n");
  const bin = join(root, "fake-bin");
  await mkdir(bin);
  const marker = join(root, "git-was-called");
  await writeFile(join(bin, "git"), '#!/bin/sh\nprintf invoked > "$GIT_PROBE_MARKER"\nexit 0\n');
  await chmod(join(bin, "git"), 0o755);
  const result = await run(root, true, { ...process.env, PATH: bin, GIT_PROBE_MARKER: marker });
  expect(await Bun.file(marker).exists()).toBe(false);
  expect(result.exitCode).not.toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(envelope.data).toMatchObject({
    conclusion: { state: "inspection-failed", ready: false },
    source: { state: "observed" },
    release: { pendingEntries: 0 },
  });
  expect(result.stdout).toContain("automatic session hook placement requires Git ignore evidence");
});
