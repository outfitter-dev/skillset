#!/usr/bin/env bun

import { reportCliError, runCli } from "./cli-core";

runCli(process.argv.slice(2), "create-skillset").catch(reportCliError);
