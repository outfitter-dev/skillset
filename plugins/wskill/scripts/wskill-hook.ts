/**
 * Plugin hook entrypoint for wskill.
 *
 * Attempts to import from the installed npm package first,
 * falling back to the local monorepo path for development.
 */

type HookRunner = (stdin: string) => Promise<string>;

async function loadHookRunner(): Promise<HookRunner> {
	try {
		// Try npm package first (for installed plugins)
		const mod = await import("wskill/hook");
		return mod.runUserPromptSubmitHook;
	} catch {
		// Fall back to monorepo path (for development)
		const mod = await import(
			"../../../packages/wskill/src/hooks/hook-runner.ts"
		);
		return mod.runUserPromptSubmitHook;
	}
}

async function main() {
	const runUserPromptSubmitHook = await loadHookRunner();
	const stdin = await Bun.stdin.text();
	const output = await runUserPromptSubmitHook(stdin);
	console.log(output);
}

main();
