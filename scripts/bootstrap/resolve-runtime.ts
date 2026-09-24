import path from "node:path";

import { resolvePinnedBun } from "../pinned-bun";

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const runtime = await resolvePinnedBun(repoRoot);
await Bun.write(Bun.stdout, `${runtime.binPath}\n`);
