#!/usr/bin/env bun

import { reportCliError, runCli } from './cli-core';

try {
  await runCli();
} catch (error) {
  reportCliError(error);
}
