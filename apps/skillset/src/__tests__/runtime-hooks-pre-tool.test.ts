import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { runHookEvent } from "../runtime-hooks/run";

async function fixture() {
  const root = await createTestFixtureRoot("pre-tool-ownership-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n  session_start_hook: off\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Managed skill.\n---\n\nBody.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  return root;
}

test("Claude pre-tool denies owned edits by default, warns explicitly, and bypasses source commands", async () => {
  const root = await fixture();
  const options = {
    rootPath: root,
    stdinText: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(root, ".agents/skills/demo/SKILL.md") } }),
    sourceGate: async () => { throw new Error("must not inspect Git"); },
    commandRunner: async () => { throw new Error("must not run commands"); },
  };
  const blocked = await runHookEvent("pre-tool-use", { ...options, env: { SKILLSET_PROVIDER: "claude" } });
  expect(blocked.exitCode).toBe(0);
  expect(blocked.ranCommands).toEqual([]);
  expect(blocked.writes.mode).toBe("read");
  expect(JSON.parse(blocked.output).hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
  expect(blocked.output).toContain(".skillset/skills/demo/SKILL.md");
  const warning = await runHookEvent("pre-tool-use", { ...options, env: { SKILLSET_PROVIDER: "claude", SKILLSET_GENERATED_EDIT_POLICY: "warn" } });
  expect(JSON.parse(warning.output).hookSpecificOutput.additionalContext).toContain(".skillset/skills/demo/SKILL.md");
  expect(warning.output).not.toContain("permissionDecision");
  for (const env of [{}, { SKILLSET_PROVIDER: "codex" }, { SKILLSET_PROVIDER: "claude", SKILLSET_GENERATED_EDIT_POLICY: "invalid" }]) {
    expect((await runHookEvent("pre-tool-use", { ...options, env })).output).toBe("");
  }
  for (const stdinText of ["{", "null", "{}", JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { file_path: join(root, ".agents/skills/demo/SKILL.md") } }), JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: ".agents/skills/demo/SKILL.md" } })]) {
    expect((await runHookEvent("pre-tool-use", { ...options, env: { SKILLSET_PROVIDER: "claude" }, stdinText })).output).toBe("");
  }
});

test("CLI emits only the Claude wire decision for Write and leaves output unchanged", async () => {
  const root = await fixture();
  const target = join(root, ".agents/skills/demo/SKILL.md");
  const before = await Bun.file(target).text();
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../cli.ts"), "hooks", "run", "pre-tool-use", "--root", root], {
    env: { ...process.env, SKILLSET_PROVIDER: "claude", SKILLSET_GENERATED_EDIT_POLICY: "block" },
    stdin: new Blob([JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: target, content: "replacement" } })]),
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  expect(await Bun.file(target).text()).toBe(before);
});
