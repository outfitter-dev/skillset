import { expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

test("repo tests use the canonical per-invocation sandbox runner", async () => {
  const packageJson = (await Bun.file(
    join(repoRoot, "package.json")
  ).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  expect(packageJson.scripts.test).toStartWith(
    "bun run test:sandbox -- bun test "
  );
  expect(packageJson.scripts["test:focused"]).toBe(
    "bun run test:sandbox -- bun test --timeout 15000"
  );
  for (const script of [
    "check",
    "conformance:adapters",
    "conformance:determinism",
    "conformance:external",
    "conformance:external:sync",
    "conformance:fast",
    "hooks:pre-commit",
    "hooks:pre-push",
    "publish:check",
    "skillset:build",
    "skillset:check",
    "skillset:check:ci",
    "skillset:check:ci:report",
    "skillset:check:outputs",
  ]) {
    expect(packageJson.scripts[script], script).toStartWith(
      "bun run test:sandbox -- "
    );
  }
});

test("hosted CI and source-owned hooks preserve per-invocation sandbox ownership", async () => {
  const workflow = await Bun.file(
    join(repoRoot, ".github/workflows/ci.yml")
  ).text();
  const lefthook = await Bun.file(join(repoRoot, "lefthook.yml")).text();
  const claude = await Bun.file(
    join(repoRoot, ".skillset/_claude/settings.json")
  ).text();
  const codex = await Bun.file(
    join(repoRoot, ".skillset/_codex/hooks/hooks.json")
  ).text();

  expect(workflow).toContain(
    "bun run test:sandbox -- bun ./apps/skillset/src/cli.ts check --ci"
  );
  expect(lefthook).toContain(
    "run: env -u SKILLSET_TEST_SANDBOX bun run check"
  );
  expect(lefthook).toContain(
    "run: env -u SKILLSET_TEST_SANDBOX bun run skillset:check:ci:report"
  );
  expect(claude).toContain(
    "bun run test:sandbox -- bun ./apps/skillset/src/cli.ts hooks run stop"
  );
  expect(codex).toContain(
    "bun run test:sandbox -- bun ./apps/skillset/src/cli.ts hooks run stop"
  );
  expect(claude).toContain(
    "bun ./apps/skillset/src/cli.ts hooks run post-tool-use"
  );
});
