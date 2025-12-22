#!/usr/bin/env bun
import { buildCli } from "./cli";
import { runUserPromptSubmitHook } from "@skillset/core";

async function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd === "hook") {
    const stdin = await Bun.stdin.text();
    const out = await runUserPromptSubmitHook(stdin);
    console.log(out);
    return;
  }
  buildCli();
}

main();
