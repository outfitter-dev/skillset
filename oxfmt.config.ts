import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    ".skillset/cache/**",
    ".skillset/snapshots/**",
    ".claude/worktrees/**",
    ".scratch/**",
    ".agents/skills/**",
    ".claude/skills/**",
    "plugins/**",
  ],
  proseWrap: "never",
});
