import { runUserPromptSubmitHook } from "@skillset/core";

async function main() {
  const stdin = await Bun.stdin.text();
  const output = await runUserPromptSubmitHook(stdin);
  console.log(output);
}

main();
