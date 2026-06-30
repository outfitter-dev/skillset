#!/usr/bin/env bun
import { runToolkitCli } from "@skillset/toolkit/cli";

process.exitCode = await runToolkitCli();
