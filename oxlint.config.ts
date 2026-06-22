import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...core.ignorePatterns,
    "dist/**",
    ".skillset/cache/**",
    ".skillset/snapshots/**",
    ".claude/worktrees/**",
    ".scratch/**",
    ".agents/skills/**",
    ".claude/skills/**",
    "plugins-claude/**",
    "plugins-codex/**",
  ],
});
