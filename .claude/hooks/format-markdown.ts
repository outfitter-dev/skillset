#!/usr/bin/env bun
/**
 * Markdown linter hook - runs markdownlint-cli2 --fix on .md files after write/edit
 */

import { $ } from "bun";

const input = await Bun.stdin.json();
const filePath: string = input?.tool_input?.file_path ?? "";

if (filePath.endsWith(".md")) {
  await $`bunx markdownlint-cli2 --fix ${filePath}`.quiet().nothrow();
}
