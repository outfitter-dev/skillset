/* eslint-disable func-style, no-await-in-loop, no-use-before-define -- Keep fixture setup and command simulation beside their assertions. */
/* eslint-disable unicorn/import-style -- Node's standard named path import keeps the fixture concise. */
import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAgentSkillsProbe } from "./agent-skills";
import type {
  AgentSkillsProbeCommand,
  AgentSkillsProbeCommandRunner,
} from "./agent-skills";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("Agent Skills standards probe", () => {
  test("validates and copies every skill from the repository root", async () => {
    const fixture = await createFixture(["alpha", "beta"]);
    const commands: AgentSkillsProbeCommand[] = [];
    const runner = createRunner(commands);

    const previousSecret = process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_SECRET_ACCESS_KEY = "aws-should-not-leak";
    let result: Awaited<ReturnType<typeof runAgentSkillsProbe>>;
    try {
      result = await runAgentSkillsProbe({
        acquireReference: preparedReference,
        repositoryRoot: fixture.repositoryRoot,
        runner,
        skillsRoot: fixture.skillsRoot,
        tempRoot: fixture.tempRoot,
      });
    } finally {
      if (previousSecret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
      else process.env.AWS_SECRET_ACCESS_KEY = previousSecret;
    }

    expect(result.validator).toMatchObject({
      negativeCanaryRejected: true,
      revision: "69ef37e9424c0a7ea9dd2293b559e43ec8176379",
      validatedSkills: ["alpha", "beta"],
      version: "0.1.0",
    });
    expect(result.consumer).toMatchObject({
      gitHead: "d667282815248da03a08a18272b5d2eef9caf77c",
      package: "skills@1.5.26",
      repositoryRootDiscovery: true,
      version: "1.5.26",
    });
    expect(result.consumer.copiedSkills).toHaveLength(2);
    expect(
      result.consumer.copiedSkills.every(
        (skill) => skill.installedTreeHash === skill.sourceTreeHash
      )
    ).toBe(true);
    expect(result.safety).toEqual({
      repositoryUnchanged: true,
      runtimeConfigurationWritten: false,
    });

    const copyCommands = commands.filter((command) =>
      command.argv.includes("add")
    );
    expect(copyCommands).toHaveLength(2);
    expect(
      copyCommands.every((command) => {
        const addIndex = command.argv.indexOf("add");
        return command.argv[addIndex + 1]?.endsWith("/repository") === true;
      })
    ).toBe(true);
    expect(
      copyCommands.every((command) =>
        command.cwd.endsWith("/probe/skills-consumer")
      )
    ).toBe(true);
    expect(copyCommands[0]?.env.HOME?.endsWith("/probe/environment/home")).toBe(
      true
    );
    expect(
      copyCommands[0]?.env.npm_config_userconfig?.endsWith(
        "/probe/environment/config/npmrc"
      )
    ).toBe(true);
    expect(copyCommands[0]?.env.npm_config_globalconfig).toBe("/dev/null");
    expect(copyCommands[0]?.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(copyCommands[0]?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(copyCommands[0]?.env.CODEX_HOME?.endsWith("/probe/environment/config/codex")).toBe(
      true
    );
  });

  test("fails when the standards validator accepts the negative canary", async () => {
    const fixture = await createFixture(["alpha"]);
    const runner = createRunner([], {
      acceptCanary: true,
    });

    await expect(
      runAgentSkillsProbe({
        acquireReference: preparedReference,
        repositoryRoot: fixture.repositoryRoot,
        runner,
        skillsRoot: fixture.skillsRoot,
        tempRoot: fixture.tempRoot,
      })
    ).rejects.toThrow("accepted the missing-description negative canary");
  });

  test("fails when the consumer changes copied bytes", async () => {
    const fixture = await createFixture(["alpha"]);
    const runner = createRunner([], {
      corruptCopy: true,
    });

    await expect(
      runAgentSkillsProbe({
        acquireReference: preparedReference,
        repositoryRoot: fixture.repositoryRoot,
        runner,
        skillsRoot: fixture.skillsRoot,
        tempRoot: fixture.tempRoot,
      })
    ).rejects.toThrow("changed copied bytes for alpha");
  });

  test("requires the conventional repository-level Agent Skills root", async () => {
    const fixture = await createFixture(["alpha"]);
    const wrongRoot = join(fixture.repositoryRoot, "somewhere", "skills");
    await mkdir(wrongRoot, { recursive: true });

    await expect(
      runAgentSkillsProbe({
        acquireReference: preparedReference,
        repositoryRoot: fixture.repositoryRoot,
        runner: createRunner([]),
        skillsRoot: wrongRoot,
        tempRoot: fixture.tempRoot,
      })
    ).rejects.toThrow("requires");
  });
});

async function createFixture(skillNames: readonly string[]): Promise<{
  readonly repositoryRoot: string;
  readonly skillsRoot: string;
  readonly tempRoot: string;
}> {
  const parent = await mkdtemp(
    join(tmpdir(), "skillset-agent-skills-probe-test-")
  );
  roots.push(parent);
  const repositoryRoot = join(parent, "repository");
  const skillsRoot = join(repositoryRoot, ".agents", "skills");
  const tempRoot = join(parent, "probe");
  await Promise.all([mkdir(skillsRoot, { recursive: true }), mkdir(tempRoot)]);
  for (const name of skillNames) {
    const skillRoot = join(skillsRoot, name);
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await Promise.all([
      writeFile(
        join(skillRoot, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} proof.\n---\n\n# ${name}\n`
      ),
      writeFile(join(skillRoot, "references", "proof.txt"), `${name}\n`),
    ]);
  }
  return { repositoryRoot, skillsRoot, tempRoot };
}

async function preparedReference(tempRoot: string): Promise<string> {
  const root = join(tempRoot, "prepared-skills-ref");
  await mkdir(root, { recursive: true });
  return root;
}

function createRunner(
  commands: AgentSkillsProbeCommand[],
  options: {
    readonly acceptCanary?: boolean;
    readonly corruptCopy?: boolean;
  } = {}
): AgentSkillsProbeCommandRunner {
  return async (command) => {
    commands.push(command);
    if (command.argv[0] === "npm") {
      return success(
        JSON.stringify({
          dist: {
            integrity:
              "sha512-D5jnWoMPDRQ3fJM3RpQH8SBrAS9tmVlTC7OdOB2tk7D6nORbRnw8RLwjVj81IIGlxwWuBthEgUChM7SOZGvTHQ==",
          },
          gitHead: "d667282815248da03a08a18272b5d2eef9caf77c",
          version: "1.5.26",
        })
      );
    }
    if (command.argv.includes("validate")) {
      const subject = command.argv.at(-1) ?? "";
      if (subject.includes("negative-canary") && !options.acceptCanary) {
        return { exitCode: 1, stderr: "missing description", stdout: "" };
      }
      return success();
    }
    if (command.argv[0] === "npx") {
      const skillIndex = command.argv.indexOf("--skill");
      const name = command.argv[skillIndex + 1];
      if (name === undefined) {
        throw new Error("missing test skill selection");
      }
      const addIndex = command.argv.indexOf("add");
      const sourceRoot = command.argv[addIndex + 1];
      if (sourceRoot === undefined || !sourceRoot.endsWith("/repository")) {
        throw new Error("copy did not discover from the repository root");
      }
      const source = join(sourceRoot, ".agents", "skills", name);
      const destination = join(command.cwd, ".agents", "skills", name);
      await mkdir(join(command.cwd, ".agents", "skills"), { recursive: true });
      await cp(source, destination, { recursive: true });
      if (options.corruptCopy) {
        await writeFile(join(destination, "SKILL.md"), "corrupted\n");
      }
      return success();
    }
    throw new Error(`unexpected test command: ${command.argv.join(" ")}`);
  };
}

function success(stdout = ""): {
  readonly exitCode: 0;
  readonly stderr: "";
  readonly stdout: string;
} {
  return { exitCode: 0, stderr: "", stdout };
}
