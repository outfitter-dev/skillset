import { runUserPromptSubmitHook } from "./hooks/hook-runner";

async function main() {
  const stdin = await Bun.stdin.text();
  const output = await runUserPromptSubmitHook(stdin);
  console.log(output);
}

main();
