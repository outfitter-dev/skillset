import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { partitionFormatTargets } from '../format-staged';

describe('format-staged', () => {
  test('partitions code, JSON, and YAML inputs', () => {
    expect(
      partitionFormatTargets([
        'src/app.ts',
        'src/app.test.tsx',
        'package.json',
        'tsconfig.jsonc',
        '.github/workflows/ci.yml',
        '.skillset/config.yaml',
        'README.md',
      ])
    ).toEqual({
      code: ['src/app.ts', 'src/app.test.tsx'],
      json: ['package.json', 'tsconfig.jsonc'],
      yaml: ['.github/workflows/ci.yml', '.skillset/config.yaml'],
    });
  });

  test('formats JSON-only inputs without invoking the code lint path', () => {
    const root = mkdtempSync(join(tmpdir(), 'format-staged-'));
    const jsonPath = join(root, 'package.json');
    writeFileSync(jsonPath, '{"b":1,"a":2}\n');

    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, 'scripts/format-staged.ts', jsonPath],
        cwd: resolve(import.meta.dir, '..', '..'),
        stderr: 'pipe',
        stdout: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(jsonPath, 'utf-8')).toBe(
        '{\n  "a": 2,\n  "b": 1\n}\n'
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('formats YAML-only inputs without invoking the code lint path', () => {
    const root = mkdtempSync(join(tmpdir(), 'format-staged-'));
    const yamlPath = join(root, 'skillset.yaml');
    writeFileSync(yamlPath, 'root: {b: 1, a: 2}\n');

    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, 'scripts/format-staged.ts', yamlPath],
        cwd: resolve(import.meta.dir, '..', '..'),
        stderr: 'pipe',
        stdout: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(readFileSync(yamlPath, 'utf-8')).toBe('root: { b: 1, a: 2 }\n');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
