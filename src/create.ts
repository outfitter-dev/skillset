#!/usr/bin/env bun

import { reportCliError, runCli } from './cli-core';

try {
  await runCli(process.argv.slice(2), 'create-skillset');
} catch (error) {
  reportCliError(error);
}
