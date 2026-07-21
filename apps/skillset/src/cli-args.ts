import * as build from "./build-args";
import { parseChangeCommandRequest } from "./change-args";
import { parseCheckCommandRequest } from "./check-args";
import type { CliParseContext } from "./cli-arg-values";
import { isCliCommand, renderExpectedCliCommands } from "./cli-commands";
import { CliOutputError, readCliCommand } from "./cli-output";
import type { CliRequest } from "./cli-request";
import { USAGE } from "./cli-usage";
import { parseCreateCommandRequest } from "./create-args";
import { parseDevCommandRequest } from "./dev-args";
import * as distribution from "./distribution-args";
import { parseHooksCommandRequest } from "./hooks-args";
import { parseInitCommandRequest } from "./init-args";
import * as inspection from "./inspect-args";
import { parseLookupCommandRequest } from "./lookup-args";
import * as recovery from "./recovery-args";
import { parseReleaseCommandRequest } from "./release-args";
import * as source from "./source-args";
import { parseTestCommandRequest } from "./test-args";
import { parseUpdateCommandRequest } from "./update-args";

// oxlint-disable-next-line eslint/complexity -- Explicit exhaustive dispatch is the facade contract.
export const parseCliRequest = (
  args: readonly string[],
  context?: CliParseContext
): CliRequest => {
  try {
    const [command] = args;
    if (!isCliCommand(command)) {
      throw new Error(
        `skillset: expected command ${renderExpectedCliCommands()}\n${USAGE}`
      );
    }
    const parseContext = context ?? { cwd: process.cwd() };

    switch (command) {
      case "build": {
        return {
          command,
          request: build.parseBuildCommandRequest(args, parseContext),
        };
      }
      case "change": {
        return {
          command,
          request: parseChangeCommandRequest(args, parseContext),
        };
      }
      case "check": {
        return {
          command,
          request: parseCheckCommandRequest(args, parseContext),
        };
      }
      case "create": {
        return {
          command,
          request: parseCreateCommandRequest(args, parseContext),
        };
      }
      case "dev": {
        return { command, request: parseDevCommandRequest(args, parseContext) };
      }
      case "diff": {
        return {
          command,
          request: build.parseDiffCommandRequest(args, parseContext),
        };
      }
      case "distribute": {
        return {
          command,
          request: distribution.parseDistributionCommandRequest(
            args,
            parseContext
          ),
        };
      }
      case "explain": {
        return {
          command,
          request: inspection.parseExplainCommandRequest(args, parseContext),
        };
      }
      case "hooks": {
        return {
          command,
          request: parseHooksCommandRequest(args, parseContext),
        };
      }
      case "import": {
        return {
          command,
          request: source.parseImportCommandRequest(args, parseContext),
        };
      }
      case "init": {
        return {
          command,
          request: parseInitCommandRequest(args, parseContext),
        };
      }
      case "list": {
        return {
          command,
          request: inspection.parseListCommandRequest(args, parseContext),
        };
      }
      case "lookup": {
        return { command, request: parseLookupCommandRequest(args) };
      }
      case "marketplace": {
        return {
          command,
          request: distribution.parseMarketplaceCommandRequest(
            args,
            parseContext
          ),
        };
      }
      case "new": {
        return {
          command,
          request: source.parseNewCommandRequest(args, parseContext),
        };
      }
      case "reconcile": {
        return {
          command,
          request: recovery.parseReconcileCommandRequest(args, parseContext),
        };
      }
      case "release": {
        return {
          command,
          request: parseReleaseCommandRequest(args, parseContext),
        };
      }
      case "restore": {
        return {
          command,
          request: recovery.parseRestoreCommandRequest(args, parseContext),
        };
      }
      case "status": {
        return {
          command,
          request: inspection.parseStatusCommandRequest(args, parseContext),
        };
      }
      case "test": {
        return {
          command,
          request: parseTestCommandRequest(args, parseContext),
        };
      }
      case "update": {
        return {
          command,
          request: parseUpdateCommandRequest(args, parseContext),
        };
      }
      default: {
        command satisfies never;
        throw new Error(`skillset: unhandled command ${command}`);
      }
    }
  } catch (error) {
    if (error instanceof CliOutputError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliOutputError(message, 2, readCliCommand(args));
  }
};
