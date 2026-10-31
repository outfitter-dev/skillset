import { expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { applyGeneratedEditHookSetup, planGeneratedEditHookSetup } from "../generated-edit-hook-setup";

const settingsPath = ".claude/settings.local.json";
const entry = { matcher: "^(Edit|Write)$", hooks: [{ type: "command", command: "skillset hooks run pre-tool-use" }] };
const options = { settingsPath, entry };

test("preview writes nothing; apply, update and removal preserve foreign settings", async () => {
  const root = await createTestFixtureRoot("hook-setup-");
  const absent = await planGeneratedEditHookSetup(root, options);
  expect(await Bun.file(join(root, settingsPath)).exists()).toBe(false);
  expect(await Bun.file(join(root, absent.recordPath)).exists()).toBe(false);
  const foreign = '{\n  "foreign": [1,  2], "hooks": { "SessionStart": [{"hooks":[{"command":"other"}]}], "PreToolUse": [{"matcher":"Bash", "hooks":[{"command":"foreign"}]}] }\n}\n';
  await Bun.write(join(root, settingsPath), foreign);
  const plan = await planGeneratedEditHookSetup(root, options);
  await applyGeneratedEditHookSetup(plan);
  const installed = await Bun.file(join(root, settingsPath)).text();
  expect(installed).toContain('"foreign": [1,  2]');
  expect(JSON.parse(installed).hooks.SessionStart[0].hooks[0].command).toBe("other");
  expect((await planGeneratedEditHookSetup(root, options)).changed).toBe(false);
  const replacement = { ...entry, hooks: [{ type: "command", command: "new-command" }] };
  await applyGeneratedEditHookSetup(await planGeneratedEditHookSetup(root, { ...options, entry: replacement }));
  expect(JSON.parse(await Bun.file(join(root, settingsPath)).text()).hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ command: "foreign" }] }, replacement]);
  await applyGeneratedEditHookSetup(await planGeneratedEditHookSetup(root, { ...options, remove: true }));
  expect(await Bun.file(join(root, settingsPath)).text()).toBe(foreign);
  expect((await planGeneratedEditHookSetup(root, { ...options, remove: true })).changed).toBe(false);
});

test("matching unmanaged or changed owned entries are conflicts, not adoption", async () => {
  const root = await createTestFixtureRoot("hook-setup-conflict-");
  await Bun.write(join(root, settingsPath), JSON.stringify({ hooks: { PreToolUse: [entry] } }));
  await expect(planGeneratedEditHookSetup(root, options)).rejects.toThrow("unmanaged");
  await Bun.write(join(root, settingsPath), "{}");
  await applyGeneratedEditHookSetup(await planGeneratedEditHookSetup(root, options));
  await Bun.write(join(root, settingsPath), JSON.stringify({ hooks: { PreToolUse: [{ ...entry, matcher: "Bash" }] } }));
  await expect(planGeneratedEditHookSetup(root, { ...options, remove: true })).rejects.toThrow("changed");
});

test("preview and apply reject malformed, duplicate and symlinked settings", async () => {
  const root = await createTestFixtureRoot("hook-setup-invalid-");
  for (const text of ['{', '{"hooks":{},"hooks":{}}', '{"hooks":{"PreToolUse":{}}}']) {
    await Bun.write(join(root, settingsPath), text);
    await expect(planGeneratedEditHookSetup(root, options)).rejects.toThrow();
  }
  const other = await createTestFixtureRoot("hook-setup-other-");
  await mkdir(join(other, "settings"));
  await symlink(join(other, "settings"), join(root, ".codex"));
  await expect(planGeneratedEditHookSetup(root, { ...options, settingsPath: ".codex/hooks.json" })).rejects.toThrow();
});

test("stale previews and partial writes never overwrite foreign bytes", async () => {
  const root = await createTestFixtureRoot("hook-setup-transaction-");
  const plan = await planGeneratedEditHookSetup(root, options);
  await Bun.write(join(root, settingsPath), '{"foreign":true}');
  await expect(applyGeneratedEditHookSetup(plan)).rejects.toThrow();
  expect(await Bun.file(join(root, settingsPath)).text()).toBe('{"foreign":true}');
  const fresh = await planGeneratedEditHookSetup(root, options);
  await expect(applyGeneratedEditHookSetup(fresh, { testHooks: { beforeApply: (_operation, index) => { if (index === 1) throw new Error("injected"); } } })).rejects.toThrow("injected");
  expect(await Bun.file(join(root, settingsPath)).text()).toBe('{"foreign":true}');
  expect(await Bun.file(join(root, fresh.recordPath)).exists()).toBe(false);
});


test("absent install and cleared-record reinstall are idempotent; duplicate ownership is refused", async () => {
  const root = await createTestFixtureRoot("hook-setup-reinstall-");
  const plan = await planGeneratedEditHookSetup(root, options);
  await applyGeneratedEditHookSetup(plan);
  await applyGeneratedEditHookSetup(await planGeneratedEditHookSetup(root, { ...options, remove: true }));
  await applyGeneratedEditHookSetup(await planGeneratedEditHookSetup(root, options));
  expect((await planGeneratedEditHookSetup(root, options)).changed).toBe(false);
  await Bun.write(join(root, settingsPath), JSON.stringify({ hooks: { PreToolUse: [entry, entry] } }));
  await expect(planGeneratedEditHookSetup(root, options)).rejects.toThrow("changed");
});

test("changed or malformed records cannot authorize writes", async () => {
  const root = await createTestFixtureRoot("hook-setup-record-");
  const plan = await planGeneratedEditHookSetup(root, options);
  await Bun.write(join(root, plan.recordPath), "{}");
  await expect(applyGeneratedEditHookSetup(plan)).rejects.toThrow();
  expect(await Bun.file(join(root, settingsPath)).exists()).toBe(false);
  await expect(planGeneratedEditHookSetup(root, options)).rejects.toThrow("record");
});
