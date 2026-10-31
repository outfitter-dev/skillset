import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getGeneratedEditHookProtocol } from "@skillset/registry";
import { applyGeneratedEditHookSetup, planGeneratedEditHookSetup } from "@skillset/core/internal/generated-edit-hook-setup";
import { printCliJsonData } from "./cli-output";
import type { HooksSetupRequest } from "./hooks-setup-args";

/** Capture the running CLI, never a PATH lookup or an auto-downloading package runner. */
export function generatedEditHookCommand(target: string, policy: "block" | "warn", runtime = { executable: process.execPath, main: Bun.main, platform: process.platform }) {
  if (runtime.platform === "win32") throw new Error("skillset: automatic hook setup currently requires a POSIX shell");
  if (!isAbsolute(runtime.executable) || !isAbsolute(runtime.main)) throw new Error("skillset: cannot establish an absolute CLI invocation");
  const argv = runtime.main.startsWith("/$bunfs/") ? [runtime.executable] : [runtime.executable, runtime.main];
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return `SKILLSET_PROVIDER=${quote(target)} SKILLSET_GENERATED_EDIT_POLICY="\${SKILLSET_GENERATED_EDIT_POLICY:-${policy}}" ${[...argv, "hooks", "run", "pre-tool-use"].map(quote).join(" ")}`;
}

export async function planHooksSetup(request: HooksSetupRequest, environment = { home: homedir(), env: process.env }, runtime?: Parameters<typeof generatedEditHookCommand>[2]) {
  const protocol = getGeneratedEditHookProtocol(request.target);
  if (protocol === undefined) throw new Error("skillset: unsupported generated-edit hook target");
  const config = protocol.configuration;
  let rootPath = request.rootPath;
  let settingsPath = config.projectPath;
  if (request.scope === "user") {
    const override = environment.env[config.homeVariable];
    if (override !== undefined && (!override.trim() || !isAbsolute(override))) throw new Error(`skillset: ${config.homeVariable} must be an absolute configuration directory`);
    const directory = override ?? join(environment.home, config.userDirectory);
    const selected = join(directory, config.userFile);
    rootPath = await existingAncestor(directory);
    settingsPath = relative(rootPath, selected);
  }
  const command = generatedEditHookCommand(request.target, request.policy, runtime);
  const entry = { matcher: protocol.matcher, hooks: [{ type: "command", command }] };
  const plan = await planGeneratedEditHookSetup(rootPath, { settingsPath, entry, remove: request.remove });
  return { plan, entry: plan.entry, trust: config.trust };
}

export async function runHooksSetup(request: HooksSetupRequest): Promise<void> {
  const { plan, entry, trust } = await planHooksSetup(request);
  if (request.yes) await applyGeneratedEditHookSetup(plan);
  const report = {
    target: request.target, scope: request.scope, policy: request.policy,
    action: request.remove ? "remove" : "install", changed: plan.changed,
    settingsPath: resolve(plan.rootPath, plan.settingsPath), recordPath: resolve(plan.rootPath, plan.recordPath),
    entry, trust,
    invocationNote: "The command uses this CLI's absolute location. Rerun setup after moving or replacing that installation.",
  };
  const writes = request.yes && plan.changed ? [report.settingsPath, report.recordPath] : [];
  if (request.jsonOutput) printCliJsonData("hooks setup", { report, state: writes.length ? "written" : "planned", writes });
  else {
    console.log(`${request.yes ? "Applied" : "Preview"}: ${report.action} ${request.target} generated-edit hook (${request.scope}, ${request.policy}).`);
    console.log(`Settings: ${report.settingsPath}\nOwnership: ${report.recordPath}\n${JSON.stringify(entry, null, 2)}`);
    console.log(`${trust}\n${report.invocationNote}`);
    if (!request.yes) console.log("Rerun with --yes to apply this setup plan.");
  }
}

async function existingAncestor(directory: string): Promise<string> {
  let candidate = directory;
  for (;;) {
    try {
      const stat = await lstat(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("skillset: configuration ancestor must be a regular directory");
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}
