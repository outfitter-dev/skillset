import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

import {
  hasSkillsetRuntimeSourceChanges,
  resolveSkillsetCommand,
  skillsetRuntimeSourcePaths,
} from '../../.skillset/shared/scripts/skillset-runtime-hooks';

test('runtime hook source gate ignores unrelated edits', async () => {
  const root = await gitFixture();

  await writeFile(join(root, 'README.md'), 'changed\n');

  expect(await hasSkillsetRuntimeSourceChanges(root)).toBe(false);
});

test('runtime hook source gate catches tracked and untracked Skillset edits', async () => {
  const root = await gitFixture();

  await writeFile(join(root, '.skillset/src/claude/settings.json'), '{}\n');
  expect(await hasSkillsetRuntimeSourceChanges(root)).toBe(true);

  await runGit(root, 'checkout', '--', '.skillset/src/claude/settings.json');
  await mkdir(join(root, '.skillset/plugins/demo'), { recursive: true });
  await writeFile(
    join(root, '.skillset/plugins/demo/skillset.yaml'),
    'skillset:\n  name: demo\n'
  );

  expect(await hasSkillsetRuntimeSourceChanges(root)).toBe(true);
});

test('runtime hook source paths include source, shared, and pending change entries', () => {
  expect(skillsetRuntimeSourcePaths()).toEqual([
    '.skillset/config.yaml',
    '.skillset/instructions',
    '.skillset/skills',
    '.skillset/plugins',
    '.skillset/shared',
    '.skillset/src',
    '.skillset/changes/pending',
  ]);
});

test('runtime hook command resolver honors overrides and local compiler checkout', async () => {
  const root = await gitFixture();

  expect(
    await resolveSkillsetCommand(root, {
      SKILLSET_HOOK_COMMAND: 'custom skillset',
    })
  ).toEqual({
    argv: ['custom skillset'],
    kind: 'shell',
  });

  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'skillset' })
  );
  await writeFile(join(root, 'src/cli.ts'), "console.log('local skillset');\n");

  expect(await resolveSkillsetCommand(root, {})).toEqual({
    argv: ['bun', './src/cli.ts'],
    kind: 'argv',
  });
});

async function gitFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillset-runtime-hooks-'));
  await mkdir(join(root, '.skillset/src/claude'), { recursive: true });
  await mkdir(join(root, '.skillset/changes/pending'), { recursive: true });
  await writeFile(
    join(root, '.skillset/config.yaml'),
    'skillset:\n  schema: 1\n'
  );
  await writeFile(
    join(root, '.skillset/src/claude/settings.json'),
    '{"hooks":{}}\n'
  );
  await writeFile(join(root, 'README.md'), 'initial\n');
  await runGit(root, 'init', '-q');
  await runGit(root, 'config', 'user.email', 'skillset@example.com');
  await runGit(root, 'config', 'user.name', 'Skillset Tests');
  await runGit(root, 'add', '.');
  await runGit(root, 'commit', '-m', 'initial', '-q');
  return root;
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ['git', ...args],
    cwd: root,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (${exitCode})\n${stdout}${stderr}`
    );
  }
}
