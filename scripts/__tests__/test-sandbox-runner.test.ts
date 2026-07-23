import { expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const runner = join(import.meta.dir, "..", "test-sandbox.ts");

test("SET-388: fresh runner isolates XDG, preserves HOME, and cleans its sandbox", async () => {
  const decoy = await decoyEnvironment();
  const before = await decoySnapshot(decoy.files);
  const result = await run(
    [
      "bun",
      "-e",
      "const fs=await import('node:fs/promises');console.log(JSON.stringify({count:process.env.GIT_CONFIG_COUNT,git:[process.env.GIT_CONFIG_GLOBAL,process.env.GIT_CONFIG_SYSTEM],gitSizes:await Promise.all([process.env.GIT_CONFIG_GLOBAL,process.env.GIT_CONFIG_SYSTEM].map(async(path)=>(await fs.stat(path)).size)),home:process.env.HOME,marker:process.env.SKILLSET_TEST_SANDBOX,prompt:process.env.GIT_TERMINAL_PROMPT,xdg:[process.env.XDG_CONFIG_HOME,process.env.XDG_CACHE_HOME,process.env.XDG_DATA_HOME,process.env.XDG_STATE_HOME]}))",
    ],
    decoy.env
  );

  expect(result.exitCode, result.stderr).toBe(0);
  const observed = JSON.parse(result.stdout.trim()) as {
    readonly count?: string;
    readonly git: readonly string[];
    readonly gitSizes: readonly number[];
    readonly home: string;
    readonly marker: string;
    readonly prompt: string;
    readonly xdg: readonly string[];
  };
  expect(observed.home).toBe(decoy.home);
  expect(
    observed.xdg.every((path) => path.includes("skillset-test-"))
  ).toBeTrue();
  expect(observed.git.every((path) => path.includes("skillset-test-"))).toBeTrue();
  expect(observed.gitSizes).toEqual([0, 0]);
  expect(observed.prompt).toBe("0");
  expect(observed.count).toBeUndefined();
  await expect(access(observed.marker)).rejects.toThrow();
  expect(await decoySnapshot(decoy.files)).toEqual(before);
});

test("SET-389: Git fixtures ignore ambient config, includes, templates, hooks, and identity", async () => {
  const contamination = await gitContaminationEnvironment();
  const before = await fileSnapshot(contamination.files);
  const helperUrl = new URL("../test-helpers/git-remote.ts", import.meta.url).href;
  const result = await run(
    [
      "bun",
      "-e",
      `const fs=await import("node:fs/promises");const helper=await import(${JSON.stringify(helperUrl)});const root=await helper.createTestGitFixtureRoot();const work=await fs.mkdtemp(root+"/work-");await fs.writeFile(work+"/README.md","fixture\\n");const remote=await helper.createTestGitRemote(work,{disposableRoot:root});console.log(JSON.stringify({branch:await helper.runTestGit(work,"branch","--show-current"),config:await helper.runTestGit(work,"config","--list","--show-origin"),identity:await helper.runTestGit(work,"show","-s","--format=%an <%ae>|%cn <%ce>",remote.sha),template:await Bun.file(work+"/.git/leaked-template").exists()}));`,
    ],
    contamination.env
  );

  expect(result.exitCode, result.stderr).toBe(0);
  const observed = JSON.parse(result.stdout.trim()) as {
    readonly branch: string;
    readonly config: string;
    readonly identity: string;
    readonly template: boolean;
  };
  expect(observed.branch).toBe("main");
  expect(observed.identity).toBe(
    "Skillset Tests <skillset@example.test>|Skillset Tests <skillset@example.test>"
  );
  expect(observed.template).toBeFalse();
  for (const leaked of [
    "commit.gpgsign",
    "core.attributesfile",
    "core.excludesfile",
    "core.hookspath",
    "credential.helper",
    "init.defaultbranch",
    "init.templatedir",
  ]) {
    expect(observed.config.toLowerCase()).not.toContain(leaked);
  }
  await expect(access(contamination.hookSentinel)).rejects.toThrow();
  await expect(access(contamination.credentialSentinel)).rejects.toThrow();
  expect(await fileSnapshot(contamination.files)).toEqual(before);
});

test("SET-388: concurrent runners own distinct sandboxes and propagate failures", async () => {
  const decoy = await decoyEnvironment();
  const command = [
    "bun",
    "-e",
    "console.log(process.env.SKILLSET_TEST_SANDBOX); process.exit(Number(process.argv[1]))",
    "7",
  ];
  const [first, second] = await Promise.all([
    run(command, decoy.env),
    run(command, decoy.env),
  ]);
  expect(first.exitCode).toBe(7);
  expect(second.exitCode).toBe(7);
  expect(first.stdout.trim()).not.toBe(second.stdout.trim());
  await expect(access(first.stdout.trim())).rejects.toThrow();
  await expect(access(second.stdout.trim())).rejects.toThrow();
});

test("SET-388: ambient unset, relative, and unusable XDG values are replaced", async () => {
  const result = await run(
    [
      "bun",
      "-e",
      "console.log([process.env.XDG_CONFIG_HOME,process.env.XDG_CACHE_HOME,process.env.XDG_DATA_HOME,process.env.XDG_STATE_HOME].every((value)=>value?.includes('skillset-test-')))",
    ],
    {
      SKILLSET_TEST_SANDBOX: "",
      XDG_CACHE_HOME: "",
      XDG_CONFIG_HOME: "relative-config",
      XDG_DATA_HOME: "/dev/null",
      XDG_STATE_HOME: "/not/writable/state",
    }
  );
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe("true");
});

test("SET-388: nested runners reuse the validated descriptor", async () => {
  const result = await run([
    "bun",
    runner,
    "--",
    "bun",
    "-e",
    "console.log(process.env.SKILLSET_TEST_SANDBOX)",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
});

test("SET-388: inherited worktree descriptors fail before child execution or cleanup", async () => {
  const worktree = await mkdtemp(join(tmpdir(), "skillset-worktree-forgery-"));
  const sandboxPath = join(worktree, "skillset-test-nested");
  const xdg = {
    cache: join(sandboxPath, "xdg", "cache"),
    config: join(sandboxPath, "xdg", "config"),
    data: join(sandboxPath, "xdg", "data"),
    state: join(sandboxPath, "xdg", "state"),
  };
  await writeFile(join(worktree, ".git"), "gitdir: /tmp/linked-worktree\n");
  await Promise.all(Object.values(xdg).map((path) => mkdir(path, { recursive: true })));
  const descriptorPath = join(sandboxPath, "descriptor.json");
  const sentinel = join(sandboxPath, "child-ran");
  await writeFile(descriptorPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    invocationId: crypto.randomUUID(),
    repoRoot: await realpath(join(import.meta.dir, "..", "..")),
    sandboxPath: await realpath(sandboxPath),
    schemaVersion: 1,
  }));

  const result = await run(
    [
      "bun",
      "-e",
      `await Bun.write(${JSON.stringify(sentinel)}, "started")`,
    ],
    {
      SKILLSET_TEST_SANDBOX: descriptorPath,
      XDG_CACHE_HOME: xdg.cache,
      XDG_CONFIG_HOME: xdg.config,
      XDG_DATA_HOME: xdg.data,
      XDG_STATE_HOME: xdg.state,
    }
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("invalid inherited test sandbox");
  expect(result.stderr).toContain("Git worktree");
  await expect(access(sentinel)).rejects.toThrow();
  await expect(access(descriptorPath)).resolves.toBeNull();
  await rm(worktree, { recursive: true });
});

test("SET-388: explicit retention reports the owned sandbox and descriptor", async () => {
  const result = await run(
    ["bun", "-e", "console.log(process.env.SKILLSET_TEST_SANDBOX)"],
    { SKILLSET_TEST_SANDBOX: "", SKILLSET_TEST_SANDBOX_RETAIN: "1" }
  );
  expect(result.exitCode, result.stderr).toBe(0);
  const descriptorPath = result.stdout.trim();
  expect(result.stderr).toContain("retained test sandbox");
  expect(result.stderr).toContain(`descriptor: ${descriptorPath}`);
  await expect(access(descriptorPath)).resolves.toBeNull();
  await rm(dirname(descriptorPath), { recursive: true });
});

test("SET-388: cleanup refuses a replaced sandbox and reports retention", async () => {
  const result = await run(
    [
      "bun",
      "-e",
      "const fs=await import('node:fs/promises');const descriptor=await Bun.file(process.env.SKILLSET_TEST_SANDBOX).json();console.log(process.env.SKILLSET_TEST_SANDBOX);await fs.rm(descriptor.sandboxPath,{recursive:true});await fs.symlink(process.cwd(),descriptor.sandboxPath)",
    ],
    { SKILLSET_TEST_SANDBOX: "" }
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("could not clean test sandbox");
  expect(result.stderr).toContain("refusing to clean unowned test sandbox");
  const sandboxPath = dirname(result.stdout.trim());
  await rm(sandboxPath);
});

for (const [signal, expectedExit] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`SET-388: ${signal} is forwarded and the owned sandbox is cleaned`, async () => {
    const proc = Bun.spawn({
      cmd: [
        "bun",
        runner,
        "--",
        "bun",
        "-e",
        "console.log(process.env.SKILLSET_TEST_SANDBOX); await Bun.sleep(10000)",
      ],
      env: { ...process.env, SKILLSET_TEST_SANDBOX: "" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const descriptorPath = (await readLine(proc.stdout)).trim();
    proc.kill(signal);
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode, stderr).toBe(expectedExit);
    await expect(access(descriptorPath)).rejects.toThrow();
  });
}

async function decoyEnvironment() {
  const root = await mkdtemp(join(tmpdir(), "skillset-decoy-"));
  const home = join(root, "home");
  const roots = {
    cache: join(root, "xdg-cache"),
    config: join(root, "xdg-config"),
    data: join(root, "xdg-data"),
    state: join(root, "xdg-state"),
  };
  const files = Object.entries(roots).map(([name, path]) =>
    join(path, "decoy", `${name}.txt`)
  );
  const gitFiles = [
    join(root, "git", "global-config"),
    join(root, "git", "system-config"),
  ];
  await Promise.all(
    files.map(async (path) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `do not touch ${path}\n`);
    })
  );
  await Promise.all(
    gitFiles.map(async (path) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "[commit]\n  gpgsign = true\n");
    })
  );
  await mkdir(home);
  return {
    env: {
      HOME: home,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_GLOBAL: gitFiles[0]!,
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_SYSTEM: gitFiles[1]!,
      GIT_CONFIG_VALUE_0: "/definitely-unavailable",
      NODE_ENV: "development",
      SKILLSET_TEST_SANDBOX: "",
      XDG_CACHE_HOME: roots.cache,
      XDG_CONFIG_HOME: roots.config,
      XDG_DATA_HOME: roots.data,
      XDG_STATE_HOME: roots.state,
    },
    files: [...files, ...gitFiles],
    home,
  };
}

async function gitContaminationEnvironment() {
  const root = await mkdtemp(join(tmpdir(), "skillset-git-decoy-"));
  const home = join(root, "home");
  const gitRoot = join(root, "git");
  const template = join(root, "template");
  const hooks = join(root, "hooks");
  const include = join(root, "included-config");
  const global = join(gitRoot, "global-config");
  const system = join(gitRoot, "system-config");
  const excludes = join(root, "global-excludes");
  const attributes = join(root, "global-attributes");
  const hookSentinel = join(root, "hook-ran");
  const credentialSentinel = join(root, "credential-ran");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(gitRoot, { recursive: true }),
    mkdir(template, { recursive: true }),
    mkdir(hooks, { recursive: true }),
  ]);
  await writeFile(join(template, "leaked-template"), "ambient\n");
  await writeFile(
    join(hooks, "pre-commit"),
    `#!/bin/sh\ntouch ${JSON.stringify(hookSentinel)}\n`
  );
  await chmod(join(hooks, "pre-commit"), 0o755);
  await writeFile(excludes, "*.ambient\n");
  await writeFile(attributes, "* ambient=true\n");
  await writeFile(
    include,
    `[commit]\n  gpgsign = true\n[init]\n  defaultBranch = ambient\n  templateDir = ${template}\n[core]\n  hooksPath = ${hooks}\n  excludesFile = ${excludes}\n  attributesFile = ${attributes}\n[credential]\n  helper = "!touch ${credentialSentinel}"\n`
  );
  await writeFile(global, `[include]\n  path = ${include}\n`);
  await writeFile(system, `[include]\n  path = ${include}\n`);
  return {
    credentialSentinel,
    env: {
      EMAIL: "ambient@example.com",
      GIT_AUTHOR_EMAIL: "ambient-author@example.com",
      GIT_AUTHOR_NAME: "Ambient Author",
      GIT_COMMITTER_EMAIL: "ambient-committer@example.com",
      GIT_COMMITTER_NAME: "Ambient Committer",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_GLOBAL: global,
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_PARAMETERS:
        "'user.name=Ambient Params' 'user.email=params@example.com'",
      GIT_CONFIG_SYSTEM: system,
      GIT_CONFIG_VALUE_0: hooks,
      GIT_TEMPLATE_DIR: template,
      HOME: home,
      SKILLSET_TEST_SANDBOX: "",
    },
    files: [attributes, excludes, global, include, system],
    hookSentinel,
  };
}

async function decoySnapshot(files: readonly string[]) {
  return Promise.all(
    files.map(async (path) => ({
      bytes: await readFile(path),
      entries: await Array.fromAsync(
        new Bun.Glob("**/*").scan({
          cwd: dirname(dirname(path)),
          onlyFiles: false,
        })
      ),
      path,
    }))
  );
}

async function fileSnapshot(files: readonly string[]) {
  return Promise.all(
    files.map(async (path) => ({
      bytes: await readFile(path),
      path,
    }))
  );
}

async function run(
  command: readonly string[],
  env: Record<string, string> = {}
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", runner, "--", ...command],
    env: { ...process.env, ...env },
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

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n")) {
    const next = await reader.read();
    if (next.done) break;
    text += decoder.decode(next.value, { stream: true });
  }
  reader.releaseLock();
  return text;
}
