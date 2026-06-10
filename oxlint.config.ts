import { defineConfig } from 'oxlint';
import ultracite from 'ultracite/oxlint/core';

export default defineConfig({
  extends: [ultracite],
  globals: {
    Bun: 'readonly',
  },
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    '.skillset/build/**',
    '.claude/worktrees/**',
    '.scratch/**',
    'plugins-claude/**',
    'plugins-codex/**',
  ],
  rules: {
    complexity: 'off',
    'func-style': 'off',
    'import/no-nodejs-modules': 'off',
    'import/no-cycle': 'off',
    'import/no-relative-parent-imports': 'off',
    'no-bitwise': 'off',
    'no-nested-ternary': 'off',
    'no-template-curly-in-string': 'off',
    'no-use-before-define': 'off',
    'no-warning-comments': [
      'error',
      {
        location: 'start',
        terms: ['todo:', 'fixme', 'xxx'],
      },
    ],
    'prefer-destructuring': 'off',
    'promise/avoid-new': 'off',
    'require-await': 'off',
    'sort-keys': 'off',
    'unicorn/no-await-expression-member': 'off',
    'unicorn/no-immediate-mutation': 'off',
    'unicorn/no-lonely-if': 'off',
    'unicorn/no-nested-ternary': 'off',
    'unicorn/no-useless-collection-argument': 'off',
    'unicorn/prefer-native-coercion-functions': 'off',
    'typescript/require-await': 'off',
    'unicorn/prefer-import-meta-properties': 'off',
    'unicorn/prefer-ternary': 'off',
  },
});
