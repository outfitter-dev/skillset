import { SkillsetFeatureDiagnosticError } from "./operation-result";

/** A deliberately bounded POSIX quote check, not a shell parser. */
export function assertHookReferenceQuote(command: string, offset: number, source: string): void {
  // Nested shell grammars need their own parsing. Keep marked arguments in a
  // simple outer command; authors can move complex logic into a script.
  let valid = !/`|\$\(|<<|\$\{/u.test(command.slice(0, offset));
  let quote: "single" | "double" | undefined;
  for (let index = 0; index < offset; index++) {
    const character = command[index];
    if (quote === "single") {
      if (character === "'") quote = undefined;
    } else if (character === "\\") {
      const next = command[index + 1];
      if (quote === undefined || (next !== undefined && '$`"\\\n'.includes(next))) index++;
    } else if (character === '"') {
      quote = quote === "double" ? undefined : "double";
    } else if (quote === undefined && character === "'") {
      quote = "single";
    } else if (quote === undefined && character === "#") {
      valid = false;
    }
  }
  if (valid && quote === "double") return;
  throw new SkillsetFeatureDiagnosticError({
    code: "plugin-hook-reference-quote",
    featureId: "resources",
    path: source,
    message: `skillset: ${source} marked hook arguments require ordinary POSIX double quotes so the plugin-root variable expands safely; place the marked argument before shell substitutions, comments, or here-documents, or move complex logic into a script`,
  });
}
