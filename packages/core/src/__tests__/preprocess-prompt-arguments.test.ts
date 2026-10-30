import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { preprocessText, type PreprocessContext } from "../preprocess";

async function context(): Promise<PreprocessContext> {
  const rootPath = await createTestFixtureRoot("skillset-prompt-arguments-");
  return { rootPath, sourceRoot: ".skillset", sourcePath: join(rootPath, ".skillset/skills/demo/SKILL.md"), frontmatter: {} };
}

test("Claude rejects named canonical arguments without inferring a positional binding", async () => {
  const base = await context();
  for (const body of ["{{$ARGUMENTS.topic}}", "`{{$ARGUMENTS.limit}}`", "```sh\n{{$ARGUMENTS.some-name}}\n```", "{{$ARGUMENTS._name}}"] ) {
    await expect(preprocessText(body, { ...base, target: "claude" })).rejects.toThrow("named prompt argument");
  }
  await expect(preprocessText("{{$ARGUMENTS.topic}}", {
    ...base, target: "claude", frontmatter: { claude: { arguments: ["topic"] } },
  })).rejects.toThrow("named prompt argument");
});

test("Claude lowers only whole and indexed canonical arguments", async () => {
  expect(await preprocessText("{{$ARGUMENTS}} / {{$ARGUMENTS[0]}} / {{$ARGUMENTS[12]}}", {
    ...await context(), target: "claude",
  })).toBe("$ARGUMENTS / $ARGUMENTS[0] / $ARGUMENTS[12]");
});

test("portable preprocessing preserves named markers without a native support claim", async () => {
  const base = await context();
  expect(await preprocessText("{{$ARGUMENTS.topic}}", base)).toBe("{{$ARGUMENTS.topic}}");
});

test("literal and disabled preprocessing bypass canonical argument lowering", async () => {
  const base = { ...await context(), target: "claude" as const };
  expect(await preprocessText("{{{ $ARGUMENTS.topic }}} / $ARGUMENTS.topic / $topic", base))
    .toBe("{{$ARGUMENTS.topic}} / $ARGUMENTS.topic / $topic");
  expect(await preprocessText("{{$ARGUMENTS.topic}}", { ...base, frontmatter: { skillset: { preprocess: false } } }))
    .toBe("{{$ARGUMENTS.topic}}");
  await expect(preprocessText("{{$ARGUMENTS.topic}}", { ...base, promptArguments: false }))
    .rejects.toThrow("requires compile.features.promptArguments");
});
