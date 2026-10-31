import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { parseHooksCommandRequest } from "../hooks-args";
import { parseHooksSetupRequest } from "../hooks-setup-args";
import { generatedEditHookCommand, planHooksSetup } from "../hooks-setup-cli";
import { applyGeneratedEditHookSetup } from "@skillset/core/internal/generated-edit-hook-setup";

const runtime = { executable: "/path with 'quote'/bun", main: "/source/cli.ts", platform: "darwin" as const };
test("setup requires explicit target and scope and rejects unrelated or ambiguous flags", () => {
  const context = { cwd: "/project" };
  for (const tail of [[], ["--target", "claude"], ["--scope", "user"], ["--target", "cursor", "--scope", "project"], ["--target", "codex", "--scope", "user", "--root", "/x"], ["--target", "claude", "--scope", "project", "--yes=false"]]) {
    expect(() => parseHooksCommandRequest(["hooks", "setup", ...tail], context)).toThrow();
  }
  expect(parseHooksCommandRequest(["hooks", "setup", "--target=codex", "--scope=project", "--policy=warn", "--remove", "--json"], context)).toMatchObject({ hookSubcommand: "setup", target: "codex", scope: "project", policy: "warn", remove: true, jsonOutput: true, yes: false });
});

test("command preserves argv, stdin, provider identity and environment policy override", async () => {
  const root = await createTestFixtureRoot("hook-command-");
  const script = join(root, "quote' $() test.ts");
  await Bun.write(script, 'console.log(JSON.stringify({args:process.argv.slice(2),provider:process.env.SKILLSET_PROVIDER,policy:process.env.SKILLSET_GENERATED_EDIT_POLICY,input:await Bun.stdin.text()}))');
  const command = generatedEditHookCommand("codex", "block", { executable: process.execPath, main: script, platform: "darwin" });
  const child = Bun.spawn(["/bin/sh", "-c", command], { stdin: new Blob(["payload"]), stdout: "pipe", stderr: "pipe", env: { ...process.env, SKILLSET_GENERATED_EDIT_POLICY: "warn" } });
  expect(await child.exited).toBe(0);
  expect(JSON.parse(await new Response(child.stdout).text())).toEqual({ args: ["hooks", "run", "pre-tool-use"], provider: "codex", policy: "warn", input: "payload" });
  expect(generatedEditHookCommand("claude", "warn", { ...runtime, main: "/$bunfs/root/skillset" })).not.toContain("$bunfs");
  expect(() => generatedEditHookCommand("codex", "block", { ...runtime, platform: "win32" })).toThrow("POSIX");
});

test("project and user setup select only their explicit provider surface", async () => {
  const root = await createTestFixtureRoot("hook-cli-setup-");
  const home = await createTestFixtureRoot("hook-fake-home-");
  const override = join(home, "custom-config");
  for (const [target, projectFile, userFile, variable] of [["claude", ".claude/settings.local.json", "settings.json", "CLAUDE_CONFIG_DIR"], ["codex", ".codex/hooks.json", "hooks.json", "CODEX_HOME"]] as const) {
    const request = parseHooksSetupRequest(["hooks", "setup", "--target", target, "--scope", "project"], { cwd: root });
    const preview = await planHooksSetup(request, { home, env: { [variable]: "relative-invalid" } }, runtime);
    expect(preview.plan.settingsPath).toBe(projectFile);
    expect(await Bun.file(join(root, projectFile)).exists()).toBe(false);
    const user = { ...request, scope: "user" as const };
    await expect(planHooksSetup(user, { home, env: { [variable]: "relative-invalid" } }, runtime)).rejects.toThrow("absolute");
    const installed = await planHooksSetup(user, { home, env: { [variable]: override } }, runtime);
    await applyGeneratedEditHookSetup(installed.plan);
    expect(await Bun.file(join(override, userFile)).exists()).toBe(true);
    expect(await Bun.file(join(root, projectFile)).exists()).toBe(false);
    const removal = await planHooksSetup({ ...user, remove: true, policy: "warn" }, { home, env: { [variable]: override } }, runtime);
    expect(removal.entry).toEqual(installed.entry);
    await applyGeneratedEditHookSetup(removal.plan);
    expect(JSON.parse(await Bun.file(join(override, userFile)).text())).toEqual({});
  }
});

test("public CLI previews, applies, repeats and removes only fixture project settings", async () => {
  const root = await createTestFixtureRoot("hook-public-setup-");
  const cli = join(import.meta.dir, "..", "cli.ts");
  async function run(extra: string[] = []) {
    const child = Bun.spawn([process.execPath, cli, "hooks", "setup", "--target", "codex", "--scope", "project", "--root", root, "--json", ...extra], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    return JSON.parse(stdout);
  }
  const preview = await run();
  expect(preview.command).toBe("hooks setup");
  expect(preview.data.writes).toEqual([]);
  expect(await Bun.file(join(root, ".codex/hooks.json")).exists()).toBe(false);
  const installed = await run(["--yes"]);
  expect(installed.data.writes).toHaveLength(2);
  expect(installed.data.report.entry.hooks[0].command).toContain(cli);
  expect((await run(["--yes"])).data.writes).toEqual([]);
  const removal = await run(["--remove"]);
  expect(removal.data.report.entry).toEqual(installed.data.report.entry);
  await run(["--remove", "--yes"]);
  expect(JSON.parse(await Bun.file(join(root, ".codex/hooks.json")).text())).toEqual({});
});
