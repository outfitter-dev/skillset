import { isAbsolute } from "node:path";
import { inspectGeneratedEditOwnership } from "@skillset/core/internal/generated-edit-ownership";

/** Claude's documented Edit/Write protocol; other tools and providers get no decision. */
export async function preToolOutput(options: {
  readonly rootPath: string;
  readonly env: Record<string, string | undefined>;
  readonly stdinText?: string;
  readonly stderr?: Pick<typeof process.stderr, "write">;
}): Promise<string> {
  if (options.env.SKILLSET_PROVIDER !== "claude") return "";
  const policy = options.env.SKILLSET_GENERATED_EDIT_POLICY ?? "block";
  if (policy !== "block" && policy !== "warn") {
    options.stderr?.write("skillset: SKILLSET_GENERATED_EDIT_POLICY must be block or warn; no edit decision emitted\n");
    return "";
  }
  try {
    const input = JSON.parse(options.stdinText ?? "null");
    if (
      input?.hook_event_name !== "PreToolUse" ||
      (input.tool_name !== "Edit" && input.tool_name !== "Write") ||
      typeof input.tool_input?.file_path !== "string" ||
      !isAbsolute(input.tool_input.file_path)
    ) return "";
    const ownership = await inspectGeneratedEditOwnership(options.rootPath, input.tool_input.file_path);
    if (ownership.kind !== "managed") return "";
    const guidance = `Skillset manages ${JSON.stringify(ownership.outputPath)}. Its source ${ownership.sourceKind === "directory" ? "scope" : "unit"} is ${JSON.stringify(ownership.sourcePath)}. Use skillset explain for the source mapping, edit the source, then rebuild generated output.`;
    return `${JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse",
      ...(policy === "block"
        ? { permissionDecision: "deny", permissionDecisionReason: guidance }
        : { additionalContext: guidance }),
    } })}\n`;
  } catch {
    return "";
  }
}
