import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...core.ignorePatterns,
    "dist/**",
    ".skillset/build/**",
    ".claude/worktrees/**",
    ".scratch/**",
    ".agents/skills/**",
    ".claude/skills/**",
    "plugins-claude/**",
    "plugins-codex/**",
  ],
});
