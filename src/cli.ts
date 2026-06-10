#!/usr/bin/env bun

import { reportCliError, runCli } from "./cli-core";

runCli().catch(reportCliError);
