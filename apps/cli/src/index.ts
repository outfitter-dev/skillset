#!/usr/bin/env bun
import { runUserPromptSubmitHook } from "@skillset/core";
import { buildCli } from "./cli";

async function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd === "hook") {
    const stdin = await Bun.stdin.text();
    const out = await runUserPromptSubmitHook(stdin);
    console.log(out);
    return;
  }
  await buildCli();
}

main();
