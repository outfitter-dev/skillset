import { runUserPromptSubmitHook } from "@skillset/core";

async function main() {
  const stdin = await Bun.stdin.text();
  const output = runUserPromptSubmitHook(stdin);
  console.log(output);
}

main();
