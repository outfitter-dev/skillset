#!/usr/bin/env bun

import { runCliEntrypoint } from "./cli-entrypoint";

await runCliEntrypoint(process.argv.slice(2), "create-skillset");
