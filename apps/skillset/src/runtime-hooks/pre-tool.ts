import { getGeneratedEditHookProtocol } from "@skillset/registry";
import { isAbsolute, resolve } from "node:path";
import { codexPatchPaths } from "./codex-patch-paths";
import { inspectGeneratedEditOwnership } from "@skillset/core/internal/generated-edit-ownership";

/** Provider-specific edit inputs share the same verified ownership and policy decision. */
export async function preToolOutput(options: {
  readonly rootPath: string;
  readonly env: Record<string, string | undefined>;
  readonly stdinText?: string;
  readonly stderr?: Pick<typeof process.stderr, "write">;
}): Promise<string> {
  const policy = options.env.SKILLSET_GENERATED_EDIT_POLICY ?? "block";
  if (policy !== "block" && policy !== "warn") {
    options.stderr?.write("skillset: SKILLSET_GENERATED_EDIT_POLICY must be block or warn; no edit decision emitted\n");
    return "";
  }
  try {
    const input = JSON.parse(options.stdinText ?? "null");
    if (input?.hook_event_name !== "PreToolUse") return "";
    const paths = editedPaths(input, options.env.SKILLSET_PROVIDER);
    if (paths === undefined) return "";
    const warnings: string[] = [];
    for (const path of new Set(paths)) {
      const ownership = await inspectGeneratedEditOwnership(options.rootPath, path);
      if (ownership.kind !== "managed") continue;
      const guidance = `Skillset manages ${JSON.stringify(ownership.outputPath)}. Its source ${ownership.sourceKind === "directory" ? "scope" : "unit"} is ${JSON.stringify(ownership.sourcePath)}. Use skillset explain for the source mapping, edit the source, then rebuild generated output.`;
      if (policy === "block") return `${JSON.stringify({ hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny", permissionDecisionReason: guidance,
      } })}\n`;
      warnings.push(guidance);
    }
    return warnings.length === 0 ? "" : `${JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", additionalContext: warnings.join("\n"),
    } })}\n`;
  } catch {
    return "";
  }
}

function editedPaths(input: unknown, provider: string | undefined): readonly string[] | undefined {
  const protocol = getGeneratedEditHookProtocol(provider);
  if (protocol === undefined || input === null || typeof input !== "object") return undefined;
  const event = input as Record<string, unknown>;
  if (typeof event.tool_name !== "string" || !protocol.toolNames.includes(event.tool_name)) return undefined;
  const tool = event.tool_input;
  if (tool === null || typeof tool !== "object") return undefined;
  const fields = tool as Record<string, unknown>;
  if (protocol.inputKind === "absolute-file-path") {
    return typeof fields.file_path === "string" && isAbsolute(fields.file_path)
      ? [fields.file_path] : undefined;
  }
  if (protocol.inputKind === "apply-patch-command") {
    if (typeof fields.command !== "string" ||
      typeof event.cwd !== "string" || !isAbsolute(event.cwd)) return undefined;
    const cwd = event.cwd;
    const paths = codexPatchPaths(fields.command);
    return paths?.map((path) => resolve(cwd, path));
  }
  return undefined;
}
