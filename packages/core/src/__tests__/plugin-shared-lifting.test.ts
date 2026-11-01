import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult } from "../build";

async function fixture(targets = ["claude", "codex", "cursor"]) {
  const root = await createTestFixtureRoot("plugin-shared-lifting-");
  await Bun.write(join(root, "skillset.yaml"), `compile:\n  targets: ${JSON.stringify(targets)}\n  session_start_hook: off\n  unsupportedDestination: warn\n`);
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\n  description: Demo.\n");
  await Bun.write(join(root, ".skillset/plugins/demo/subagents/review.md"), "---\nname: review\ndescription: Review.\n---\n{{> intro}}\n@{{shared:references/common.md}}\n");
  await Bun.write(join(root, ".skillset/shared/partials/intro.md"), "Review carefully.\n");
  await Bun.write(join(root, ".skillset/shared/references/common.md"), "@{{shared:assets/example.txt}}\n");
  await Bun.write(join(root, ".skillset/shared/assets/example.txt"), "example\n");
  return root;
}

test("plugin subagent links lift recursively into the package and record dependencies", async () => {
  const root = await fixture();
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  const agent = await readFile(join(root, "plugins/demo/agents/review.md"), "utf8");
  expect(agent).toContain("Review carefully.");
  expect(agent).toContain("@../shared/references/common.md");
  expect(await readFile(join(root, "plugins/demo/shared/references/common.md"), "utf8")).toBe("@../assets/example.txt\n");
  expect(result.data.filter(file => file.path === "plugins/demo/shared/assets/example.txt")).toHaveLength(1);
  const lock = JSON.parse(await readFile(join(root, "plugins/skillset.lock"), "utf8"));
  expect(lock.items.some((item: { preprocessDependencies?: string[] }) => item.preprocessDependencies?.includes(".skillset/shared/partials/intro.md"))).toBe(true);
  await Bun.write(join(root, ".skillset/shared/partials/intro.md"), "Review thoroughly.\n");
  expect((await diffSkillsetResult(root)).data.changed).not.toHaveLength(0);
});

test("authored plugin shared files are copied with a portable-only package", async () => {
  const root = await fixture([]);
  await Bun.write(join(root, ".skillset/plugins/demo/shared/references/local.md"), "Local\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, "plugins/demo/shared/references/local.md"), "utf8")).toBe("Local\n");
  expect(await Bun.file(join(root, "plugins/demo/shared/references/common.md")).exists()).toBe(false);
});

test("authored and lifted same-path content fails even when bytes agree", async () => {
  const root = await fixture(["claude"]);
  await Bun.write(join(root, ".skillset/plugins/demo/shared/references/common.md"), "@{{shared:assets/example.txt}}\n");
  await expect(buildSkillsetResult(root)).rejects.toThrow("skillset move plugins/demo/shared/references/common.md shared/references/common.md");
  expect(await Bun.file(join(root, "plugins/demo/plugin.json")).exists()).toBe(false);
});

test("plugin-level mixed include cycles fail before writing a package", async () => {
  const root = await fixture(["cursor"]);
  await Bun.write(join(root, ".skillset/shared/references/common.md"), "{{> intro}}\n");
  await Bun.write(join(root, ".skillset/shared/partials/intro.md"), "@{{shared:references/common.md}}\n");
  await expect(buildSkillsetResult(root)).rejects.toThrow("cycle");
  expect(await Bun.file(join(root, "plugins/demo/plugin.json")).exists()).toBe(false);
});

test("adaptive hook commands keep @ semantics and root their copied argument in each provider package", async () => {
  const root = await fixture();
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\nhooks:\n  SessionStart: [start]\n");
  await Bun.write(join(root, ".skillset/plugins/demo/hooks/start/hook.json"), JSON.stringify({ events: ["SessionStart"], run: { command: 'file="@{{shared:assets/example.txt}}"; cat "${file#@}"' } }));
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  for (const [file, rootVariable] of [["hooks/hooks.json", "CLAUDE_PLUGIN_ROOT"], [".cursor-plugin/hooks.json", "CURSOR_PLUGIN_ROOT"]]) {
    const text = await readFile(join(root, "plugins/demo", file!), "utf8");
    expect(text).toContain(`@\u0024{${rootVariable}}/shared/assets/example.txt`);
    expect(text).not.toContain("@{{shared:");
  }
});

test("plugin support scripts rewrite explicit marked links but preserve unrelated script templates", async () => {
  const root = await fixture([]);
  await Bun.write(join(root, ".skillset/plugins/demo/scripts/example.sh"), '#!/bin/sh\n# Caller must resolve paths relative to this script.\nfile="@{{shared:assets/example.txt}}"\nprintf "%s" "{{this.template}}"\n');
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const text = await readFile(join(root, "plugins/demo/scripts/example.sh"), "utf8");
  expect(text).toContain('file="@../shared/assets/example.txt"');
  expect(text).toContain("{{this.template}}");
  expect(await readFile(join(root, "plugins/demo/shared/assets/example.txt"), "utf8")).toBe("example\n");
});

test("native plugin hooks lift marked command arguments through structured handler fields", async () => {
  const root = await fixture(["claude"]);
  await Bun.write(join(root, ".skillset/plugins/demo/hooks/hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'file="@{{shared:assets/example.txt}}"; cat "${file#@}"' }] }] } }));
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const text = await readFile(join(root, "plugins/demo/hooks/hooks.json"), "utf8");
  expect(text).toContain("@${CLAUDE_PLUGIN_ROOT}/shared/assets/example.txt");
});

test("marked hook arguments read the copied file with documented root variables from an unrelated cwd", async () => {
  const root = await fixture();
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\nhooks:\n  SessionStart: [start]\n");
  await Bun.write(join(root, ".skillset/plugins/demo/hooks/start/hook.json"), JSON.stringify({ events: ["SessionStart"], run: { command: 'file="@{{shared:assets/example.txt}}"; cat "${file#@}"' } }));
  await buildSkillsetResult(root);
  for (const [file, variable] of [["hooks/hooks.json", "CLAUDE_PLUGIN_ROOT"], [".cursor-plugin/hooks.json", "CURSOR_PLUGIN_ROOT"]] as const) {
    const value = JSON.parse(await readFile(join(root, "plugins/demo", file), "utf8"));
    const entries = Object.values(value.hooks)[0] as { command?: string; hooks?: { command: string }[] }[];
    const command = entries[0]?.command ?? entries[0]?.hooks?.[0]?.command;
    expect(command).toBeDefined();
    const child = Bun.spawn(["sh", "-c", command!], { cwd: root, env: { ...process.env, [variable]: join(root, "plugins/demo") }, stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("example\n");
    expect(await new Response(child.stderr).text()).toBe("");
  }
});

test("script substitutions reject resource paths requiring language-specific escaping", async () => {
  const root = await fixture([]);
  await Bun.write(join(root, ".skillset/shared/assets/a'b.txt"), "data\n");
  await Bun.write(join(root, ".skillset/plugins/demo/scripts/example.sh"), "echo @{{shared:assets/a'b.txt}}\n");
  await expect(buildSkillsetResult(root)).rejects.toThrow("script-safe");
});

test("binary scripts and unmarked text keep their bytes", async () => {
  const root = await fixture([]);
  const binary = new Uint8Array([0, 255, ...Buffer.from("@{{shared:assets/absent.bin}}")]);
  const raw = "#!/bin/sh\r\nprintf '%s' '{{this.unrelated}}'\r\n";
  await Bun.write(join(root, ".skillset/plugins/demo/scripts/binary"), binary);
  await Bun.write(join(root, ".skillset/plugins/demo/scripts/unmarked.sh"), raw);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(new Uint8Array(await readFile(join(root, "plugins/demo/scripts/binary")))).toEqual(binary);
  expect(await readFile(join(root, "plugins/demo/scripts/unmarked.sh"), "utf8")).toBe(raw);
});

test("marked scripts preserve BOM, mixed line endings, and unrelated template syntax", async () => {
  const root = await fixture([]);
  const raw = '\uFEFF# unchanged\r\n$x = "@{{shared:assets/example.txt}}"\r\n{{foo/bar}}\n{{> root:unchanged}}\r{{{untouched}}}\r\n@{{{shared:assets/absent.txt}}}\r\n';
  await Bun.write(join(root, ".skillset/plugins/demo/scripts/example.ps1"), raw);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, "plugins/demo/scripts/example.ps1"), "utf8")).toBe(raw.replace("@{{shared:assets/example.txt}}", "@../shared/assets/example.txt").replace("@{{{shared:assets/absent.txt}}}", "@{{shared:assets/absent.txt}}"));
});

for (const native of [false, true]) {
  for (const command of [
    "printf '%s' '@{{shared:assets/example.txt}}'",
    'printf "%s" @{{shared:assets/example.txt}}',
    'printf "%s" "$(printf \'%s\' "@{{shared:assets/example.txt}}")"',
    'cat <<END\n"@{{shared:assets/example.txt}}"\nEND',
    '# "@{{shared:assets/example.txt}}"',
    'printf "%s" "${missing:-\'@{{shared:assets/example.txt}}\'}"',
  ]) {
    test(`${native ? "native" : "adaptive"} hook rejects unsupported marked quote context: ${command}`, async () => {
      const root = await fixture(["claude"]);
      if (native) {
        await Bun.write(join(root, ".skillset/plugins/demo/hooks/hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } }));
      } else {
        await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), "skillset:\n  name: demo\nhooks:\n  SessionStart: [start]\n");
        await Bun.write(join(root, ".skillset/plugins/demo/hooks/start/hook.json"), JSON.stringify({ events: ["SessionStart"], run: { command } }));
      }
      await expect(buildSkillsetResult(root)).rejects.toThrow("ordinary POSIX double quotes");
      expect(await Bun.file(join(root, "plugins/demo/plugin.json")).exists()).toBe(false);
    });
  }
}

test("hook marked references preserve unrelated templates and valid double-quoted apostrophes", async () => {
  const root = await fixture(["claude"]);
  const command = 'printf "%s" "it\'s \\"quoted\\" @{{shared:assets/example.txt}}" \'{{foo/bar}}\' \'{{> root:opaque}}\'';
  await Bun.write(join(root, ".skillset/plugins/demo/hooks/hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } }));
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const hooks = JSON.parse(await readFile(join(root, "plugins/demo/hooks/hooks.json"), "utf8"));
  expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe(command.replace("@{{shared:assets/example.txt}}", "@${CLAUDE_PLUGIN_ROOT}/shared/assets/example.txt"));
});


test("plugin partial support copies remain templates while subagents supply document context", async () => {
  const root = await fixture(["claude"]);
  await Bun.write(join(root, ".skillset/plugins/demo/shared/partials/context.md"), "Owner {{this.name}}.\n");
  await Bun.write(join(root, ".skillset/plugins/demo/subagents/review.md"), "---\nname: review\ndescription: Review.\n---\n{{> plugin:context}}\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, "plugins/demo/agents/review.md"), "utf8")).toContain("Owner review.");
  expect(await readFile(join(root, "plugins/demo/shared/partials/context.md"), "utf8")).toBe("Owner {{this.name}}.\n");
});
