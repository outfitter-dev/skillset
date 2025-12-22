import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ResolveResult } from "../types";

const PROJECT_LOG = join(
  process.cwd(),
  ".claude",
  "wskill",
  "logs",
  "events.jsonl"
);
const USER_LOG = join(homedir(), ".claude", "wskill", "logs", "events.jsonl");

function ensure(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function logResults(results: ResolveResult[]) {
  const now = new Date().toISOString();
  for (const res of results) {
    if (res.skill && !res.reason) continue; // only log issues
    const entry = {
      timestamp: now,
      invocation: res.invocation.raw,
      alias: res.invocation.alias,
      namespace: res.invocation.namespace,
      reason: res.reason,
      candidates: res.candidates?.map((c) => c.skillRef),
    };
    const line = `${JSON.stringify(entry)}\n`;
    for (const target of [PROJECT_LOG, USER_LOG]) {
      ensure(target);
      appendFileSync(target, line);
    }
  }
}
