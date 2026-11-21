#!/usr/bin/env bun

import {
  assertStandardProfiles,
  listStandardProfiles,
} from "@skillset/provider-evidence";

import { runCliEntrypoint } from "./cli-entrypoint";

// Keeps immutable offline schemas in the public Bun and native CLI entrypoint.
assertStandardProfiles(listStandardProfiles());
await runCliEntrypoint();
